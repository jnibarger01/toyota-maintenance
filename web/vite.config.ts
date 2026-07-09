import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Dev proxy: the cockpit UI never talks to anything except the local read-only
// lookup API. No external calls exist in the customer flow.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    globals: false,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.TMC_API ?? "http://127.0.0.1:8791",
        changeOrigin: false,
      },
    },
  },
  preview: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.TMC_API ?? "http://127.0.0.1:8791",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
