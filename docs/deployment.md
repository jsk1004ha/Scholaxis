# Deployment and Tunnel Guide

## Objective

Run Scholaxis as a single app process and expose it through one public hostname. Cloudflare Tunnel is the preferred ingress example because it avoids opening inbound ports while keeping UI and API traffic together.

## Baseline deployment flow

1. Start the unified app on `PORT=3000`.
2. Keep secrets in environment variables, not committed files.
3. Point Cloudflare Tunnel at `http://localhost:3000`.
4. Terminate all public traffic on the same hostname for UI and API routes.
5. Enable report similarity only when upload safety and abuse controls are ready.

## Example runtime assumptions

- App process: `localhost:3000`
- Public hostname: `research.example.com`
- UI routes and `/api/*` share the same host
- Similarity/report endpoints remain behind the same host and existing auth/session scope

## Tunnel setup outline

1. Install `cloudflared` on the host.
2. Authenticate and create a named tunnel.
3. Store the generated credentials JSON **outside** the repository.
4. Copy `cloudflared/config.example.yml` to the host-specific config path.
5. Replace the example tunnel UUID and hostname.
6. Route DNS for the hostname through the tunnel.
7. Validate ingress rules with `cloudflared tunnel ingress validate --config <PATH>`.
8. Start the service and verify `/` plus `/api/*` through the same origin.

## Config location notes

- Linux service installs commonly read from `~/.cloudflared/config.yml` unless an explicit `--config` path is passed.
- Windows service installs commonly read from `%USERPROFILE%\.cloudflared\config.yml`.
- The tunnel credentials JSON should live outside the repo in an OS-protected location.

## Operational notes

- Prefer a dedicated service account or machine identity for tunnel management.
- Keep the credentials JSON in an OS-protected directory such as `/etc/cloudflared/`.
- Never commit live tunnel IDs, credentials JSON, or production hostnames.
- If local TLS is added later, document the origin certificate chain instead of disabling verification by default.

## Release checklist

- [ ] unified app serves UI and API from one host
- [ ] `APP_BASE_URL` and `API_BASE_URL` point at the same origin
- [ ] CSP, rate limits, and request logging are enabled
- [ ] similarity/report feature flag intentionally on or off
- [ ] tunnel config uses `http_status:404` catch-all
- [ ] `cloudflared tunnel ingress validate --config <PATH>` passes
- [ ] secrets and tunnel credentials stay out of git
