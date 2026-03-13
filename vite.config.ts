import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest";

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        dashboard: "src/dashboard/dashboard.html",
      },
    },
  },
});
