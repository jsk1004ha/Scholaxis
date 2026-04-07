# Scholaxis (한국어 안내)

Scholaxis는 **논문 탐색을 본체**로 두고, **보고서/초안 유사도 분석을 부가기능**으로 제공하는 한국어 중심 연구 탐색 엔진입니다.

이 프로젝트는 다음을 하나의 웹 애플리케이션으로 통합하는 것을 목표로 합니다.

- 글로벌 학술 탐색
- 국내 학술 탐색
- 특허/과제/보고서 탐색
- 과학전람회/학생발명품 사례 탐색
- 문서 업로드 기반 유사도/차별점 분석

현재 저장소는 **강한 1차 공개 버전(v0 / engineering prototype)** 수준이며, 핵심 기능은 실제로 동작하지만 아직 일부 생산환경용 기능은 남아 있습니다.

---

## 1. 프로젝트의 핵심 정체성

Scholaxis의 핵심은 “답변 생성기”가 아니라 **탐색 엔진**입니다.

기본 철학은 다음 순서를 따릅니다.

```text
좋은 검색
→ 좋은 후보군
→ 좋은 확장
→ 좋은 비교/설명
```

즉, 이 프로젝트에서 가장 중요한 것은:
- 질의 해석
- 후보군 수집
- 소스 간 병합
- 관련 자료 확장
- 다음에 읽을 자료 추천

입니다.

유사도 분석은 중요하지만, 어디까지나 **부가 기능**입니다.

---

## 2. 현재 구현된 주요 기능

### 2.1 메인 기능: 연구 탐색

현재 구현됨:
- 통합 검색 화면
- 상세 문서 화면
- 추천/관련 자료 확장
- 다중 외부 소스 fan-out
- 소스 간 deduplication
- 벡터 + sparse 기반 점수화
- 로컬 저장소 기반 문서/검색 기록 저장
- 런타임 상태/소스 상태 진단 API

### 2.2 외부 소스 연동

현재 구현된 live/fallback 어댑터:
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

### 2.3 유사도 분석

현재 구현됨:
- 텍스트 기반 비교
- PDF 추출
- DOCX 추출
- HWPX 추출
- HWP best-effort 추출
- OCR fallback 경로
- multipart 업로드 분석 API

### 2.4 운영 기능

현재 구현됨:
- 런타임 health check
- source 상태 확인
- source cache
- cache clear API
- 강제 refresh 검색
- SQLite 영속 저장
- 백업 / 복구 스크립트
- 관리자 요약 API
- 로컬 인증 / 세션
- 내 라이브러리
- 저장 검색

---

## 3. 현재 아키텍처

### 프론트엔드
정적 페이지는 `public/` 아래에 있습니다.

구성 페이지:
- `index.html` — 메인 탐색 화면
- `results.html` — 검색 결과 화면
- `detail.html` — 문서 상세 화면
- `similarity.html` — 유사도 분석 화면
- `library.html` — 내 라이브러리 / 저장 검색 화면
- `admin.html` — 운영 요약 화면

### 백엔드
주요 서버/서비스 파일:
- `src/server.mjs` — 단일 HTTP 서버
- `src/search-service.mjs` — 검색/랭킹/추천
- `src/source-adapters.mjs` — 외부 소스 어댑터
- `src/dedup-service.mjs` — canonical merge
- `src/vector-service.mjs` — 경량 벡터 스코어링
- `src/similarity-service.mjs` — 유사도 분석
- `src/storage.mjs` — SQLite 저장
- `src/auth-service.mjs` — 로컬 인증/세션

### 저장소
현재는 로컬 SQLite 사용:
- `.data/scholaxis.db`

추가로 구현된 검색/인프라 전환 경로:
- PostgreSQL + pgvector 마이그레이션 SQL 생성
- PostgreSQL `psql` CLI 기반 실제 sync/read 경로
- 전용 vector backend 추상화 (`local/http/pgvector`)
- 전용 graph backend 추상화 (`local/http`)
- 독립 실행형 vector service / graph service
- background job queue
- scheduler / worker 분리 실행 스크립트

저장되는 항목:
- documents
- search_runs
- similarity_runs
- graph_edges
- request_logs
- users
- sessions
- library_items
- saved_searches

---

## 4. 현재 제공 API

### 탐색 / 검색
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

### 유사도 / 업로드 분석
- `POST /api/similarity/report`
- `POST /api/similarity/analyze`

### 운영 / 저장소
- `GET /api/storage/stats`
- `POST /api/cache/clear`
- `GET /api/admin/summary`
- `GET /api/admin/ops`
- `GET /api/admin/infra`
- `GET /api/admin/jobs`
- `POST /api/admin/jobs`
- `GET /api/admin/postgres-migration`

### 인증 / 사용자 기능
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/library`
- `POST /api/library`
- `DELETE /api/library/:canonicalId`
- `GET /api/saved-searches`
- `POST /api/saved-searches`
- `DELETE /api/saved-searches/:id`

---

## 5. 실행 방법

### 기본 실행
```bash
npm start
```

브라우저에서:
- `http://localhost:3000`

### 개발 모드
```bash
npm run dev
```

### 전체 검증
```bash
npm run verify
```

### 배치 / 저장소 운영 스크립트
```bash
npm run sync
npm run scheduler
npm run worker
npm run migrate:postgres
# 설정된 PostgreSQL 대상으로 즉시 적용
npm run migrate:postgres -- --apply
npm run vector-service
npm run graph-service
npm run backup
npm run restore -- <backup-file>
```

### PostgreSQL + pgvector 실사용 모드

이제 Scholaxis는 PostgreSQL을 실제 저장 백엔드로 사용할 수 있습니다.

예시:

```bash
export SCHOLAXIS_STORAGE_BACKEND=postgres
export DATABASE_URL=postgres://user:password@localhost:5432/scholaxis
npm run migrate:postgres -- --apply
npm start
```

현재 PostgreSQL 모드에서 동작하는 항목:
- 문서 / 검색 / 유사도 실행 저장
- 인증 / 세션 / 프로필 / 라이브러리 / 저장 검색 저장
- background job / graph edge 저장
- pgvector용 임베딩 저장 경로

---

## 6. Live source 모드

실제 외부 소스 fan-out을 활성화하려면:

```bash
SCHOLAXIS_ENABLE_LIVE_SOURCES=true npm start
```

지원 환경변수 예시:
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
- `SCHOLAXIS_STORAGE_BACKEND`
- `SCHOLAXIS_VECTOR_BACKEND`
- `SCHOLAXIS_GRAPH_BACKEND`
- `DATABASE_URL`
- `PGHOST`
- `PGPORT`
- `PGDATABASE`
- `PGUSER`
- `PGPASSWORD`
- `PSQL_BIN`
- `SCHOLAXIS_VECTOR_SERVICE_URL`
- `SCHOLAXIS_GRAPH_SERVICE_URL`
- `SCHOLAXIS_SCHEDULER_INTERVAL_MS`
- `SCHOLAXIS_WORKER_POLL_MS`
- `SCHOLAXIS_WORKER_LEASE_MS`
- `SCHOLAXIS_CITATION_EXPANSION_LIMIT`
- `SCHOLAXIS_RECOMMENDATION_CANDIDATE_LIMIT`

---

## 7. OCR / 문서 추출

### 구현된 경로
- 일반 텍스트 입력
- PDF 파싱
- DOCX 파싱
- PDF OCR fallback

### OCR 런타임 설치
스캔형 PDF까지 OCR을 활성화하려면:

```bash
sudo apt-get update
sudo apt-get install -y tesseract-ocr tesseract-ocr-kor poppler-utils
```

OCR 준비 상태는 아래에서 확인 가능:
- `GET /api/health`

---

## 8. 캐시 / 쿼터 보호

현재 구현된 보호 기능:
- source 결과 캐시
- 강제 refresh 검색
- KIPRIS API 우선 + 사이트 직접검색 fallback
- DBpia API 우선 + public search fallback

예시:

```bash
GET /api/search?q=배터리%20AI&live=1
GET /api/search?q=배터리%20AI&live=1&refresh=1
POST /api/cache/clear
```

---

## 9. 파일 리뷰 요약

### 핵심 백엔드
- `src/server.mjs` — 전체 API 진입점
- `src/search-service.mjs` — 검색/랭킹/추천 핵심
- `src/source-adapters.mjs` — 외부 소스 처리
- `src/storage.mjs` — SQLite 저장소
- `src/vector-service.mjs` — 벡터 계산
- `src/dedup-service.mjs` — 중복 병합
- `src/pdf-text-extractor.mjs` — PDF 파서
- `src/docx-text-extractor.mjs` — DOCX 파서
- `src/ocr-service.mjs` — OCR fallback
- `src/auth-service.mjs` — 인증/세션 처리

### 프론트엔드
- `public/site.js` — 브라우저 UI 로직
- `public/api.js` — API 호출층
- `public/*.html` — 화면 진입 페이지
- `public/styles.css` — 공통 스타일

### 운영/유틸리티
- `scripts/sync-sources.mjs`
- `scripts/backup-sqlite.mjs`
- `scripts/restore-sqlite.mjs`
- `scripts/typecheck.mjs`
- `scripts/lint.mjs`
- `scripts/smoke-test.mjs`

---

## 10. 아직 완전히 끝나지 않은 것

### 검색 / 인프라
- 전용 vector DB
- 전용 graph DB
- production scheduler / worker 분리
- citation/reference 고급 확장
- 더 정교한 recommendation 엔진

### 문서 분석
- HWP/HWPX 지원
- 스캔 PDF OCR 전처리 강화
- 섹션 단위 구조 비교 고도화
- 더 정교한 차별점 분석

### 제품 기능
- 더 완성도 높은 라이브러리/auth UI
- 사용자 선호도/프로필
- 협업/공유 기능
- 주석/하이라이트/인용 UX
- 완전한 관리자 대시보드

### 운영
- production observability / alerts
- 시크릿 관리
- 롤백 / 마이그레이션 정교화
- 파서 자동 회귀 감시

---

## 11. 다음 권장 마일스톤

### A. 그래프 인텔리전스 고도화
- graph edge 강화
- author graph
- citation/reference graph
- recommendation reranking

### B. 문서 분석 고도화
- HWP/HWPX 지원
- OCR 품질 개선
- 섹션 기반 비교

### D. 제품화
- 라이브러리 UI polish
- 저장 검색 UX 개선
- auth/session UX polish
- 관리자 대시보드 강화

---

## 12. GitHub 첫 업로드용 설명

이 저장소는 다음 이유로 **1차 공개 / v0 업로드**에 적합합니다.

이미 포함된 것:
- 작동하는 full-stack 앱
- 여러 live-source 연동과 fallback
- 런타임 진단
- persistence
- 테스트 커버리지
- 운영용 helper script

다만 표현은 다음이 적절합니다.

> **production-ready SaaS** 가 아니라,
> **강하게 진전된 연구 탐색 엔진 프로토타입 / pre-production platform**

으로 소개하는 것을 권장합니다.
