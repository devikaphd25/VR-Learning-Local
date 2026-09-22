/**
 * Vite/IWSDK development configuration.
 * Compiles UIKitML, enables the Quest emulator, proxies /api to the Node server,
 * and exposes the HTTPS development host to headsets on the local network.
 */
import { iwsdkDev } from "@iwsdk/vite-plugin-dev";
import { compileUIKit } from "@iwsdk/vite-plugin-uikitml";
import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";

export default defineConfig({
  plugins: [
    mkcert(),

    iwsdkDev({
      emulator: {
        device: "metaQuest3",
      },

      verbose: true,
    }),

    compileUIKit({
      sourceDir: "ui",
      outputDir: "public/ui",
      verbose: true,
    }),
  ],

  server: {
    host: "0.0.0.0",
  port: 8081,
  strictPort: true,
  open: "/",

  proxy: {
    "/api": {
      target: "http://localhost:3001",
      changeOrigin: true,
    },

    "/socket.io": {
      target: "http://localhost:3001",
      ws: true,
      changeOrigin: true,
    },
  },
  },

  build: {
    outDir: "dist",
    sourcemap:
      process.env.NODE_ENV !== "production",
    target: "esnext",

    rollupOptions: {
      input: "./index.html",
    },
  },

  esbuild: {
    target: "esnext",
  },

  optimizeDeps: {
    exclude: [
      "@babylonjs/havok",
    ],

    esbuildOptions: {
      target: "esnext",
    },
  },

  publicDir: "public",
  base: "./",
});
