/**
 * Runs the three test layers in order, stopping at the first failure:
 *   1. backend  — node:test (unit + modules + API integration)
 *   2. frontend — vitest (jsdom)
 *   3. e2e      — Playwright (boots the real backend + frontend)
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

const LAYERS = [
  { name: "backend", command: "npm", args: ["--prefix", "backend", "test"] },
  { name: "frontend", command: "bun", args: ["run", "--cwd", "frontend", "test"] },
  { name: "e2e", command: "npx", args: ["playwright", "test"] },
];

const failed = [];

for (const layer of LAYERS) {
  console.log(`\n=== ${layer.name} ===\n`);
  const result = spawnSync(layer.command, layer.args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) failed.push(layer.name);
}

console.log("\n=== summary ===");
for (const layer of LAYERS) {
  console.log(`${failed.includes(layer.name) ? "✗" : "✓"} ${layer.name}`);
}
process.exit(failed.length ? 1 : 0);