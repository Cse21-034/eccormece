import type { Express } from "express";
import { createServer, type Server } from "http";
import { createProxyMiddleware } from "http-proxy-middleware";
import express from "express";
import path from "path";

export function log(message: string, source = "express") {
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: true });
  console.log(`${timestamp} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
    configFile: path.resolve(process.cwd(), "vite.config.ts"),
  });

  app.use(vite.ssrFixStacktrace);
  app.use(vite.middlewares);
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(process.cwd(), "dist/public");
  app.use(express.static(distPath));
  
  app.get("*", (req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}