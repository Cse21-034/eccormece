import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(async () => {
  const plugins = [react()];

  // Only add Replit-specific plugins in development on Replit
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
  ) {
    try {
      const runtimeErrorOverlay = await import("@replit/vite-plugin-runtime-error-modal");
      plugins.push(runtimeErrorOverlay.default());
      
      const { cartographer } = await import("@replit/vite-plugin-cartographer");
      plugins.push(cartographer());
    } catch (error) {
      console.warn("Could not load Replit plugins:", error);
    }
  }

  return {
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "client", "src"),
        "@shared": path.resolve(__dirname, "shared"),
        "@assets": path.resolve(__dirname, "attached_assets"),
      },
    },
    root: path.resolve(__dirname, "client"),
    build: {
      outDir: path.resolve(__dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
  };
});