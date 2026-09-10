// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // No vite.server.proxy for /api here: src/routes/api/public/$.ts already forwards
  // every /api/public/* request to the Express backend (ALYTIC_API_URL, default
  // localhost:3000), in dev and prod alike, with its own path-stripping. A raw
  // "/api" -> Express proxy here would intercept requests before they reach that
  // route and forward the unstripped /api/public/... path straight to Express,
  // which has no such route — that is what caused register/login to fail with a
  // generic 401 ("log in first") instead of ever reaching /api/auth/register.
});
