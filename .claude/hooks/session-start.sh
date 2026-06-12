#!/bin/bash
# SessionStart hook — make gstack's /browse (Playwright Chromium) trust this
# environment's TLS-intercepting egress proxy, so headless-browser content
# verification works without `net::ERR_CERT_AUTHORITY_INVALID`.
#
# Why this is needed: Node and curl trust the proxy because NODE_EXTRA_CA_CERTS
# / the system CA bundle include the egress-gateway CA — but Chromium on Linux
# reads its own trust store (the NSS user DB at ~/.pki/nssdb), which does not.
# This hook imports the proxy CA(s) into that NSS DB.
#
# Strictly best-effort: it must NEVER fail or block session start, and it is a
# no-op outside the managed remote environment (where the egress CA files don't
# exist — e.g. local dev). Logs go to stderr; stdout is left empty so nothing is
# injected into the session context.
set -uo pipefail   # deliberately no `-e`: keep going on any single failure

log() { echo "[ca-trust] $*" >&2; }

# 1. No-op unless this environment ships the egress proxy CA.
shopt -s nullglob
egress_cas=(/usr/local/share/ca-certificates/egress-gateway-ca-*.crt)
shopt -u nullglob
if [ "${#egress_cas[@]}" -eq 0 ]; then
  log "no egress-gateway CA present — nothing to trust (local/dev env); skipping."
  exit 0
fi

# 2. Ensure certutil (from libnss3-tools) is available.
if ! command -v certutil >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    log "certutil missing — installing libnss3-tools…"
    DEBIAN_FRONTEND=noninteractive apt-get install -y libnss3-tools >/dev/null 2>&1 \
      || { DEBIAN_FRONTEND=noninteractive apt-get update >/dev/null 2>&1 \
           && DEBIAN_FRONTEND=noninteractive apt-get install -y libnss3-tools >/dev/null 2>&1; }
  fi
fi
if ! command -v certutil >/dev/null 2>&1; then
  log "certutil unavailable and could not be installed — skipping (best-effort)."
  exit 0
fi

# 3. Ensure the NSS user DB exists (Chromium reads ~/.pki/nssdb on Linux).
NSSDB="$HOME/.pki/nssdb"
mkdir -p "$NSSDB" 2>/dev/null || true
if [ ! -f "$NSSDB/cert9.db" ]; then
  certutil -d "sql:$NSSDB" -N --empty-password >/dev/null 2>&1 \
    && log "created NSS DB at $NSSDB" \
    || log "could not create NSS DB at $NSSDB (continuing)."
fi

# 4. Import the egress + secure-web-proxy CAs as trusted SSL roots. `-A` upserts
#    by nickname, so re-running every session is idempotent.
shopt -s nullglob
proxy_cas=(/usr/local/share/ca-certificates/egress-gateway-ca-*.crt \
           /usr/local/share/ca-certificates/swp-ca-*.crt)
shopt -u nullglob
imported=0
for c in "${proxy_cas[@]}"; do
  [ -e "$c" ] || continue
  n="$(basename "$c" .crt)"
  if certutil -d "sql:$NSSDB" -A -t "C,," -n "$n" -i "$c" >/dev/null 2>&1; then
    imported=$((imported + 1))
  else
    log "failed to import $n (continuing)."
  fi
done
log "trusted $imported proxy CA(s) in $NSSDB — gstack /browse can now reach https sites through the egress proxy."
exit 0
