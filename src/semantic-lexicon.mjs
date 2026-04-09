const RAW_GROUPS = [
  ['배터리', 'battery', 'batteries', 'cell', 'cells'],
  ['열폭주', 'thermal runaway', 'thermal abuse', 'heat propagation'],
  ['반도체', 'semiconductor', 'chip', 'wafer'],
  ['결함', 'defect', 'fault', 'failure'],
  ['설명가능ai', 'explainable ai', 'xai'],
  ['양자', 'quantum'],
  ['지식 그래프', 'knowledge graph', 'scholarly graph', 'citation graph'],
  ['그래프', 'graph', 'network'],
  ['검색', 'retrieval', 'search', 'discovery'],
  ['멀티모달', 'multimodal', 'multi modal'],
  ['기후', 'climate'],
  ['정책', 'policy', 'public policy'],
  ['의료영상', 'medical imaging', 'radiology imaging'],
  ['엣지 컴퓨팅', 'edge computing', 'edge ai'],
  ['바이오', 'bio', 'biological', 'biomedical'],
  ['파운드리', 'foundry', 'biofoundry'],
  ['태양에너지', 'solar energy', 'photovoltaic'],
  ['전압 공급장치', 'voltage supply', 'power supply'],
  ['인용', 'citation', 'cited by'],
  ['참고문헌', 'reference', 'bibliography'],
  ['논문', 'paper', 'article', 'study'],
  ['특허', 'patent', 'invention'],
  ['보고서', 'report', 'project report'],
  ['학위논문', 'thesis', 'dissertation'],
  ['연구', 'research', 'study'],
  ['서론', 'introduction', 'background'],
  ['방법', 'method', 'approach', 'methodology'],
  ['결과', 'result', 'evaluation', 'experiment'],
  ['결론', 'conclusion', 'discussion'],
  ['인공지능', 'ai', 'artificial intelligence'],
  ['기계학습', 'machine learning'],
  ['딥러닝', 'deep learning', 'neural network'],
  ['신경망', 'neural network'],
  ['추천', 'recommendation', 'recommend'],
  ['유사도', 'similarity', 'similar'],
  ['차별성', 'differentiation', 'novelty', 'distinctiveness'],
  ['센서', 'sensor', 'sensing'],
  ['예측정비', 'predictive maintenance'],
  ['안전성', 'safety', 'safe'],
  ['실시간', 'real time', 'realtime'],
  ['정규화', 'normalization'],
  ['확장', 'expansion'],
  ['교차언어', 'cross lingual', 'multilingual'],
  ['교육', 'education', 'pedagogy'],
  ['문학', 'literature'],
  ['역사', 'history'],
  ['고고학', 'archaeology'],
  ['위성', 'satellite'],
  ['산불', 'wildfire'],
  ['홍수', 'flood'],
  ['지진', 'earthquake'],
  ['드론', 'drone', 'uav'],
  ['자율주행', 'autonomous driving', 'self driving'],
  ['라이다', 'lidar'],
  ['로봇', 'robot', 'robotics'],
  ['유전자', 'gene', 'genetic'],
  ['면역치료', 'immunotherapy'],
  ['단백질', 'protein'],
  ['수질', 'water quality'],
  ['미세먼지', 'particulate matter', 'air pollution'],
  ['우주', 'space'],
  ['우주 쓰레기', 'space debris'],
  ['플라즈마', 'plasma'],
  ['수소', 'hydrogen'],
  ['탄소 포집', 'carbon capture'],
  ['고체 전해질', 'solid electrolyte'],
  ['멀티모달 검색', 'multimodal retrieval'],
  ['연구 인프라', 'research infrastructure'],
  ['학생 발명', 'student invention'],
  ['전람회', 'science fair'],
  ['발명품', 'invention exhibit'],
  ['자기진자', '자석진자', 'magnetic pendulum'],
  ['에너지 하베스팅', 'energy harvesting'],
  ['문서 분석', 'document analysis'],
  ['광학', 'optical'],
  ['마이크로플루이딕스', 'microfluidics'],
  ['페더레이티드 러닝', 'federated learning'],
  ['인과추론', 'causal inference'],
  ['그래프 신경망', 'graph neural network', 'gnn']
];

function normalizeKey(value = '') {
  return String(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

const TERM_GROUPS = RAW_GROUPS.map((group) => group.map(normalizeKey).filter(Boolean));
const TERM_INDEX = new Map();
for (const group of TERM_GROUPS) {
  for (const item of group) TERM_INDEX.set(item, group);
}

export function expandSemanticLexiconTerms(values = []) {
  const output = new Set();
  for (const rawValue of values) {
    const value = normalizeKey(rawValue);
    if (!value) continue;
    output.add(value);
    for (const [key, group] of TERM_INDEX.entries()) {
      if (value === key || value.includes(key) || key.includes(value)) {
        for (const item of group) output.add(item);
      }
    }
  }
  return [...output];
}

export function semanticLexiconGroups() {
  return TERM_GROUPS.map((group) => [...group]);
}
