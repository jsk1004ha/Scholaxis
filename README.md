# Scholaxis

Scholaxis is a Korean-first research exploration engine that unifies **paper discovery**, **domestic research search**, **patent/fair expansion**, and **secondary similarity analysis** behind one hosted web app.

This repository is currently at a **strong 1st release / engineering prototype** stage: the main search product works, multiple live-source adapters are implemented, persistence exists, and operational APIs are in place — but some roadmap items are still intentionally unfinished for a later production phase.

---

## 1. Product definition

Scholaxis is designed around this order of value:

```text
better search
→ better candidate set
→ better expansion
→ better comparison/explanation
```

The **main product** is research discovery.

The **secondary product** is document/report similarity analysis.

That means the system is optimized first for:
- finding relevant papers
- expanding them into related domestic/global research
- connecting papers to patents/reports/fair entries
- surfacing next-reading candidates

and only secondarily for:
- uploading a draft/report
- comparing it to nearby prior work
- explaining overlap and differentiation

---

## 2. What is implemented now

### 2.1 Main search/discovery product

Implemented:
- unified search UI
- detail page
- recommendation/related expansion
- live-source fan-out
- deduplication
- vector + sparse retrieval signals
- local persistence
- runtime diagnostics

### 2.2 Supported source families

Implemented live or fallback adapters:
- Semantic Scholar
- arXiv
- RISS
- KCI
- ScienceON
- DBpia
- NTIS
- KIPRIS
- 전국과학전람회
- 전국학생과학발명품경진대회

### 2.3 Similarity / document analysis

Implemented:
- text similarity analysis
- PDF extraction
- DOCX extraction
- OCR fallback pipeline
- multipart upload analysis endpoint

### 2.4 Operational features

Implemented:
- runtime health diagnostics
- source status diagnostics
- in-memory source cache
- cache clear API
- force-refresh search
- SQLite persistence
- backup / restore scripts
- admin summary API
- local auth / session flow
- library items
- saved searches

---

## 3. Current architecture

### Frontend
- static pages in `public/`
- same-origin API usage via `/api/*`
- pages:
  - `index.html`
  - `results.html`
  - `detail.html`
  - `similarity.html`
  - `library.html`
  - `admin.html`

### Backend
- single Node server in `src/server.mjs`
- source adapters in `src/source-adapters.mjs`
- retrieval / ranking in `src/search-service.mjs`
- dedup in `src/dedup-service.mjs`
- vector logic in `src/vector-service.mjs`
- similarity in `src/similarity-service.mjs`
- persistence in `src/storage.mjs`

### Persistence
- local SQLite database at:
  - `.data/scholaxis.db`

Stored entities include:
- documents
- search runs
- similarity runs
- graph edges
- request logs
- users
- sessions
- library items
- saved searches

---

## 4. Implemented APIs

### Core discovery
- `GET /api/health`
- `GET /api/trends`
- `GET /api/search`
- `GET /api/search/suggestions`
- `GET /api/sources/status`
- `GET /api/papers/:id`
- `GET /api/papers/:id/related`
- `GET /api/papers/:id/expand`
- `GET /api/papers/:id/recommendations`
- `GET /api/papers/:id/citations`
- `GET /api/papers/:id/references`
- `GET /api/papers/:id/graph`

### Similarity / upload analysis
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

### Local auth / user state
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/profile`
- `PATCH /api/profile`
- `GET /api/library`
- `POST /api/library`
- `DELETE /api/library/:canonicalId`
- `GET /api/saved-searches`
- `POST /api/saved-searches`
- `DELETE /api/saved-searches/:id`

---

## 5. Runtime and scripts

### Start
```bash
npm start
```

### Development
```bash
npm run dev
```

### Verify
```bash
npm run verify
```

### Batch / storage ops
```bash
npm run sync
npm run backup
npm run restore -- <backup-file>
```

---

## 6. Live source mode

Live source fan-out is available and can be enabled with:

```bash
SCHOLAXIS_ENABLE_LIVE_SOURCES=true npm start
```

Useful environment variables:
- `SEMANTIC_SCHOLAR_API_KEY`
- `DBPIA_API_KEY`
- `KIPRIS_PLUS_API_KEY`
- `KIPRIS_PLUS_SEARCH_URL`
- `KCI_SEARCH_URL`
- `SCIENCEON_SEARCH_URL`
- `SCHOLAXIS_SOURCE_TIMEOUT_MS`
- `SCHOLAXIS_MAX_LIVE_RESULTS_PER_SOURCE`
- `SCHOLAXIS_SOURCE_CACHE_TTL_MS`
- `SCHOLAXIS_DB_PATH`
- `SCHOLAXIS_USER_AGENT`

---

## 7. OCR / extraction

### Implemented extraction paths
- text body input
- PDF parsing
- DOCX parsing
- OCR fallback for PDFs

### OCR runtime requirements
To enable real OCR for scanned PDFs:

```bash
sudo apt-get update
sudo apt-get install -y tesseract-ocr tesseract-ocr-kor poppler-utils
```

The server reports OCR readiness in:
- `GET /api/health`

---

## 8. Cache / quota protection

Implemented protections:
- source result caching
- force-refresh search
- KIPRIS API-first + site-search fallback
- DBpia API-first + public-search fallback

Examples:

```bash
GET /api/search?q=배터리%20AI&live=1
GET /api/search?q=배터리%20AI&live=1&refresh=1
POST /api/cache/clear
```

---

## 9. File review summary

### Core backend files
- `src/server.mjs` — main HTTP server + route orchestration
- `src/search-service.mjs` — ranking/search/recommendation flow
- `src/source-adapters.mjs` — external source connectors and fallbacks
- `src/storage.mjs` — SQLite persistence
- `src/vector-service.mjs` — lightweight vector scoring
- `src/dedup-service.mjs` — canonical merge logic
- `src/pdf-text-extractor.mjs` — PDF text extraction
- `src/docx-text-extractor.mjs` — DOCX text extraction
- `src/ocr-service.mjs` — OCR fallback
- `src/auth-service.mjs` — local auth/session helpers

### Frontend files
- `public/site.js` — browser behavior layer
- `public/api.js` — API client layer
- `public/*.html` — page shells
- `public/styles.css` — shared styling

### Ops files
- `scripts/sync-sources.mjs`
- `scripts/backup-sqlite.mjs`
- `scripts/restore-sqlite.mjs`
- `scripts/typecheck.mjs`
- `scripts/lint.mjs`
- `scripts/smoke-test.mjs`

---

## 10. What is still not fully implemented

These are the major remaining roadmap items.

### Search / infra
- full PostgreSQL + pgvector migration
- dedicated vector DB
- dedicated graph DB
- production scheduler/worker separation
- advanced citation/reference expansion from primary citation APIs
- stronger recommendation modeling beyond stored similar edges

### Document analysis
- HWP/HWPX support
- higher-quality scanned PDF OCR preprocessing
- richer section-level structural comparison
- stronger plagiarism-adjacent overlap explanation controls

### Product features
- polished library/auth UI
- user profiles/preferences
- collaboration / sharing
- notes/highlights/citation export UX
- full admin dashboard UI

### Operations
- production observability / structured logs / alerts
- deployment-specific secrets management
- rollback/migration tooling
- source parser auto-regression monitoring

---

## 11. Recommended next milestones

### Milestone A
Production data foundation
- move SQLite → PostgreSQL
- add pgvector
- migrate search/storage APIs

### Milestone B
Research graph intelligence
- richer graph edges
- author graph
- citation/reference graph
- recommendation reranking

### Milestone C
Document intelligence
- HWP/HWPX ingestion
- OCR improvement
- section-aware comparison

### Milestone D
User productization
- polished library UI
- saved search UX
- auth/session management polish
- admin dashboard

---

## 12. Release note for GitHub first push

This repository is suitable for a **v0 / first public engineering push** because it already contains:
- a working full-stack app
- live-source integrations and fallbacks
- runtime diagnostics
- persistence
- test coverage
- operational helper scripts

But it should still be presented as:

> **an advanced research-discovery prototype / pre-production platform**

not as a fully finished production SaaS.
