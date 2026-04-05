# Scholaxis

Scholaxis is a Korean-first research exploration engine for discovering papers, related work, and supporting evidence from a single hosted web application. Report similarity is intentionally secondary to paper exploration and should remain feature-flagged until the core search and detail flows are stable.

## Current repository status

This repository currently contains stitch references plus deployment/security/verification assets that define the target delivery contract for the app.

## Product priorities

1. **Paper exploration first** — home, search, paper detail, and related/similar paper discovery come before report similarity workflows.
2. **Hosted together** — frontend and backend should ship behind one origin and one deployment surface.
3. **Korean-first UX** — Korean copy, locale defaults, region-aware search filters, and Hangul-friendly typography are baseline requirements.
4. **Integration-friendly architecture** — source adapters, ranking, and similarity/report services should be swappable without rewriting the UI shell.
5. **Secure by default** — the delivery target assumes strict secrets handling, rate limiting, CSP, and safe upload/report processing.

## Stitch references

- `stitch/sciencebridge_home/`
- `stitch/search_results/`
- `stitch/analysis_detail/`
- `stitch/similarity_report/`
- Light/dark design references in `stitch/*_dark/`

## Documentation map

- `docs/architecture.md` — combined-host architecture, route boundaries, and environment contract.
- `docs/deployment.md` — deployment flow and Cloudflare Tunnel guidance for a single hosted app.
- `docs/security.md` — security baseline, rate-limit expectations, CSP, and upload/report handling rules.
- `cloudflared/config.example.yml` — example tunnel config routing the public hostname to the unified local app.
- `cloudflared/README.md` — tunnel setup notes.
- `.env.example` — environment contract for local/dev/prod alignment.
- `tests/verify-doc-assets.sh` — lightweight verification script for the docs/deployment lane.

## Expected app shape

The implementation lane should target one runtime exposing both UI and API routes, for example:

- `/` — Korean-first discovery home
- `/search` — integrated results
- `/papers/:paperId` — paper detail / analysis
- `/similarity` — secondary report similarity workspace
- `/api/search`, `/api/papers/:paperId`, `/api/similarity/*` — unified backend endpoints

Keep the public hostname, auth/session scope, and observability surface shared across UI and API rather than splitting them across separate deployments.
