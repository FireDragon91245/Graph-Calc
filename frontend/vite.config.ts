import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const certDir = path.resolve(__dirname, "../certs");
const certPath = path.join(certDir, "localhost-cert.pem");
const keyPath = path.join(certDir, "localhost-key.pem");
const backendConfigPath = path.resolve(__dirname, "../backend/config.json");
const backendConfig = JSON.parse(fs.readFileSync(backendConfigPath, "utf-8"));
const backendTarget = `https://${backendConfig.server.host}:${backendConfig.server.port}`;

export default defineConfig({
  plugins: [react()],
  server: {
    https: {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath)
    },
    host: "localhost",
    strictPort: true,
    proxy: {
      "/api": {
        target: backendTarget,
        changeOrigin: true,
        secure: false,
        rewrite: (requestPath) => requestPath.replace(/^\/api/, "")
      }
    },
    port: 5173
  }
});
