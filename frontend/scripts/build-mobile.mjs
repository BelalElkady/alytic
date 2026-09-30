// Builds the static web bundle for the native apps.
//
//   bun run build:mobile                       # production values (env/mobile.production.env)
//   MOBILE_ENV=staging bun run build:mobile    # env/mobile.staging.env
//   MOBILE_ENV=development bun run build:mobile
//
// Values already present in the environment win over the file, so CI can
// override anything. Only public, client-safe values belong in these files.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const name = process.env.MOBILE_ENV ?? "production";
const file = `env/mobile.${name}.env`;
if (!existsSync(file)) {
  console.error(`[mobile] unknown MOBILE_ENV "${name}" (no ${file})`);
  process.exit(1);
}
for (const line of readFileSync(file, "utf8").split("\n")) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (match && !line.trim().startsWith("#")) process.env[match[1]] ??= match[2];
}
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
process.env.VITE_APP_VERSION ??= pkg.version ?? "0.0.0";

if (process.env.VITE_APP_ENV === "production" && !/^https:\/\//.test(process.env.VITE_API_BASE_URL ?? "")) {
  console.error("[mobile] production builds require an https VITE_API_BASE_URL");
  process.exit(1);
}

const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
console.log(`[mobile] building "${name}" → API ${process.env.VITE_API_BASE_URL}`);
run("bunx", ["vite", "build", "-c", "vite.config.mobile.ts"]);
run("node", ["scripts/prepare-mobile-web.mjs"]);
run("node", ["scripts/check-mobile-bundle.mjs"]);
