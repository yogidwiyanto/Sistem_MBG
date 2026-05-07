import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
  plugins: [
    {
      name: "remove-wasm-from-build",
      generateBundle(_, bundle) {
        // Remove WASM files from the bundle — we load them from CDN
        for (const key of Object.keys(bundle)) {
          if (key.endsWith(".wasm")) {
            delete bundle[key];
          }
        }
      },
    },
  ],
});
