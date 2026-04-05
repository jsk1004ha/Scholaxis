# Security Baseline

## Design intent

Security for Scholaxis should assume a public-facing research product with mixed domestic/global data sources, optional report uploads, and one shared app origin.

## Secret handling

- Keep secrets in environment variables or a secret manager.
- Never commit production `.env` files, tunnel credentials, or provider API tokens.
- Rotate `SESSION_SECRET` and provider tokens on a predictable schedule.

## Network and ingress

- Expose only the public hostname through Cloudflare Tunnel or an equivalent ingress.
- Keep the origin app bound to localhost/private network space where possible.
- Treat all source adapter traffic as untrusted outbound network activity with explicit timeouts and allowlists.

## Recommended HTTP protections

Set these headers at the unified app boundary:

- `Content-Security-Policy: default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; object-src 'none'`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Content-Type-Options: nosniff`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Cross-Origin-Opener-Policy: same-origin`

## Rate-limit expectations

Apply rate limiting before public rollout:

- search: `60` requests/min/IP
- paper detail: `120` requests/min/IP
- similarity/report creation: `5` requests/hour/account or session
- provider adapter retries: bounded exponential backoff with caps

## Validation and abuse resistance

- Normalize and validate query input server-side.
- Sanitize provider metadata before rendering.
- Reject oversized payloads early using `UPLOAD_MAX_MB`.
- Restrict report similarity uploads to expected file types and scan before processing if uploads are enabled.
- Deduplicate uploads by hash and delete transient files after processing.

## Similarity/report workflow guardrails

Report similarity is secondary. Keep it behind `ENABLE_REPORT_SIMILARITY=false` until all of the following are true:

- MIME/type validation exists
- size caps and parser timeouts exist
- abuse/rate limits exist
- temporary storage cleanup is automated
- user-facing consent and data-retention copy is finalized

## Logging and privacy

- Log request IDs, latency, upstream adapter outcome, and rate-limit events.
- Avoid logging raw uploaded documents, session secrets, or full personal data payloads.
- Redact provider tokens and signed URLs before persistence.

## Verification expectations

Before public deployment, verify:

- CSP loads the intended UI without opening wildcard sources
- same-origin cookies and API calls work through the tunnel hostname
- rate limits trip correctly for burst traffic
- similarity/report remains disabled by default until explicitly turned on
