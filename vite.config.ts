import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";

/**
 * The panel must not be framed by another site. The API allowlists the exact
 * panel port, so Vite is also told to fail instead of silently moving to a
 * different port that the API would reject.
 */
const securityHeaders = (): Plugin => {
  const apply = (server: { middlewares: { use: (handler: (req: unknown, res: { setHeader(name: string, value: string): void }, next: () => void) => void) => void } }) => {
    server.middlewares.use((_req, res, next) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
      next();
    });
  };
  return {
    name: "factoryos-security-headers",
    configureServer: server => apply(server),
    configurePreviewServer: server => apply(server),
  };
};

export default defineConfig({
  root: "web",
  publicDir: "../public",
  plugins: [securityHeaders()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4177",
      // The static preview is served by the API server, not by Vite.
      "/preview-static": "http://127.0.0.1:4177"
    }
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        landing: fileURLToPath(new URL("./web/index.html", import.meta.url)),
        app: fileURLToPath(new URL("./web/app.html", import.meta.url))
      }
    }
  }
});
