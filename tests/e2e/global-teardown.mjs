/**
 * Playwright global teardown — deletes the real Supabase rows the E2E specs
 * just seeded (every user registered during the run has an @test.local
 * email; see backend-server.mjs). Runs after every spec, pass or fail.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export default function globalTeardown() {
  const result = spawnSync("node", ["scripts/cleanup-test-data.js"], {
    cwd: path.join(root, "backend"),
    stdio: "inherit",
  });
  if (result.status !== 0) console.error("[e2e] cleanup-test-data.js failed; test data may remain in Supabase");
}
