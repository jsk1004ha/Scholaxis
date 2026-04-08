# Hosted-Together Architecture Contract

## Goal

Deliver Scholaxis as a **single hosted web application** where UI and API traffic terminate on the same public origin. This keeps authentication, CSP, caching, observability, and tunnel configuration simpler while preserving clean internal boundaries.

## Non-negotiables

- **Korean-first defaults**: `ko-KR`, Korean copy first, region defaults favor domestic academic sources while keeping global sources available.
- **Paper exploration first**: search, detail, and related research flows are core. Report similarity remains secondary and should stay feature-flagged.
- **Integration-friendly boundaries**: adapters and ranking logic should be modular behind internal service interfaces.
- **Single host**: avoid deploying the frontend and backend on different public origins unless a later migration plan explicitly requires it.

## Runtime layers

- **UI layer**
  - home, search, paper detail, similarity/report surfaces
- **API/BFF layer**
  - same-origin `/api/*`
- **Domain services**
  - query normalization
  - source fan-out and ingestion
  - canonical dedupe
  - vector + lexical ranking
  - report similarity
- **Provider adapters**
  - API-backed: Semantic Scholar, arXiv, DBpia(keyed), KIPRIS Plus(configured)
  - crawl-backed: RISS, ScienceON, NTIS, science fair, student invention fair
  - configurable: KCI public search hook

## Storage model

- quickstart/dev fallback: SQLite + in-process vectors
- serious-use baseline: PostgreSQL + pgvector
- in-memory seed catalog still exists for deterministic startup/demo coverage
- on-request live source ingestion and canonical merge remain in-process

## Current serious-use baseline

- persist `documents`, `source_records`, request/search logs, jobs, and user data in PostgreSQL
- use pgvector for direct nearest-neighbor search against documents and chunks
- validate the runtime with `npm run validate:postgres`
- keep SQLite/local vector mode as a developer fallback, not the primary deployment target

## Next production evolution

- further separate graph storage if real source expansion becomes large
- continue tightening migration/ops automation around the PostgreSQL serious-use path
