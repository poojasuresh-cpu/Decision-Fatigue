import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
      "@content": path.resolve(__dirname, "src/content"),
      "@background": path.resolve(__dirname, "src/background")
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        "content/content": path.resolve(__dirname, "src/content/index.ts"),
        "background/service_worker": path.resolve(
          __dirname,
          "src/background/service_worker.ts"
        )
      },
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
