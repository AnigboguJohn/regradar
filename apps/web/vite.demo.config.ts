// Builds the self-contained demo preview (one HTML file, in-browser sample data): npm run build:demo
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  define: { "import.meta.env.VITE_DEMO": JSON.stringify("1") },
  base: "./", // works at any path, e.g. https://<user>.github.io/regradar/
  build: { outDir: "dist-demo" },
});
