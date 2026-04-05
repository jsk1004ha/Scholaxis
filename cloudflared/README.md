# Cloudflare Tunnel Notes

Use this directory for **example** tunnel assets only.

## Files

- `config.example.yml` — example ingress config routing one public hostname to the unified app on `localhost:3000`

## Safety rules

- Do not commit real tunnel IDs
- Do not commit credentials JSON files
- Do not commit production hostnames unless intentionally public

## Host setup flow

1. Install `cloudflared` on the deployment host.
2. Create/authenticate the tunnel on that host.
3. Store the generated credentials file outside the repo.
4. Copy `config.example.yml` to the runtime config location.
5. Replace the placeholder tunnel UUID and hostname.
6. Run `cloudflared tunnel ingress validate --config <PATH>` before enabling the service.
7. Start the tunnel and confirm both `/` and `/api/*` resolve through the same hostname.
