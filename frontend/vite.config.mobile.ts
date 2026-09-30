// Static single-page build for the Capacitor shells (Android / iOS).
//
// The website is server-rendered (TanStack Start on a Node server, see
// vite.config.ts). A native app has no server, so this config builds the same
// routes and components as a client-only SPA into dist-mobile/, which
// Capacitor copies into the apps. Nothing in src/ is forked: the few modules
// that only work with a server (createServerFn) are swapped for client
// equivalents through the aliases below.
import { fileURLToPath } from "node:url";

import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const native = (file: string) => fileURLToPath(new URL(`./src/native/server-fn-shims/${file}`, import.meta.url));

export default defineConfig({
  nitro: false,
  tanstackStart: {
    spa: { enabled: true },
  },
  vite: {
    define: { "import.meta.env.VITE_TARGET": JSON.stringify("native") },
    resolve: {
      alias: [
        { find: /^@\/lib\/tenant-server$/, replacement: native("tenant-server.ts") },
        { find: /^@\/lib\/blog$/, replacement: native("blog.ts") },
      ],
    },
    build: { outDir: "dist-mobile", sourcemap: false },
  },
});
