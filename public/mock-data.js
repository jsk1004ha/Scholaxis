export const mockPapers = [
  {
    id: 'paper-ai-semiconductor-2025',
    title: 'AI 반도체 설계 자동화를 위한 멀티모달 연구 탐색 프레임워크',
    subtitle: 'A Multimodal Exploration Framework for AI Semiconductor Design Automation',
    authors: ['김지훈', '이서연', '박민재'],
    affiliation: '서울대학교 AI Convergence Lab',
    year: 2025,
    source: 'KCI · 한국정보과학회논문지',
    sourceType: '논문',
    openAccess: true,
    badge: 'KCI',
    region: '국내',
    summary:
      '국내외 반도체 설계 자동화 연구를 연결해 회로 최적화, EDA 파이프라인, 특허 동향을 한 번에 탐색할 수 있도록 구성한 연구 탐색 프레임워크를 제안합니다.',
    abstract:
      '본 연구는 AI 반도체 설계 자동화 분야에서 논문, 특허, 과제 데이터를 통합 탐색하기 위한 멀티소스 연구 탐색 엔진을 제안한다. 자연어 질의에서 연구 의도를 추론하고, 국내 연구 우선순위를 유지하면서 글로벌 레퍼런스를 함께 제시해 연구 공백과 후속 아이디어를 식별한다.',
    tags: ['AI 반도체', 'EDA', '국내 우선', '연구 탐색'],
    metrics: {
      citations: 128,
      references: 36,
      impact: '4.8',
      velocity: '상승',
    },
    insight:
      '국내 NTIS 과제와 KCI 논문이 강하게 연결되며, 특허 문헌과의 교집합이 빠르게 증가 중입니다.',
    matches: 91,
    related: ['paper-quantum-graph-2024', 'paper-innovation-kipris-2025'],
  },
  {
    id: 'paper-quantum-graph-2024',
    title: 'Quantum Neural Architectures for Scholarly Knowledge Graph Expansion',
    subtitle: '학술 지식 그래프 확장을 위한 양자 신경 아키텍처',
    authors: ['Sung-min Lee', 'Ji-hoon Kim'],
    affiliation: 'SNU Department of AI Convergence',
    year: 2024,
    source: 'SCI-E · Journal of Scholarly Intelligence',
    sourceType: '논문',
    openAccess: true,
    badge: 'SCI-E',
    region: '해외',
    summary:
      '지식 그래프 상에서 논문 영향 관계를 추적해 후속 연구와 특허 연결성을 시각화합니다.',
    abstract:
      'The study introduces a graph-expansion workflow that maps scholarly influence across papers, patents, and project awards while preserving explainability for expert reviewers.',
    tags: ['Knowledge Graph', 'SCI-E', 'Citations'],
    metrics: {
      citations: 1402,
      references: 42,
      impact: '84',
      velocity: '안정',
    },
    insight:
      '인용 네트워크가 매우 크고, 특허 연결 노드가 풍부해 후속 기술 사업화 탐색에 유리합니다.',
    matches: 85,
    related: ['paper-ai-semiconductor-2025'],
  },
  {
    id: 'paper-innovation-kipris-2025',
    title: 'KIPRIS·NTIS 연계 기반 학생 발명·과제 탐색 모델',
    subtitle: '학생 발명전 및 국가 R&D 과제 데이터의 통합 검색 모델',
    authors: ['정하늘', '윤서진'],
    affiliation: 'KAIST Future Systems Lab',
    year: 2025,
    source: 'NTIS · 학생발명연계 리포트',
    sourceType: '보고서',
    openAccess: false,
    badge: 'NTIS',
    region: '국내',
    summary:
      '학생 발명전, NTIS 과제, KIPRIS 특허를 엮어 신기술 아이디어 탐색을 지원하는 통합 검색 모델입니다.',
    abstract:
      '학생발명전 수상 아이디어, 과제 공고, 특허 문헌 간의 의미적 유사성을 계산해 기술사업화 후보를 탐색하는 구조를 제안한다.',
    tags: ['NTIS', 'KIPRIS', '학생발명전'],
    metrics: {
      citations: 18,
      references: 12,
      impact: '신규',
      velocity: '급상승',
    },
    insight:
      '국내 공공 데이터에 특화되어 초기 아이디어 검증 단계에서 활용 가치가 큽니다.',
    matches: 78,
    related: ['paper-ai-semiconductor-2025'],
  },
];

export const mockSources = [
  'Semantic Scholar',
  'arXiv',
  'KCI',
  'RISS',
  'ScienceON',
  'DBpia',
  'NTIS',
  'KIPRIS',
  '학생과학발명품경진대회',
  '대한민국학생발명전시회',
];

export const mockSearchResponse = {
  query: 'AI 반도체 설계 자동화',
  total: mockPapers.length,
  summary:
    '국내 연구·과제·특허를 우선 노출하면서 글로벌 SCI-E 문헌을 함께 연결한 결과입니다.',
  relatedQueries: ['EDA 자동화', '국내 AI 반도체 과제', 'KIPRIS 반도체 특허'],
  filters: {
    regions: ['국내', '해외'],
    sourceTypes: ['논문', '특허', '보고서'],
    sources: mockSources,
  },
  items: mockPapers,
};

export const mockSimilarity = {
  reportName: '나의_연구_초안_v1.pdf',
  similarityScore: 85,
  comparedPaperId: 'paper-quantum-graph-2024',
  sharedContext:
    'Attention 기반 하이브리드 학습 구조와 멀티모달 벡터 비교 방식이 기존 SCI-E 논문과 높은 구조적 유사성을 보입니다.',
  novelty:
    'Edge inference feedback loop와 국내 특허/KCI 우선 랭킹을 결합한 파이프라인 설계는 차별점으로 평가됩니다.',
  risk:
    '데이터 전처리와 평가 지표 정의 일부가 기존 문헌과 겹치므로 방법론 설명과 실험 분리 서술이 필요합니다.',
  recommendations: [
    '국내 과제·특허와의 차별 기여를 서론/기여점 섹션에 명시하세요.',
    '실험 파트에서 기존 벡터 유사도 기준과의 비교표를 추가하세요.',
    'KCI/SCI-E 기준 문헌을 별도로 인용하여 한국형 응용 맥락을 강화하세요.',
  ],
};

export function getPaperById(id) {
  return mockPapers.find((paper) => paper.id === id) ?? mockPapers[0];
}
