# AGENTS.md

## Project identity

Scholaxis is a Korean-first research discovery engine.

Its main product is:
- search and exploration across papers, theses, reports, patents, science fair entries, student invention entries, and R&E reports
- strong retrieval, useful detail pages, recommendation, citation/reference expansion, and graph-assisted exploration

Its secondary product is:
- uploaded-document similarity analysis
- finding similar materials
- explaining overlap and differences
- clearly stating when a topic is effectively the same

This repository is not a generic chat product.
Do not optimize it like a chatbot.
Optimize it like a retrieval-heavy, source-grounded research discovery product.

Search is the product.
Everything else supports search.

---

## Absolute priorities

Always optimize in this order:

1. Retrieval quality
2. Source-grounded correctness
3. UI usability and clarity
4. Reliability, stability, and observability
5. Maintainability and extensibility

If there is a trade-off:
- prefer better search over more generated text
- prefer better evidence over prettier explanation
- prefer fixing broken detail/similarity flows over adding new surface features
- prefer stable source-grounded behavior over speculative “AI magic”

---

## Current product reality

Treat Scholaxis as a strong v0 / engineering prototype with real working search surfaces, real source fan-out, and real product value, but still requiring hardening.

The main product already includes:
- unified search
- streaming results
- related/recommendation expansion
- citation/reference/graph views
- hybrid retrieval
- cross-lingual search
- multi-source exploration

The secondary product already includes:
- document upload
- extraction
- similarity analysis
- section-aware comparison intent

Your job is not to reimagine the project into something else.
Your job is to strengthen, complete, and harden what Scholaxis is supposed to be.

---

## Read-first order

Before making meaningful changes, read in this order:

1. `README.md`
2. `READMEen.md` if needed
3. `docs/architecture.md` and other relevant docs under `docs/`
4. `package.json`
5. the relevant modules in `src/`
6. the relevant pages/assets in `public/`
7. relevant scripts under `scripts/`
8. existing tests in `tests/`

Do not make large architectural or product-direction changes before reading these.

---

## Repository structure and how to think about it

### Root directories

- `cloudflared/`
  - tunnel/exposure/deployment helper materials
  - do not modify casually without checking deployment implications

- `docs/`
  - architecture, deployment, security, and technical references
  - treat docs here as part of the source of truth
  - update them when runtime or architectural behavior changes

- `public/`
  - static UI surfaces
  - user-facing pages and frontend scripts
  - includes search, results, detail, similarity, library, and admin surfaces
  - UI/UX changes here must preserve exploration clarity

- `scripts/`
  - operational and helper scripts
  - prefer using or extending scripts here instead of adding ad hoc commands elsewhere

- `src/`
  - core backend and domain logic
  - search, ranking, source integration, storage, similarity, graph, jobs, and support services live here
  - most product-critical changes happen here

- `stitch/`
  - auxiliary project area
  - inspect before changing
  - do not assume it is dead or disposable without evidence

- `tests/`
  - API, smoke, and regression-oriented validation assets
  - if a change matters, add or improve validation here

### Important conceptual areas

Treat these as first-class product subsystems:

1. search and retrieval
2. source adapters and provenance
3. ranking and reranking
4. detail-page data assembly
5. graph/citation expansion
6. document extraction and similarity
7. persistence and migrations
8. diagnostics and background work

---

## Search rules

Search is the main product and must dominate engineering decisions.

### Core rule
Do not compensate for weak retrieval with shallow generated explanations.

Improve search in this order:
1. better query handling
2. better retrieval
3. better ranking/reranking
4. better deduplication
5. better expansion
6. better explanation

### Required search behavior
A good change must preserve or improve:
- Korean query performance
- English query performance
- Korean ↔ English cross-lingual discovery
- broad-topic recall
- narrow-topic precision
- exact-title query behavior
- source fan-out quality
- recommendation usefulness
- citation/reference usefulness
- result explainability

### Retrieval stack rule
Do not collapse the search system into one simplistic retrieval path.

Preserve or improve:
- lexical retrieval
- sparse retrieval
- dense semantic retrieval
- reranking
- translation-backed cross-lingual retrieval
- source-specific retrieval paths
- graph/citation-aware expansion

### Strong anti-hardcoding rule
Do **not** solve topic coverage primarily by expanding hardcoded topic lists.

Hardcoded topic classification is allowed only for:
- explicit source routing
- explicit document-type routing
- obvious user filters
- exact-title or exact-keyword special handling
- stable parser/source quirks
- safe fallbacks

Hardcoded topic taxonomies must **not** become the main strategy for open-domain academic discovery.

For topic understanding, prefer:
- embeddings
- hybrid retrieval
- reranking
- cross-lingual normalization
- query rewriting
- source-grounded expansion

### Model usage rule for search
If local/free models are used, they must materially improve retrieval quality.

Use models for practical retrieval tasks such as:
- embeddings
- reranking
- query expansion
- query rewriting
- multilingual normalization

Do not add model complexity that does not measurably improve:
- retrieval quality
- ranking quality
- cross-lingual usefulness
- similarity quality

### Current search-improvement guideline
The current system already intends to use hybrid retrieval and local model support.
When modifying this area:
- strengthen generalized retrieval, not brittle rules
- preserve or improve BGE-M3-class embedding behavior
- preserve or improve reranker effectiveness
- keep source fan-out and deduplication robust
- prefer measurable gains over architectural churn

---

## Source and provenance rules

Every displayed result must be traceable to a real source and real source URL.

Never:
- fabricate records
- fabricate citations
- fabricate source metadata
- present generated text as if it were retrieved evidence
- over-merge records with weak evidence

When normalizing or deduplicating:
- preserve source-specific IDs
- preserve canonical IDs
- preserve original links
- preserve detail links
- preserve PDF links where available
- preserve video links where available
- preserve raw payloads when useful for debugging

If confidence is weak:
- keep records separate
- expose uncertainty
- do not silently merge

### Supported source families must remain first-class
- global academic
- Korean academic
- Korean technology / outcomes
- Korean exploration / invention

Do not accidentally bias the system toward only one source family.

---

## Detail page rules

Detail pages are core product surfaces.
They are not optional polish.

### Detail pages must:
- load reliably
- show the correct document identity
- show clear source and document type
- expose useful metadata
- expose original source links
- expose detail/PDF/video links when available
- expose related/recommendation/citation/reference/graph material when available
- allow users to continue exploration without losing context

### Detail pages must not:
- display empty panels as if they contain real data
- silently swallow source failures
- hide degraded states
- confuse generated explanation with source-grounded evidence

### Detail-page data priority
When deciding what belongs on the page, prioritize:
1. source-grounded metadata
2. source links
3. citation/reference/graph expansion
4. related/recommendation usefulness
5. explanatory copy

Generated summaries should support exploration, not replace evidence.

### Detail-page implementation guideline
If detail behavior is partially broken, fix that before adding more features or styling.

---

## Document extraction and similarity rules

Similarity is a secondary feature, but it must still be reliable and useful.

### The actual goal
The goal is:
- find similar materials
- explain overlap
- explain differences
- clearly state when something is effectively the same topic

The goal is not:
- flashy AI wording
- unsupported confidence
- pretending weak extraction is acceptable
- plagiarism theater

### Supported document paths
Preserve and improve:
- text input
- PDF
- DOCX
- HWPX
- HWP
- OCR fallback

### Extraction rules
When improving extraction:
- preserve structure when possible
- preserve section boundaries when possible
- preserve meaningful table text when possible
- improve extraction quality before adding more explanation layers
- document known limitations explicitly

### Similarity rules
Similarity outputs must:
- be grounded in retrieved materials
- not overclaim
- clearly mark effectively same-topic cases
- clearly describe meaningful differences
- stay conservative when extraction or matching confidence is weak

If the upload/similarity flow is flaky, incomplete, or partially working, treat that as a product bug.

---

## UI rules

### Universal usability principle
The UI must be convenient for:
- students
- teachers
- researchers
- non-expert users
- users unfamiliar with academic databases

Do not design as if the user already knows what RISS, KCI, OpenAlex, reranking, or citation graph means.

### Design source
UI style must follow `DESIGN.md`.

If `DESIGN.md` does not exist yet:
- create or restore a canonical design document before major UI redesign work
- do not invent a conflicting style system across files
- keep the canonical design source explicit and easy to find

### UI behavior expectations
- major actions must be obvious
- labels must be clearer than jargon where possible
- source name and document type must be obvious
- users should move smoothly from search → result → detail → expansion → source
- loading/empty/error/degraded states must be explicit
- mobile and narrow layouts must remain usable
- partially working interactions are bugs, not acceptable compromises

### UI review rule
Do not ship UI that looks cleaner but makes exploration harder.
Utility beats aesthetics when they conflict.

---

## Testing rules

Testing must be repeated, real, and broad.

Do not trust one green run.
Do not trust one successful query.
Do not trust one happy-path UI click.

### Mandatory testing categories

#### 1. Repeated tests
Run the same class of behavior multiple times.
Check for:
- flaky ranking
- flaky parsing
- intermittent missing panels
- intermittent API failure
- unstable similarity output
- unstable detail-page rendering

#### 2. Random-topic tests
Use random topics outside the current development focus.
Examples:
- biology
- chemistry
- earth science
- materials
- robotics
- transportation
- education
- climate
- Korean science fair style topics
- student invention topics

The system must not only work for the currently discussed domain.

#### 3. Real-result verification
Inspect actual returned results and verify:
- title correctness
- source correctness
- type correctness
- date/year plausibility
- link correctness
- metadata consistency

#### 4. Real-data comparison
Compare results with actual source pages or actual source data.
Confirm:
- the item truly exists
- metadata is not obviously wrong
- ranking is plausible
- deduplication did not merge unrelated records
- source-specific expansion is believable

#### 5. Critical regression checks
Always include checks for:
- Korean queries
- English queries
- mixed-language queries
- broad queries
- narrow technical queries
- exact-title queries
- source-filtered queries
- detail pages
- recommendation/citation/reference/graph expansion
- upload/similarity end-to-end

### Similarity-specific verification
For similarity work, verify:
- upload works
- extraction works
- chunking/sectioning works
- similar items are genuinely similar
- unrelated items are not falsely matched
- differences are useful
- same-topic cases are stated clearly
- uncertainty is not overstated

---

## Commands and validation

Use the real repo commands where relevant.

Common commands include:
- `npm run dev`
- `npm start`
- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run smoke`
- `npm run verify`
- `npm run sync`
- `npm run scheduler`
- `npm run worker`
- `npm run migrate:postgres`
- `npm run translation-service`
- `npm run reranker-service`
- `npm run vector-service`
- `npm run graph-service`
- `npm run backup`
- `npm run restore -- <backup-file>`

Use the smallest realistic command set that truly validates the change, but do not skip real validation.

---

## Documentation rules

Whenever behavior changes, update:
- `README.md`
- `READMEen.md` if needed
- `.env.example`
- relevant docs under `docs/`
- setup/run instructions
- migration instructions
- troubleshooting notes when behavior changes

Do not leave stale docs.

If a design system is required for UI work, ensure `DESIGN.md` exists and remains current.

---

## What not to do

Do not:
- optimize only one source family
- optimize only one topic family
- expand brittle hardcoded topic taxonomies as a primary search strategy
- weaken retrieval quality to add more LLM behavior
- ship broken or half-working detail pages
- ship broken or half-working similarity flows
- hide uncertainty
- rely only on mocked success
- consider one successful run sufficient
- treat generated explanation as equivalent to retrieved evidence

---

## Definition of done

A task is not done unless all relevant conditions are satisfied.

### For search/data tasks
- retrieval quality is preserved or improved
- repeated tests were run
- random-topic tests were run
- real-result verification was performed
- comparison against real source data was performed
- deduplication/provenance remained sound
- detail and expansion links still work

### For detail-page tasks
- detail pages load reliably
- key metadata is present
- links are usable
- related/recommendation/citation/reference/graph behavior works
- degraded states are explicit and acceptable

### For similarity tasks
- upload works end-to-end
- extraction is materially reliable
- similar materials are actually similar
- differences are clearly described
- effectively same topics are stated clearly
- uncertainty is not overstated

### For UI tasks
- non-expert users can navigate the flow
- important actions are visible
- source/document types are clear
- UI follows `DESIGN.md`
- clarity and usability are preserved or improved

### For infra/storage tasks
- migrations are real and repeatable
- services start correctly
- persistence is verified
- search still works on real data
- docs and run instructions are updated

---

## Preferred working mindset

Work like a retrieval engineer, a product-minded maintainer, and a skeptical evaluator.

That means:
- verify with real data
- distrust shallow success signals
- test broadly and repeatedly
- protect retrieval quality
- preserve source grounding
- improve real usefulness
- finish changes with verification, not just implementation