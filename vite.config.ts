import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: { outDir: path.resolve(import.meta.dirname, "dist", "public"), emptyOutDir: true },
  server: { host: true, allowedHosts: [".manuspre.computer", ".manus.computer", ".manus-asia.com", ".manuscomputer.ai", "localhost", "127.0.0.1"] },
});
