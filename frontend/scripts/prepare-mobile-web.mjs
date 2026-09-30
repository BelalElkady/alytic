// TanStack Start's SPA build emits the app shell as _shell.html. Capacitor
// (and every static file server) expects index.html, so publish it under that name.
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = "dist-mobile/client";
const shell = join(dir, "_shell.html");
if (!existsSync(shell)) {
  console.error(`[mobile] ${shell} not found — did "vite build -c vite.config.mobile.ts" run?`);
  process.exit(1);
}
copyFileSync(shell, join(dir, "index.html"));
console.log("[mobile] wrote", join(dir, "index.html"));
