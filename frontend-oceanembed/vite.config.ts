import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { nitro } from "nitro/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vite";

// Stock TanStack Start + Nitro (Vercel) setup. Dev server: `npm run dev` on port 8080.
export default defineConfig(({ command }) => ({
  plugins: [
    tsConfigPaths(),
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    tanstackStart({ server: { entry: "server" } }),
    // Build-only: bundle the server with Nitro's `vercel` preset (Vercel Functions).
    ...(command === "build" ? [nitro({ preset: "node-server" })] : []),
    react(),
    tailwindcss(),
  ],
  css: { transformer: "lightningcss" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  server: { port: 8080, host: true, strictPort: true },
}));
