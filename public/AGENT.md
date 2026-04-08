# public/AGENTS.md

## Scope

This file applies to everything under `public/`.

This directory contains the user-facing product surfaces of Scholaxis, including:
- search entry and search results
- detail pages
- similarity/upload flows
- library flows
- admin/ops surfaces
- shared frontend logic and styling

The UI must serve the product truth:
Scholaxis is a research discovery engine first.
The UI must help users search, inspect, compare, and continue exploring real materials.

---

## Primary frontend priorities

Always optimize in this order:

1. Usability for all users
2. Clarity of search/detail/similarity flows
3. Source-grounded transparency
4. Reliability of interactions and states
5. Visual polish

If there is a trade-off:
- prefer clearer navigation over clever visuals
- prefer explicit evidence over decorative explanation
- prefer stable detail/similarity behavior over flashy UI additions
- prefer information hierarchy over visual density

---

## Read-before-change order

Before changing frontend behavior, read in this order:

1. root `AGENTS.md`
2. `README.md`
3. the relevant page(s) in `public/`
4. shared frontend scripts such as `api.js`, `site.js`, and related files
5. `docs/architecture.md` if behavior is data-flow sensitive

For major UI work, inspect at minimum:
- `index.html`
- `results.html`
- `detail.html`
- `similarity.html`
- `library.html`
- `admin.html`

---

## Universal usability rule

The UI must be easy for:
- students
- teachers
- non-expert users
- researchers
- users who do not know academic database names

Do not assume the user understands:
- RISS
- KCI
- DBpia
- reranking
- citation graphs
- source fan-out
- semantic retrieval

The UI must help users discover and understand these concepts through design, not force prior knowledge.

---

## Design source

UI style must follow `DESIGN.md`.

If `DESIGN.md` is missing:
- do not invent a conflicting style system
- first create or restore a canonical design document
- keep the design source explicit and easy to find

The design document governs visual style.
This file governs product behavior, usability, and interaction quality.

---

## Global UI rules

### Must always be obvious
- what the user is looking at
- what type of item it is
- which source it came from
- where to click to reach the original source
- how to keep exploring

### Must always be easy
- entering a search
- understanding results
- opening details
- expanding to related materials
- finding source links
- returning to search context
- understanding upload/similarity results

### Must always be explicit
- loading state
- empty state
- degraded state
- source failure state
- partial-result state
- unavailable-link state

Do not hide critical information behind ambiguous icons or vague microcopy.

---

## Search and results page rules

Search and results surfaces are product-critical.

### Search UI must:
- support Korean and English naturally
- make filtering/refinement understandable
- make document type and source visible
- show useful result summaries without pretending to replace detail pages
- preserve a clear path into detail pages
- keep original source access easy

### Results UI must not:
- collapse distinct source types into visually ambiguous cards
- over-emphasize generated text over source-grounded metadata
- hide result identity
- make it hard to tell why a result is relevant

### Results grouping guideline
Where useful, help users distinguish:
- core papers
- Korean academic materials
- reports
- patents
- fair/invention items
- related/recommended materials

Grouping should clarify exploration, not clutter it.

---

## Detail page rules

Detail pages are one of the most important UI surfaces.

### Detail pages must:
- load reliably
- clearly identify the document
- clearly show source and document type
- expose useful metadata
- make original/detail/PDF/video links easy to access
- expose related/recommended/citation/reference/graph sections clearly
- let the user continue exploring without losing context

### Detail page UX rule
Do not treat partially working detail pages as acceptable.

Broken or misleading detail states are product bugs.

### Information hierarchy for detail pages
Prefer this order:
1. title and identity
2. source/type/year and key metadata
3. source links
4. related/recommended/citation/reference/graph exploration
5. explanatory copy and UI extras

Generated explanation should support exploration, not overshadow retrieved evidence.

---

## Similarity/upload page rules

Similarity is a secondary surface, but it must still feel dependable.

### The purpose of the page
The page exists to:
- let users upload a document
- compare it to retrieved materials
- show similar materials
- show overlap and differences
- state clearly when something is effectively the same topic

It does not exist to produce dramatic AI output.

### Similarity UI must:
- make upload states explicit
- make extraction states explicit
- make comparison status explicit
- clearly separate source-grounded matches from generated commentary
- show why a match seems similar
- show difference points clearly
- handle uncertainty honestly

### Similarity UI must not:
- pretend extraction succeeded if it degraded badly
- imply strong certainty from weak evidence
- present “same topic” judgments casually
- bury extraction failures in generic error text

If the flow is flaky or partially working, fix that before extending the page.

---

## Library and admin page rules

### Library
Library pages should help users:
- return to saved materials
- understand what they saved
- distinguish saved documents from saved searches
- reopen exploration quickly
- understand sharing/highlight state if supported

### Admin/ops
Admin pages should prioritize:
- operational clarity
- diagnostics usefulness
- explicit health/degraded states
- clear wording over pretty dashboards

Do not make admin surfaces visually dense but operationally vague.

---

## Frontend data integrity rules

Frontend must not:
- invent source metadata
- display generated text as though it were retrieved evidence
- hide missing source fields without explanation
- collapse uncertain states into false confidence

If a field is missing:
- show a useful fallback
- or hide the field cleanly
- but do not pretend it exists

If a section is degraded:
- make that clear in the UI

---

## Interaction and state rules

All meaningful surfaces must behave predictably under:
- slow requests
- partial source failures
- missing links
- empty results
- delayed graph/recommendation expansion
- failed uploads
- failed extraction
- failed similarity runs

The user should always understand:
- what is happening
- what failed
- what still works
- what they can do next

---

## Accessibility and layout rules

Maintain broad usability:
- readable information hierarchy
- keyboard-reachable major actions where practical
- sufficient contrast and state distinction
- graceful handling of narrow layouts
- no critical action hidden by layout collapse
- no unreadable dense blocks of metadata

Visual cleanliness is good, but clarity is mandatory.

---

## Frontend testing policy

For meaningful frontend changes, verify:
- search start flow
- results rendering
- detail-page rendering
- related/recommendation/citation/reference/graph sections
- upload flow
- similarity-result rendering
- library usability
- admin/ops readability
- loading/empty/error/degraded states
- Korean and English UI content flow where relevant

Also verify with:
- repeated runs
- random-topic searches
- real results
- real source links
- real detail-page navigation

Do not consider a UI change finished after only a single happy-path manual check.

---

## Documentation rules for public changes

When frontend behavior changes, update:
- `README.md`
- `READMEen.md` if needed
- any UI/design docs
- `DESIGN.md` if visual/interaction rules change
- screenshots or diagrams if the repo uses them for explanation

Do not let product docs drift away from actual UI behavior.

---

## What not to do

Do not:
- optimize the UI only for expert users
- make source/type identity harder to see
- replace useful metadata with vague AI summaries
- add visual clutter that weakens exploration
- hide degraded states
- ship partially working detail or similarity flows
- diverge from `DESIGN.md`
- treat visual polish as more important than clarity

---

## Definition of done for public

A frontend task is not done unless:
- non-expert users can understand the flow
- key actions are visible
- source and document type are clear
- detail/similarity surfaces are stable and understandable
- loading/empty/error/degraded states are explicit
- the UI follows `DESIGN.md`
- real search/detail/similarity flows were actually checked