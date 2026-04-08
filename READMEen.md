<div align="center">

# Scholaxis

> English companion · 한국어 기본 문서: [README.md](./README.md)

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Status](https://img.shields.io/badge/status-v0%20prototype-6f42c1?style=flat-square)
![Docs](https://img.shields.io/badge/docs-KO%20%7C%20EN-0ea5e9?style=flat-square)
![Storage](https://img.shields.io/badge/storage-SQLite%20%7C%20PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)

</div>

Scholaxis is a **Korean-first research exploration engine** whose primary product is paper/research discovery and whose secondary product is document similarity analysis. It is designed as a single web application that unifies global/domestic academic sources, patents, projects, science fairs, student invention entries, and R&E reports.

This repository is currently a **strong v0 / engineering prototype**: the core search product works, live-source adapters exist, persistence and operational APIs are in place, and translation/reranker-assisted retrieval paths are available, while some production-hardening work remains for later phases.

---

## Table of contents

- [Why Scholaxis](#why-scholaxis)
- [Core capabilities](#core-capabilities)
- [Surface preview](#surface-preview)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Usage examples](#usage-examples)
- [Architecture at a glance](#architecture-at-a-glance)
- [Documentation links](#documentation-links)
- [Operations and troubleshooting notes](#operations-and-troubleshooting-notes)
- [Recent changes](#recent-changes)
- [API overview](#api-overview)
- [Support](#support)
- [License](#license)

---

## Why Scholaxis

Scholaxis is optimized around this value chain:

```text
better search
→ better candidate set
→ better expansion
→ better comparison/explanation
```

### Primary product
- query interpretation and source selection
- paper/report/patent/project exploration
- detail pages, recommendations, citations/references, and graph expansion
- next-reading suggestions

### Secondary product
- draft/report uploads
- nearby-document similarity comparison
- overlap and differentiation explanation

In short, Scholaxis is closer to a **research exploration engine** than a generic answer generator.

---

## Core capabilities

### Discovery / search
- unified search UI
- SSE-based streamed search (`/api/search/stream`)
- related-paper expansion
- citations/references/graph lookup
- interest-aware recommendation feed
- multi-source fan-out + deduplication
- BGE-M3 embeddings + sparse retrieval + cross-encoder reranking
- translation-assisted cross-lingual retrieval

### Supported source families
- Semantic Scholar
- arXiv
- RISS
- KCI
- ScienceON
- DBpia
- NTIS
- KIPRIS
- National Science Fair
- National Student Invention Fair
- R&E report board

### Document similarity analysis
- semantic-embedding + section-structure comparison
- PDF / DOCX / HWPX extraction
- best-effort HWP extraction
- OCR fallback pipeline
- multipart upload analysis API
- section-aware comparison
- semantic-diff style highlights

### User / operations features
- SQLite persistence
- PostgreSQL + pgvector migration path
- admin summary / ops / infra / jobs APIs
- local auth / session / profile flow
- library items / share token / highlight metadata
- saved searches / alert metadata
- cache clear / source diagnostics / background scheduling

---

## Surface preview

![Scholaxis surface map](./docs/assets/readme-surfaces.svg)

Instead of embedding unstable real screenshots, this README now includes a **maintainable surface diagram** that shows the implemented pages at a glance.

- `index.html` — main discovery entrypoint
- `results.html` — search and streamed results
- `detail.html` — document detail, recommendations, graph flow
- `similarity.html` — upload and similarity analysis
- `library.html` — saved items and saved searches
- `admin.html` — ops and infrastructure diagnostics

---

## Prerequisites

### Required
- Node.js `>= 20`
- npm

### Optional
- PostgreSQL (when using `SCHOLAXIS_STORAGE_BACKEND=postgres`)
- Local model backend (when using sentence-transformers BGE embeddings / reranker)
- LibreTranslate (when using the `libretranslate` translation backend)
- Tesseract OCR + Poppler (when OCR is required)
- `cloudflared` (for public demos)

### OCR runtime packages
```bash
sudo apt-get update
sudo apt-get install -y tesseract-ocr tesseract-ocr-kor poppler-utils
```

### Local embedding + reranker setup
```bash
# 1) Local sentence-transformers stack (recommended primary path)
python3 -m pip install --user --break-system-packages -r requirements-local-models.txt

export SCHOLAXIS_EMBEDDING_PROVIDER=auto
export SCHOLAXIS_EMBEDDING_MODEL=BAAI/bge-m3
export SCHOLAXIS_RERANKER_PROVIDER=auto
export SCHOLAXIS_RERANKER_MODEL=BAAI/bge-reranker-v2-m3
export SCHOLAXIS_LOCAL_MODEL_AUTOSTART=true
export SCHOLAXIS_VECTOR_DIMS=1024

# 2) Optional Ollama fallback/assist path
export SCHOLAXIS_OLLAMA_URL=http://127.0.0.1:11434
export SCHOLAXIS_OLLAMA_EMBEDDING_MODEL=nomic-embed-text
export SCHOLAXIS_OLLAMA_RERANKER_MODEL=qwen2.5:3b
```

Recommended defaults:
- primary embeddings: `BAAI/bge-m3`
- primary reranker: `BAAI/bge-reranker-v2-m3`
- optional local LLM assist path: Ollama (`nomic-embed-text`, `qwen2.5:3b`)
- when PostgreSQL is enabled, use `SCHOLAXIS_VECTOR_BACKEND=pgvector` for real pgvector search

---

## Quick start

### 1) Install
```bash
npm install
```

### 2) Start the development server
```bash
npm run dev
```

### 3) Run in the normal start mode
```bash
npm start
```

If `PORT` is unset, Scholaxis uses `3000`. If that port is already occupied, the server automatically retries the next ports.

### 4) Run the full verification suite
```bash
npm run verify
```

### 5) Frequently used helper commands
```bash
npm run sync
npm run scheduler
npm run worker
npm run migrate:postgres
npm run translation-service
npm run reranker-service
npm run vector-service
npm run graph-service
npm run typecheck
npm run backup
npm run restore -- <backup-file>
```

### 6) PostgreSQL + pgvector mode
```bash
export SCHOLAXIS_STORAGE_BACKEND=postgres
export SCHOLAXIS_VECTOR_BACKEND=pgvector
export DATABASE_URL=postgres://user:password@localhost:5432/scholaxis
npm run migrate:postgres -- --apply
npm start
```

---

## Usage examples

### Start with live-source fan-out
```bash
SCHOLAXIS_ENABLE_LIVE_SOURCES=true npm start
```

### Run a search request
```bash
curl "http://127.0.0.1:3000/api/search?q=battery%20AI&live=1"
```

### Use streamed search
```bash
curl "http://127.0.0.1:3000/api/search/stream?q=battery%20AI&live=1"
```

### Clear the cache
```bash
curl -X POST "http://127.0.0.1:3000/api/cache/clear"
```

### Schedule infrastructure jobs
```bash
curl -X POST http://127.0.0.1:3000/api/admin/jobs \
  -H 'content-type: application/json' \
  -d '{"action":"schedule-defaults"}'
```

---

## Architecture at a glance

![Scholaxis architecture overview](./docs/assets/readme-architecture.svg)

| Layer | Responsibility | Main files |
| --- | --- | --- |
| Frontend | static pages + same-origin API calls | `public/`, `public/api.js`, `public/site.js` |
| API/BFF | single HTTP entrypoint | `src/server.mjs` |
| Search core | search/ranking/recommendation/graph explanation | `src/search-service.mjs` |
| Source adapters | external source fan-out / fallback | `src/source-adapters.mjs` |
| Similarity | extraction + similarity analysis | `src/similarity-service.mjs` |
| Persistence | SQLite / PostgreSQL integration | `src/storage.mjs` |
| Runtime helpers | translation / reranker / vector / graph / jobs | `src/*runtime*.mjs`, `scripts/` |

Default local store:
- `.data/scholaxis.db`

Stored entities include:
- documents
- search runs
- similarity runs
- graph edges
- request logs
- users / sessions
- library items / saved searches / user preferences

---

## Documentation links

- [Architecture overview](./docs/architecture.md)
- [Deployment guide](./docs/deployment.md)
- [Cloudflared tunnel guide](./docs/cloudflared-tunnel.md)
- [Security notes](./docs/security.md)

---

## Operations and troubleshooting notes

### Useful checks
- `GET /api/health` for runtime health
- `GET /api/sources/status` for source/cache diagnostics
- `GET /api/admin/infra` for translation/reranker/vector/graph diagnostics
- `GET /api/admin/postgres-migration` for PostgreSQL migration readiness

### Common issues
- **Port conflicts**: the server retries the next port automatically.
- **Unstable live sources**: external adapters time out and degrade into partial results.
- **OCR not working**: confirm `tesseract-ocr`, `tesseract-ocr-kor`, and `poppler-utils` are installed.
- **Translation backend not working**: check `SCHOLAXIS_TRANSLATION_*` env vars and service URL/port.
- **Reranker not working**: check `SCHOLAXIS_RERANKER_*` settings and whether `npm run reranker-service` is running.
- **Domestic source access issues**: KIPRIS/DBpia access may depend on API keys, registered IPs, or provider contracts.

### Useful environment variables
<details>
<summary>Expand</summary>

- `SCHOLAXIS_ENABLE_LIVE_SOURCES`
- `SCHOLAXIS_SOURCE_TIMEOUT_MS`
- `SCHOLAXIS_MAX_LIVE_RESULTS_PER_SOURCE`
- `SCHOLAXIS_SOURCE_CACHE_TTL_MS`
- `SEMANTIC_SCHOLAR_API_KEY`
- `DBPIA_API_KEY`
- `KIPRIS_PLUS_API_KEY`
- `KIPRIS_PLUS_SEARCH_URL`
- `KCI_SEARCH_URL`
- `SCIENCEON_SEARCH_URL`
- `SCHOLAXIS_STORAGE_BACKEND`
- `DATABASE_URL`
- `PSQL_BIN`
- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`
- `SCHOLAXIS_TRANSLATION_PROVIDER`
- `SCHOLAXIS_TRANSLATION_HOST`
- `SCHOLAXIS_TRANSLATION_PORT`
- `SCHOLAXIS_TRANSLATION_AUTOSTART`
- `SCHOLAXIS_TRANSLATION_SERVICE_URL`
- `SCHOLAXIS_TRANSLATION_API_KEY`
- `SCHOLAXIS_RERANKER_PROVIDER`
- `SCHOLAXIS_RERANKER_HOST`
- `SCHOLAXIS_RERANKER_PORT`
- `SCHOLAXIS_RERANKER_AUTOSTART`
- `SCHOLAXIS_RERANKER_SERVICE_URL`
- `SCHOLAXIS_RERANKER_API_KEY`
- `SCHOLAXIS_RERANKER_TOP_K`
- `SCHOLAXIS_EMBEDDING_PROVIDER`
- `SCHOLAXIS_EMBEDDING_SERVICE_URL`
- `SCHOLAXIS_EMBEDDING_MODEL`
- `SCHOLAXIS_OLLAMA_URL`
- `SCHOLAXIS_OLLAMA_EMBEDDING_MODEL`
- `SCHOLAXIS_OLLAMA_RERANKER_MODEL`
- `SCHOLAXIS_VECTOR_BACKEND`
- `SCHOLAXIS_GRAPH_BACKEND`
- `SCHOLAXIS_VECTOR_SERVICE_URL`
- `SCHOLAXIS_GRAPH_SERVICE_URL`
- `SCHOLAXIS_SCHEDULER_INTERVAL_MS`
- `SCHOLAXIS_WORKER_POLL_MS`
- `SCHOLAXIS_WORKER_LEASE_MS`

</details>

---

## Recent changes

- query routing now prefers better-fit **source families** before fallback
- crawl source URLs were documented and parameterized via environment config
- the **R&E report** source was added as a searchable source family
- reformulation/fallback cascades were strengthened to reduce zero-result searches
- recommendation/graph/comparison explanations were improved
- translation-assisted cross-lingual retrieval was added
- LibreTranslate autostart support was added for translation runtime bootstrap
- a real reranker service layer and local HTTP reranker path were added
- translation + reranker diagnostics are surfaced through runtime APIs
- saved-search, library sharing, and recommendation-feed user-state features were expanded

---

## API overview

<details>
<summary>Expand key APIs</summary>

### Discovery / search
- `GET /api/health`
- `GET /api/trends`
- `GET /api/search`
- `GET /api/search/stream`
- `GET /api/search/suggestions`
- `GET /api/sources/status`
- `GET /api/papers/:id`
- `GET /api/papers/:id/related`
- `GET /api/papers/:id/expand`
- `GET /api/papers/:id/recommendations`
- `GET /api/papers/:id/citations`
- `GET /api/papers/:id/references`
- `GET /api/papers/:id/graph`

### Similarity / uploads
- `POST /api/similarity/report`
- `POST /api/similarity/analyze`

### Ops / persistence
- `GET /api/storage/stats`
- `POST /api/cache/clear`
- `GET /api/admin/summary`
- `GET /api/admin/ops`
- `GET /api/admin/infra`
- `GET /api/admin/jobs`
- `POST /api/admin/jobs`
- `GET /api/admin/postgres-migration`

### Auth / user state
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/profile`
- `PATCH /api/profile`
- `GET /api/library`
- `POST /api/library`
- `GET /api/library/shared/:shareToken`
- `DELETE /api/library/:canonicalId`
- `GET /api/saved-searches`
- `POST /api/saved-searches`
- `DELETE /api/saved-searches/:id`
- `GET /api/recommendations/feed`

</details>

---

## Support

There is no separately documented official support channel yet.

Recommended workflow:
- handle change proposals through PRs
- collect bugs/questions/ideas through repository issues
- check the `docs/` directory first for operational details

---

## License

This project is distributed under the **Apache License 2.0** (`Apache-2.0`) as documented in the repository-root `LICENSE` file.

If you redistribute or modify the project, keep the required notices and mark your changes as required by Apache 2.0.
