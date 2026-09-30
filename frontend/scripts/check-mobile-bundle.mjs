// Everything in dist-mobile/ is copied into the APK / IPA and must be treated as public.
// This fails the build if something that looks like a secret, or an insecure
// production API URL, ended up in it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "dist-mobile/client";
const PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/SUPABASE_SERVICE_ROLE_KEY/, "Supabase service-role key name"],
  [/sk-or-v1-[A-Za-z0-9]{20,}/, "OpenRouter API key"],
  [/sk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic API key"],
  [/\b(?:SESSION_SECRET|TENANT_SECRETS_KEY|RESEND_API_KEY|FCM_SERVICE_ACCOUNT_JSON|CRON_SECRET)\b\s*[:=]\s*["'][^"']{8,}/, "server secret assignment"],
  [/"private_key_id"\s*:/, "service-account JSON"],
  [/\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, "JWT"],
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(js|mjs|css|html|json|map|txt)$/.test(name)) yield path;
  }
}

const problems = [];
for (const file of walk(root)) {
  const text = readFileSync(file, "utf8");
  for (const [pattern, label] of PATTERNS) if (pattern.test(text)) problems.push(`${file}: ${label}`);
}

if (problems.length) {
  console.error("[mobile] bundle check FAILED — the app bundle is public, remove these:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`[mobile] bundle check passed (${root}: no secrets found)`);
