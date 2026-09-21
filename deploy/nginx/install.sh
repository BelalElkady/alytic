#!/usr/bin/env bash
# Installs the nginx security rules for egxpert.com on the VPS.
#
#   sudo bash deploy/nginx/install.sh                 # install and reload
#   sudo bash deploy/nginx/install.sh --dry-run       # show what would change, touch nothing
#   sudo SITE_FILE=/etc/nginx/sites-available/egxpert.com bash deploy/nginx/install.sh
#
# What it does:
#   1. copies egxpert-limits.conf  -> /etc/nginx/conf.d/         (http context: rate-limit zones)
#   2. copies egxpert-security.conf -> /etc/nginx/snippets/      (server context: the rules)
#   3. adds `include snippets/egxpert-security.conf;` to the site file's HTTPS
#      server block (or its only block, if certbot has not run yet)
#   4. runs `nginx -t`; if that fails it restores every file it touched and
#      exits without reloading. Only a passing test reloads nginx.
#
# Safe to re-run: it does nothing to a site file that already has the include.
# Backups go next to the originals as *.bak-<timestamp>.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_FILE="${SITE_FILE:-/etc/nginx/sites-available/egxpert.com}"
LIMITS_DEST="/etc/nginx/conf.d/egxpert-limits.conf"
SNIPPET_DEST="/etc/nginx/snippets/egxpert-security.conf"
INCLUDE_LINE="include snippets/egxpert-security.conf;"
STAMP="$(date +%Y%m%d-%H%M%S)"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ "$DRY" = 1 ] || [ "$(id -u)" = 0 ] || die "run as root (sudo bash $0)"
command -v nginx >/dev/null || die "nginx is not installed on this machine"
[ -f "$HERE/egxpert-limits.conf" ] && [ -f "$HERE/egxpert-security.conf" ] || die "run this from a checkout that has egxpert-limits.conf and egxpert-security.conf next to it"
[ -f "$SITE_FILE" ] || die "site file $SITE_FILE not found — set SITE_FILE=/path/to/your/site/file"

# The site file's server blocks that should get the include: the one that
# listens on 443 (certbot's), or — before certbot has run — the one plain block.
# Prints the 1-based line number of each such block's `server_name` line.
target_lines() {
  awk '
    /^[[:space:]]*server[[:space:]]*\{/ { n++; depth = 1; has443[n] = 0; sn[n] = 0; next }
    n && depth {
      if ($0 ~ /\{/) depth += gsub(/\{/, "{")
      if ($0 ~ /\}/) depth -= gsub(/\}/, "}")
      if ($0 ~ /^[[:space:]]*listen[[:space:]].*443/) has443[n] = 1
      if ($0 ~ /^[[:space:]]*server_name[[:space:]]/ && !sn[n]) sn[n] = NR
    }
    END {
      any443 = 0
      for (i = 1; i <= n; i++) if (has443[i]) any443 = 1
      for (i = 1; i <= n; i++) if (sn[i] && (has443[i] || (!any443 && n == 1))) print sn[i]
    }
  ' "$SITE_FILE"
}

if grep -qF "$INCLUDE_LINE" "$SITE_FILE"; then
  ALREADY=1
else
  ALREADY=0
  TARGETS="$(target_lines)"
  [ -n "$TARGETS" ] || die "could not find the HTTPS server block in $SITE_FILE — add '$INCLUDE_LINE' inside it by hand, then re-run"
fi

say "site file : $SITE_FILE"
say "limits    : $LIMITS_DEST"
say "snippet   : $SNIPPET_DEST"
if [ "$ALREADY" = 1 ]; then say "include   : already present"; else say "include   : will be added after server_name on line(s): $(echo $TARGETS | tr '\n' ' ')"; fi
if [ "$DRY" = 1 ]; then say "(dry run — nothing changed)"; exit 0; fi

# ---- back up, then change -----------------------------------------------------
declare -a RESTORE=()   # "backup|original" pairs, or "|original" for a file that did not exist
backup() {
  local f="$1"
  if [ -e "$f" ]; then cp -p "$f" "$f.bak-$STAMP"; RESTORE+=("$f.bak-$STAMP|$f"); else RESTORE+=("|$f"); fi
}
rollback() {
  say "Restoring the previous nginx files…"
  local pair bak orig
  for pair in "${RESTORE[@]}"; do
    bak="${pair%%|*}"; orig="${pair##*|}"
    if [ -n "$bak" ]; then cp -p "$bak" "$orig"; else rm -f "$orig"; fi
  done
}

mkdir -p /etc/nginx/conf.d /etc/nginx/snippets
backup "$LIMITS_DEST";  install -m 0644 "$HERE/egxpert-limits.conf"   "$LIMITS_DEST"
backup "$SNIPPET_DEST"; install -m 0644 "$HERE/egxpert-security.conf" "$SNIPPET_DEST"

if [ "$ALREADY" = 0 ]; then
  backup "$SITE_FILE"
  TMP="$(mktemp)"
  # Insert after each target server_name line, matching that line's indentation.
  awk -v targets="$(echo $TARGETS | tr '\n' ' ')" -v inc="$INCLUDE_LINE" '
    BEGIN { m = split(targets, t, " "); for (i = 1; i <= m; i++) want[t[i]] = 1 }
    { print }
    (NR in want) { match($0, /^[[:space:]]*/); print substr($0, 1, RLENGTH) "" inc }
  ' "$SITE_FILE" > "$TMP"
  cat "$TMP" > "$SITE_FILE"; rm -f "$TMP"
fi

# ---- validate, and only then reload --------------------------------------------
if ! nginx -t 2>&1; then
  rollback
  die "nginx -t rejected the new configuration; everything was restored and nginx was NOT reloaded"
fi
if command -v systemctl >/dev/null && systemctl is-active --quiet nginx; then
  systemctl reload nginx
else
  nginx -s reload
fi

say ""
say "Done. Backups: *.bak-$STAMP next to each changed file."
say "Check it from your own machine:"
say "  cd backend && node scripts/security-check.mjs https://egxpert.com --active"
