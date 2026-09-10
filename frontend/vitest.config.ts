import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsConfigPaths from "vite-tsconfig-paths";

// Standalone config — deliberately separate from vite.config.ts, whose
// @lovable.dev/tanstack-start plugin chain is build-oriented (nitro, server
// entry rewriting) and does not apply to jsdom unit tests.
export default defineConfig({
  plugins: [react(), tsConfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    coverage: {
      reporter: ["text", "html"],
      include: ["src/lib/**", "src/hooks/**"],
      thresholds: {
        statements: 0,
      },
    },
  },
});
