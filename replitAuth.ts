import * as client from "openid-client";
// Remove the passport import from openid-client/passport
import { Strategy as OpenIDStrategy } from "passport-openid-connect";
// Alternative: Use passport-oauth2 or implement custom strategy

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

if (!process.env.REPLIT_DOMAINS) {
  throw new Error("Environment variable REPLIT_DOMAINS not provided");
}

// Define interfaces for type safety
interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  [key: string]: any;
}

interface UserClaims {
  sub: string;
  email: string;
  first_name: string;
  last_name: string;
  profile_image_url: string;
  exp?: number;
  [key: string]: any;
}

const getOidcConfig = memoize(
  async () => {
    const issuer = await client.Issuer.discover(
      process.env.ISSUER_URL ?? "https://replit.com/oidc"
    );
    
    return new issuer.Client({
      client_id: process.env.REPL_ID!,
      client_secret: process.env.CLIENT_SECRET!,
      response_types: ["code"],
    });
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(user: any, tokens: TokenResponse, claims: UserClaims) {
  user.claims = claims;
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = claims.exp;
}

async function upsertUser(claims: UserClaims) {
  await storage.upsertUser({
    id: claims.sub,
    email: claims.email,
    firstName: claims.first_name,
    lastName: claims.last_name,
    profileImageUrl: claims.profile_image_url,
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const oidcClient = await getOidcConfig();

  // Custom passport strategy implementation
  for (const domain of process.env.REPLIT_DOMAINS!.split(",")) {
    passport.use(
      `replitauth:${domain}`,
      new OpenIDStrategy(
        {
          issuer: process.env.ISSUER_URL ?? "https://replit.com/oidc",
          clientID: process.env.REPL_ID!,
          clientSecret: process.env.CLIENT_SECRET!,
          callbackURL: `https://${domain}/api/callback`,
          scope: "openid email profile offline_access",
        },
        async (issuer: any, profile: any, done: any) => {
          try {
            const user = {};
            const claims = profile._json as UserClaims;
            const tokens = {
              access_token: profile.accessToken,
              refresh_token: profile.refreshToken,
            };
            
            updateUserSession(user, tokens, claims);
            await upsertUser(claims);
            done(null, user);
          } catch (error) {
            done(error);
          }
        }
      )
    );
  }

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    passport.authenticate(`replitauth:${req.hostname}`, {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })(req, res, next);
  });

  app.get("/api/logout", async (req, res) => {
    const oidcClient = await getOidcConfig();
    req.logout(() => {
      // Build end session URL manually
      const endSessionUrl = new URL(oidcClient.issuer.end_session_endpoint || `${oidcClient.issuer.issuer}/logout`);
      endSessionUrl.searchParams.set('client_id', process.env.REPL_ID!);
      endSessionUrl.searchParams.set('post_logout_redirect_uri', `${req.protocol}://${req.hostname}`);
      
      res.redirect(endSessionUrl.href);
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const oidcClient = await getOidcConfig();
    const tokenSet = await oidcClient.refresh(refreshToken);
    const claims = tokenSet.claims() as UserClaims;
    
    updateUserSession(user, tokenSet, claims);
    return next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};