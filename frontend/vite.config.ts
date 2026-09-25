import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the Vite server proxies API and WebSocket calls to the FastAPI backend on port 8000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/ws": { target: "ws://127.0.0.1:8000", ws: true },
    },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 1500 },
});
