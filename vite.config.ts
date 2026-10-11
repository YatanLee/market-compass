import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./client", import.meta.url)),
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 4188,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4187",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyRequest) => {
            proxyRequest.setHeader("origin", "http://127.0.0.1:4187");
          });
        },
      },
    },
  },
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
  },
});
