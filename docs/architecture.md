# Hosted-Together Architecture Contract

## Goal

Deliver Scholaxis as a **single hosted web application** where UI and API traffic terminate on the same public origin. This keeps authentication, CSP, caching, observability, and tunnel configuration simpler while preserving clean internal boundaries.

## Non-negotiables

- **Korean-first defaults**: `ko-KR`, Korean copy first, region defaults favor domestic academic sources while keeping global sources available.
- **Paper exploration first**: search, detail, and related research flows are core. Report similarity remains secondary and should stay feature-flagged.
- **Integration-friendly boundaries**: adapters and ranking logic should be modular behind internal service interfaces.
- **Single host**: avoid deploying the frontend and backend on different public origins unless a later migration plan explicitly requires it.

## Recommended runtime layout

The exact framework can change, but the deployment contract should look like this:

- **Web shell / UI layer**
  - Home, search, paper detail, similarity/report surfaces
  - Korean-first navigation, date/number formatting, and labels
- **API / BFF layer**
  - `/api/search`
  - `/api/papers/:paperId`
  - `/api/papers/:paperId/related`
  - `/api/similarity/report` (secondary, feature-flagged)
- **Domain services**
  - query normalization
  - source adapter orchestration
  - ranking / dedupe / enrichment
  - report similarity job handling
- **Provider adapters**
  - KCI / RISS / DBpia / arXiv / Crossref / Semantic Scholar style adapters
  - outbound requests stay server-side and normalize into one internal result schema

## Suggested directory ownership model

This is a target structure, not a claim on existing implementation files:

- `app/` or `src/app/` — routed UI surfaces
- `src/server/` — API handlers and domain services
- `src/server/adapters/` — source/provider integrations
- `src/server/security/` — headers, rate limits, validation helpers
- `tests/` — smoke, contract, and verification scripts
- `docs/` — operator-facing documentation
- `cloudflared/` — tunnel config examples only (never credentials)

## Environment contract

Use a single environment file shape for local and deployed environments:

- `NODE_ENV`
- `PORT`
- `APP_BASE_URL`
- `API_BASE_URL` (same origin by default)
- `SESSION_SECRET`
- `CONTENT_LOCALE`
- `DEFAULT_SEARCH_REGION`
- `SEARCH_RATE_LIMIT_RPM`
- `DETAIL_RATE_LIMIT_RPM`
- `SIMILARITY_RATE_LIMIT_RPH`
- `UPLOAD_MAX_MB`
- `ENABLE_REPORT_SIMILARITY`
- `CLOUDFLARE_TUNNEL_HOSTNAME`

## Deployment topology

1. Unified web app listens on one internal port (default `3000`).
2. Local reverse proxy is optional; public ingress should still target the same app.
3. Cloudflare Tunnel forwards the public hostname to `http://localhost:3000`.
4. Static assets and API responses share one origin to simplify CSP and cookies.
5. Similarity/report jobs should run behind the same app boundary or a private worker queue, not a second public app.

## Route contract

- `/` — discovery landing / search prompt
- `/search` — integrated result list and filters
- `/papers/:paperId` — paper detail, metadata, citations, related work
- `/similarity` — optional report similarity entry point
- `/api/search` — search/query API
- `/api/papers/:paperId` — normalized paper detail API
- `/api/papers/:paperId/related` — related and similar paper API
- `/api/similarity/report` — secondary report similarity endpoint

## Korean-first behavior checklist

- default locale: `ko-KR`
- Korean labels appear before English helper text
- source filters include domestic/global toggles by default
- Hangul line-height, truncation, and search tokenization must be tested explicitly
- empty, loading, and error states should ship in Korean first
