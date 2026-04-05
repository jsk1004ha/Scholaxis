export const seedCatalog = [
  {
    id: 'seed-paper-ko-energy-ai',
    canonicalId: 'seed-paper-ko-energy-ai',
    type: 'paper',
    source: 'kci',
    title: '차세대 배터리 열폭주 예측을 위한 멀티모달 AI 진단 프레임워크',
    englishTitle: 'Multimodal AI Diagnostics for Next-Generation Battery Thermal Runaway Prediction',
    authors: ['김서연', '박준호', '이은채'],
    organization: 'KAIST 배터리 AI 융합연구실',
    sourceLabel: 'KCI',
    year: 2025,
    citations: 118,
    openAccess: true,
    region: 'domestic',
    language: 'ko',
    keywords: ['배터리', '열폭주', '센서융합', '예측정비', '딥러닝'],
    abstract:
      '국내 제조 라인의 실시간 센서, 적외선 영상, 운전 이력을 결합해 배터리 열폭주 징후를 조기 탐지하는 한국형 AI 진단 체계를 제안한다.',
    summary: '센서와 영상 데이터를 결합해 배터리 이상 징후를 빠르게 탐지하는 국내 대표 연구입니다.',
    novelty: '생산 설비 로그와 적외선 이미지를 동시에 사용하는 현장형 추론 파이프라인을 제시합니다.',
    methods: ['Transformer', '그래프 특징 추출', '실시간 알림'],
    highlights: ['산업 현장 적용', '국내 데이터셋', '설비 안전성'],
    links: {
      detail: 'https://www.kci.go.kr/kciportal/main.kci',
      original: 'https://www.kci.go.kr/kciportal/main.kci'
    }
  },
  {
    id: 'seed-paper-ko-semiconductor',
    canonicalId: 'seed-paper-ko-semiconductor',
    type: 'paper',
    source: 'dbpia',
    title: '설명가능 AI 기반 반도체 결함 분석과 공정 최적화',
    englishTitle: 'Explainable AI for Semiconductor Defect Analysis and Process Optimization',
    authors: ['최민재', '정하늘'],
    organization: '성균관대학교 지능형반도체연구센터',
    sourceLabel: 'DBpia',
    year: 2024,
    citations: 73,
    openAccess: false,
    region: 'domestic',
    language: 'ko',
    keywords: ['반도체', '설명가능AI', '결함분석', '공정최적화', '비전'],
    abstract:
      '웨이퍼 이미지와 공정 로그를 함께 분석해 반도체 결함 원인을 설명 가능한 형태로 제시하고 공정 조건 조정을 지원한다.',
    summary: '반도체 결함의 원인 설명과 공정 개선 제안을 동시에 제공하는 산업형 연구입니다.',
    novelty: '설명가능성 지표를 공정 엔지니어 워크플로우에 직접 연결합니다.',
    methods: ['Vision Transformer', 'SHAP', '룰 기반 추천'],
    highlights: ['제조 현장 적용', '설명가능성', '품질 개선'],
    links: {
      detail: 'https://www.dbpia.co.kr/search/',
      original: 'https://www.dbpia.co.kr/search/'
    }
  },
  {
    id: 'seed-paper-global-quantum',
    canonicalId: 'seed-paper-global-quantum',
    type: 'paper',
    source: 'arxiv',
    title: 'Quantum Neural Architectures for Multimodal Scholarly Graph Retrieval',
    englishTitle: 'Quantum Neural Architectures for Multimodal Scholarly Graph Retrieval',
    authors: ['Eleanor Park', 'Sung-min Lee'],
    organization: 'SNU AI Convergence / Oxford Visiting Lab',
    sourceLabel: 'arXiv',
    year: 2025,
    citations: 141,
    openAccess: true,
    region: 'global',
    language: 'en',
    keywords: ['knowledge graph', 'retrieval', 'quantum-inspired', 'multimodal', 'vector similarity'],
    abstract:
      'This paper studies quantum-inspired retrieval layers for graph-aware scholarly search, combining citation signals, dense vectors, and multimodal metadata.',
    summary: '학술 그래프와 벡터 검색을 결합한 차세대 검색 엔진 설계에 적합한 글로벌 논문입니다.',
    novelty: '인용 그래프와 멀티모달 임베딩을 동시에 랭킹에 반영합니다.',
    methods: ['Hybrid ranking', 'Dense retrieval', 'Citation graph'],
    highlights: ['Open access', 'Retrieval infra', 'Similarity search'],
    links: {
      detail: 'https://info.arxiv.org/help/api/user-manual.html',
      original: 'https://arxiv.org/'
    }
  },
  {
    id: 'seed-paper-global-climate',
    canonicalId: 'seed-paper-global-climate',
    type: 'paper',
    source: 'semantic_scholar',
    title: 'Climate Risk Knowledge Distillation for Public Policy Research',
    englishTitle: 'Climate Risk Knowledge Distillation for Public Policy Research',
    authors: ['Maya Chen', 'Luis Ortega'],
    organization: 'ETH Policy Intelligence Lab',
    sourceLabel: 'Semantic Scholar',
    year: 2023,
    citations: 206,
    openAccess: true,
    region: 'global',
    language: 'en',
    keywords: ['climate', 'policy', 'knowledge distillation', 'forecasting', 'public research'],
    abstract:
      'A policy-oriented retrieval and summarization workflow that distills large climate risk models into research-ready evidence bundles.',
    summary: '정책 연구와 근거 요약 워크플로우를 함께 다루는 기후 리스크 연구입니다.',
    novelty: '대형 예측 모델 결과를 정책 연구자가 이해하기 쉬운 근거 묶음으로 축약합니다.',
    methods: ['Distillation', 'Scenario ranking', 'Evidence summarization'],
    highlights: ['Policy-ready', 'Forecast evidence', 'Open dataset'],
    links: {
      detail: 'https://www.semanticscholar.org/product/api',
      original: 'https://www.semanticscholar.org/'
    }
  },
  {
    id: 'seed-patent-ko-edge-medical',
    canonicalId: 'seed-patent-ko-edge-medical',
    type: 'patent',
    source: 'kipris',
    title: '엣지 컴퓨팅 기반 의료영상 실시간 판독 보조 시스템',
    englishTitle: 'Edge-Assisted Real-Time Medical Imaging Support System',
    authors: ['메디코어 주식회사'],
    organization: '메디코어',
    sourceLabel: 'KIPRIS',
    year: 2022,
    citations: 19,
    openAccess: false,
    region: 'domestic',
    language: 'ko',
    keywords: ['의료영상', '엣지컴퓨팅', '실시간판독', '진단보조'],
    abstract: '의료 영상 장비 가까이에 추론 노드를 배치하여 지연 시간을 줄이는 엣지 기반 판독 보조 특허.',
    summary: '실시간 추론과 프라이버시 요구를 동시에 만족시키는 의료 AI 특허입니다.',
    novelty: '현장 장비 인접 추론으로 개인정보 이동을 최소화합니다.',
    methods: ['Edge inference', 'Latency control'],
    highlights: ['Low latency', 'Privacy aware'],
    links: {
      detail: 'https://www.kipris.or.kr/',
      original: 'https://www.kipris.or.kr/'
    }
  },
  {
    id: 'seed-report-ko-bio',
    canonicalId: 'seed-report-ko-bio',
    type: 'report',
    source: 'ntis',
    title: '국가 바이오 파운드리 전략과 연구 인프라 투자 방향',
    englishTitle: 'National Biofoundry Strategy and R&D Infrastructure Investment',
    authors: ['한국과학기술기획평가원'],
    organization: 'KISTEP',
    sourceLabel: 'NTIS',
    year: 2025,
    citations: 11,
    openAccess: true,
    region: 'domestic',
    language: 'ko',
    keywords: ['바이오', '정책', '인프라', '로드맵', 'R&D'],
    abstract: '국가 차원의 바이오 파운드리 구축 전략과 연구 장비, 데이터 표준화, 인력 양성 로드맵을 정리한 보고서.',
    summary: '정책/투자 관점에서 연구 주제 확장성을 확인할 수 있는 보고서입니다.',
    novelty: '연구 인프라 투자 판단에 필요한 로드맵과 KPI를 제시합니다.',
    methods: ['정책 비교', '로드맵 설계'],
    highlights: ['정책 적합성', '투자 로드맵'],
    links: {
      detail: 'https://www.ntis.go.kr/ThSearchProjectList.do',
      original: 'https://www.ntis.go.kr/'
    }
  },
  {
    id: 'seed-fair-student-energy',
    canonicalId: 'seed-fair-student-energy',
    type: 'fair_entry',
    source: 'student_invention_fair',
    title: '태양에너지를 이용한 휴대용 전압 공급장치',
    englishTitle: 'Portable Voltage Supply Powered by Solar Energy',
    authors: ['이호수'],
    organization: '전국학생과학발명품경진대회',
    sourceLabel: '학생발명품경진대회',
    year: 2001,
    citations: 0,
    openAccess: true,
    region: 'domestic',
    language: 'ko',
    keywords: ['태양에너지', '휴대용 전원', '발명품'],
    abstract: '학생 발명품 사례로 태양에너지를 활용한 휴대용 전압 공급장치를 소개한다.',
    summary: '학생 발명·아이디어 탐색 축을 대표하는 사례입니다.',
    novelty: '학생 작품 기반의 실용 문제 해결 아이디어를 보여줍니다.',
    methods: ['발명품 설계'],
    highlights: ['학생 발명', '실용 아이디어'],
    links: {
      detail: 'https://www.science.go.kr/mps/1075/bbs/424/moveBbsNttList.do',
      original: 'https://www.science.go.kr/mps/1075/bbs/424/moveBbsNttList.do'
    }
  }
];

export const trendingTopics = [
  '초전도체',
  'AI 반도체 설계',
  '배터리 안전성',
  '양자 암호',
  '디지털 트윈',
  '바이오 파운드리',
  '학생 발명 아이디어',
  '국가 R&D 보고서'
];
