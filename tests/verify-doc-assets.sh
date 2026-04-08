#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

required_files=(
  "README.md"
  "docs/architecture.md"
  "docs/deployment.md"
  "docs/security.md"
  "cloudflared/README.md"
  "cloudflared/config.example.yml"
  ".env.example"
  "tests/verify-doc-assets.sh"
)

for path in "${required_files[@]}"; do
  [[ -f "$path" ]] || {
    echo "Missing required file: $path" >&2
    exit 1
  }
done

grep -Eq "Korean-first|한국어 중심" README.md || { echo "README is missing Korean-first guidance" >&2; exit 1; }
grep -q "validate:postgres" README.md || { echo "README is missing postgres validation guidance" >&2; exit 1; }
grep -q "single hosted web application" docs/architecture.md || { echo "Architecture doc is missing hosted-together contract" >&2; exit 1; }
grep -q "serious-use baseline: PostgreSQL + pgvector" docs/architecture.md || { echo "Architecture doc is missing serious-use storage guidance" >&2; exit 1; }
grep -q "Cloudflare Tunnel" docs/deployment.md || { echo "Deployment doc is missing tunnel guidance" >&2; exit 1; }
grep -q "cloudflared tunnel ingress validate" docs/deployment.md || { echo "Deployment doc is missing ingress validation guidance" >&2; exit 1; }
grep -q "npm run validate:postgres" docs/deployment.md || { echo "Deployment doc is missing postgres validation command" >&2; exit 1; }
grep -q "Content-Security-Policy" docs/security.md || { echo "Security doc is missing CSP guidance" >&2; exit 1; }
grep -q "http://localhost:3000" cloudflared/config.example.yml || { echo "Tunnel config is missing unified app target" >&2; exit 1; }
grep -q "http_status:404" cloudflared/config.example.yml || { echo "Tunnel config is missing 404 catch-all" >&2; exit 1; }
grep -Eq "ENABLE_REPORT_SIMILARITY=(true|false)" .env.example || { echo ".env.example is missing similarity feature flag default" >&2; exit 1; }
grep -q "SCHOLAXIS_VECTOR_BACKEND=pgvector" .env.example || { echo ".env.example is missing pgvector serious-use guidance" >&2; exit 1; }

if command -v cloudflared >/dev/null 2>&1; then
  cloudflared tunnel ingress validate --config cloudflared/config.example.yml >/dev/null
  echo "PASS: cloudflared ingress validation succeeded."
else
  echo "SKIP: cloudflared not installed; ingress validation command not executed."
fi

echo "PASS: docs, env example, and cloudflared assets are present and internally aligned."
