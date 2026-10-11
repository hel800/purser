import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "path";

const root = import.meta.dirname;

// Tauri expects a fixed dev server port
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  define: {
    // captured when the frontend is built (dev server start or vite build)
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  build: {
    rollupOptions: {
      input: {
        popup: resolve(root, "index.html"),
        quickadd: resolve(root, "quickadd.html"),
        about: resolve(root, "about.html"),
        help: resolve(root, "help.html"),
        list: resolve(root, "list.html"),
      },
    },
  },
});
