# Security Notes

## Built-in protections

- **Single-origin architecture**: frontend and backend are hosted together to avoid CORS sprawl.
- **Strict security headers**: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, referrer policy, permissions policy, and same-origin resource policy.
- **Body size limits**: JSON and multipart endpoints are capped to reduce abuse risk.
- **Same-origin mutation guard**: unsafe `/api/*` requests with a foreign `Origin` or `Referer` are rejected before state changes.
- **Admin-only operations**: cache clearing, storage diagnostics, and admin dashboards require a valid session whose email is in `SCHOLAXIS_ADMIN_EMAILS`.
- **Admin registration gate**: in production, registering an allowlisted admin email requires `SCHOLAXIS_ADMIN_REGISTRATION_CODE` unless `SCHOLAXIS_ALLOW_ADMIN_SELF_REGISTRATION=true` is explicitly set for a trusted deployment flow.
- **Authentication throttling**: repeated login/register attempts are limited per client/email with `SCHOLAXIS_AUTH_RATE_LIMIT_ATTEMPTS`.
- **Bounded worker queues**: search and analysis workers expose queue depth/rejection diagnostics to reduce request-driven resource exhaustion.
- **Bounded binary extraction**: PDF stream inflation and DOCX/HWPX XML expansion have caps to reduce decompression-bomb risk during similarity uploads.
- **Graceful live-source mode**: external fetches time out and fail closed into partial results instead of crashing the app.
- **No third-party runtime dependencies**: the app uses Node built-ins only, reducing supply-chain exposure for this prototype.

## Live-source hardening checklist

1. Use provider API keys where official APIs exist.
2. Respect provider robots/terms/rate limits before enabling broad crawl mode.
3. Set conservative timeouts and per-source result caps.
4. Log source errors without leaking credentials.
5. Do not proxy unrestricted external URLs from the client.
6. Keep `KIPRIS_PLUS_SEARCH_URL` / `KCI_SEARCH_URL` server-side only.

## Important limits

- Some domestic providers change public HTML frequently.
- DBpia and KIPRIS Plus official access may require keys, registered IPs, or approved service contracts.
- Binary file extraction is not yet a trusted pipeline; similarity upload currently focuses on text/multipart compatibility.
- Anonymous async analysis job URLs are bearer-style random URLs. Treat them as sensitive if shared outside the current browser session.
