<div align="center">

# Scholaxis

> 한국어 중심 연구 탐색 엔진 · English: [READMEen.md](./READMEen.md)

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Status](https://img.shields.io/badge/status-v0%20prototype-6f42c1?style=flat-square)
![Docs](https://img.shields.io/badge/docs-KO%20%7C%20EN-0ea5e9?style=flat-square)
![Storage](https://img.shields.io/badge/storage-SQLite%20%7C%20PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)

</div>

Scholaxis는 **논문·연구 탐색을 메인 제품**으로 두고, **문서 유사도 분석을 보조 기능**으로 제공하는 한국어 중심 연구 탐색 엔진입니다. 글로벌/국내 학술 자료, 특허, 과제, 과학전람회, 학생 발명 대회, R&E 보고서까지 하나의 웹 애플리케이션에서 탐색하도록 설계되었습니다.

현재 저장소는 **강한 v0 / 엔지니어링 프로토타입** 단계입니다. 핵심 검색 제품은 실제로 동작하고, 라이브 소스 연동·저장·운영 API·추천/그래프·번역/리랭커 경로까지 포함하지만, 일부 생산환경용 마감 작업은 후속 단계로 남아 있습니다.

---

## 목차

- [왜 Scholaxis인가](#왜-scholaxis인가)
- [핵심 기능](#핵심-기능)
- [대표 화면 미리보기](#대표-화면-미리보기)
- [사전 요구사항](#사전-요구사항)
- [빠른 시작](#빠른-시작)
- [사용 예시](#사용-예시)
- [아키텍처 한눈에 보기](#아키텍처-한눈에-보기)
- [문서 링크](#문서-링크)
- [운영/트러블슈팅 메모](#운영트러블슈팅-메모)
- [최근 변경사항](#최근-변경사항)
- [API 개요](#api-개요)
- [지원 안내](#지원-안내)
- [라이선스](#라이선스)

---

## 왜 Scholaxis인가

Scholaxis의 우선순위는 다음과 같습니다.

```text
좋은 검색
→ 좋은 후보군
→ 좋은 확장
→ 좋은 비교/설명
```

### 메인 제품
- 질의 해석과 소스 선택
- 논문/보고서/특허/과제 탐색
- 상세 문서, 추천, 인용·참고문헌·그래프 확장
- 다음에 읽을 자료 추천

### 보조 제품
- 보고서/초안 업로드
- 유사 문서 비교
- 중복/차별점 설명

즉, Scholaxis는 답변 생성기보다 **연구 탐색 엔진**에 더 가깝습니다.

---

## 핵심 기능

### 탐색 / 검색
- 통합 검색 UI
- SSE 기반 스트리밍 검색 (`/api/search/stream`)
- 추천/관련 자료 확장
- 인용/참고문헌/그래프 조회
- 관심사 기반 추천 피드
- 다중 소스 fan-out + deduplication
- 벡터 + sparse + reranker 기반 재정렬
- 번역 기반 교차언어 검색

### 지원 소스 계열
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
- 과학영재 창의연구(R&E) 보고서

### 문서 유사도 분석
- 텍스트 기반 비교
- PDF / DOCX / HWPX 추출
- HWP best-effort 추출
- OCR fallback 파이프라인
- multipart 업로드 분석 API
- 섹션 인식 비교
- semantic diff 스타일 하이라이트

### 사용자 / 운영 기능
- SQLite persistence
- PostgreSQL + pgvector 마이그레이션 경로
- admin summary / ops / infra / jobs API
- 로컬 인증 / 세션 / 프로필
- 라이브러리 저장 / 공유 토큰 / 하이라이트 메타데이터
- 저장 검색 / 저장 검색 알림 메타데이터
- cache clear / source diagnostics / background scheduling

---

## 대표 화면 미리보기

![Scholaxis surface map](./docs/assets/readme-surfaces.svg)

현재 README에는 실제 제품 스크린샷 대신, 유지보수가 쉬운 **화면 구조 다이어그램**을 넣었습니다.
구현된 주요 화면은 다음과 같습니다.

- `index.html` — 메인 탐색 시작점
- `results.html` — 검색 결과/스트리밍 결과 확인
- `detail.html` — 문서 상세, 추천, 그래프 흐름
- `similarity.html` — 문서 업로드/유사도 분석
- `library.html` — 저장 자료/저장 검색
- `admin.html` — 운영 상태/인프라 진단

---

## 사전 요구사항

### 필수
- Node.js `>= 20`
- npm

### 선택
- PostgreSQL (`SCHOLAXIS_STORAGE_BACKEND=postgres` 사용 시)
- LibreTranslate (`libretranslate` 번역 백엔드 사용 시)
- Tesseract OCR + Poppler (`OCR` 필요 시)
- `cloudflared` (외부 데모 공유 시)

### OCR 런타임 준비
```bash
sudo apt-get update
sudo apt-get install -y tesseract-ocr tesseract-ocr-kor poppler-utils
```

---

## 빠른 시작

### 1) 설치
```bash
npm install
```

### 2) 개발 서버 실행
```bash
npm run dev
```

### 3) 프로덕션 방식으로 실행
```bash
npm start
```

기본적으로 `PORT`가 없으면 `3000`을 사용하고, 포트가 이미 점유되어 있으면 다음 포트로 자동 fallback 합니다.

### 4) 전체 검증
```bash
npm run verify
```

### 5) 자주 쓰는 보조 명령
```bash
npm run sync
npm run scheduler
npm run worker
npm run migrate:postgres
npm run translation-service
npm run reranker-service
npm run vector-service
npm run graph-service
npm run backup
npm run restore -- <backup-file>
```

### 6) PostgreSQL + pgvector 모드
```bash
export SCHOLAXIS_STORAGE_BACKEND=postgres
export DATABASE_URL=postgres://user:password@localhost:5432/scholaxis
npm run migrate:postgres -- --apply
npm start
```

---

## 사용 예시

### 라이브 소스 탐색 시작
```bash
SCHOLAXIS_ENABLE_LIVE_SOURCES=true npm start
```

### 검색 API 호출
```bash
curl "http://127.0.0.1:3000/api/search?q=배터리%20AI&live=1"
```

### 스트리밍 검색 호출
```bash
curl "http://127.0.0.1:3000/api/search/stream?q=배터리%20AI&live=1"
```

### 캐시 초기화
```bash
curl -X POST "http://127.0.0.1:3000/api/cache/clear"
```

### 백그라운드 잡 스케줄링
```bash
curl -X POST http://127.0.0.1:3000/api/admin/jobs \
  -H 'content-type: application/json' \
  -d '{"action":"schedule-defaults"}'
```

---

## 아키텍처 한눈에 보기

![Scholaxis architecture overview](./docs/assets/readme-architecture.svg)

| 레이어 | 역할 | 주요 파일 |
| --- | --- | --- |
| Frontend | 정적 페이지 + same-origin API 호출 | `public/`, `public/api.js`, `public/site.js` |
| API/BFF | 단일 HTTP 진입점 | `src/server.mjs` |
| Search Core | 검색/랭킹/추천/그래프 설명 | `src/search-service.mjs` |
| Source Adapters | 외부 소스 fan-out / fallback | `src/source-adapters.mjs` |
| Similarity | 문서 추출 + 유사도 분석 | `src/similarity-service.mjs` |
| Persistence | SQLite / PostgreSQL 연동 | `src/storage.mjs` |
| Runtime Helpers | translation / reranker / vector / graph / jobs | `src/*runtime*.mjs`, `scripts/` |

기본 로컬 저장소:
- `.data/scholaxis.db`

저장 항목 예시:
- documents
- search runs
- similarity runs
- graph edges
- request logs
- users / sessions
- library items / saved searches / user preferences

---

## 문서 링크

- [아키텍처 개요](./docs/architecture.md)
- [배포 가이드](./docs/deployment.md)
- [Cloudflared 터널 가이드](./docs/cloudflared-tunnel.md)
- [보안 메모](./docs/security.md)

---

## 운영/트러블슈팅 메모

### 자주 확인할 것
- `GET /api/health` 로 런타임 상태 확인
- `GET /api/sources/status` 로 소스/캐시 상태 확인
- `GET /api/admin/infra` 로 번역/reranker/vector/graph 진단 확인
- `GET /api/admin/postgres-migration` 로 PostgreSQL 전환 준비 상태 확인

### 흔한 이슈
- **포트 충돌**: 서버는 자동으로 다음 포트로 재시도합니다.
- **라이브 소스 응답 불안정**: 외부 소스는 timeout 후 partial result 로 degrade 됩니다.
- **OCR 미동작**: `tesseract-ocr`, `tesseract-ocr-kor`, `poppler-utils` 설치 여부를 확인하세요.
- **번역 백엔드 미동작**: `SCHOLAXIS_TRANSLATION_*` 환경변수와 서비스 URL/포트를 확인하세요.
- **reranker 미동작**: `SCHOLAXIS_RERANKER_*` 설정과 `npm run reranker-service` 실행 여부를 확인하세요.
- **국내 소스 접근 이슈**: KIPRIS/DBpia 등은 API 키, 등록 IP, 계약 조건의 영향을 받을 수 있습니다.

### 유용한 환경변수
<details>
<summary>펼쳐서 보기</summary>

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
- `SCHOLAXIS_VECTOR_BACKEND`
- `SCHOLAXIS_GRAPH_BACKEND`
- `SCHOLAXIS_VECTOR_SERVICE_URL`
- `SCHOLAXIS_GRAPH_SERVICE_URL`
- `SCHOLAXIS_SCHEDULER_INTERVAL_MS`
- `SCHOLAXIS_WORKER_POLL_MS`
- `SCHOLAXIS_WORKER_LEASE_MS`

</details>

---

## 최근 변경사항

- 검색 질의를 더 적합한 **소스 계열로 먼저 라우팅**한 뒤 fallback 하도록 개선
- **crawl source URL** 을 환경변수로 문서화/파라미터화
- **과학영재 창의연구(R&E) 보고서** 소스를 검색 대상에 추가
- 무검색 결과를 줄이기 위한 **질의 재구성 fallback cascade** 보강
- 논문 관계/비교 설명을 더 잘 보여주는 **추천/그래프/비교 서술** 보강
- 검색 품질 향상을 위한 **번역 기반 교차언어 검색 경로** 추가
- **LibreTranslate 자동 기동** 기반 번역 백엔드 경로 지원
- **reranker 서비스 계층** 및 로컬 HTTP reranker 실행 경로 추가
- 검색 시 **translation + reranker diagnostics** 가 운영 API에 노출되도록 보강
- 저장 검색, 라이브러리 공유, 추천 피드 등 사용자 상태 기능 확장

---

## API 개요

<details>
<summary>주요 API 펼쳐보기</summary>

### 탐색 / 검색
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

## 지원 안내

현재 별도 공식 지원 채널은 문서화되어 있지 않습니다.

권장 흐름:
- 저장소 변경 제안은 PR 기준으로 정리
- 버그/질문/개선 아이디어는 저장소 이슈 기반으로 수집
- 상세 운영 정보는 `docs/` 문서 우선 확인

---

## 라이선스

이 프로젝트는 루트 `LICENSE` 파일에 따라 **Apache License 2.0** (`Apache-2.0`)으로 배포됩니다.

재배포/수정 시에는 Apache 2.0의 고지 및 변경사항 표시 조건을 함께 준수하세요.
