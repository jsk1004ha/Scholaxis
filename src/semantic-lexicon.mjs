const RAW_GROUPS = [
  ['배터리', 'battery', 'batteries', 'battery cell', 'battery cells', 'バッテリー', '電池', '电池'],
  ['열폭주', 'thermal runaway', 'thermal abuse', 'heat propagation'],
  ['반도체', 'semiconductor', 'chip', 'wafer', '半導体', '半导体'],
  ['결함', 'defect', 'fault', 'failure'],
  ['설명가능ai', 'explainable ai', 'xai'],
  ['양자', 'quantum', '量子'],
  ['지식 그래프', '학술 그래프', 'knowledge graph', 'scholarly graph', 'citation graph', '知識グラフ', '知识图谱'],
  ['그래프', 'graph', 'network', 'グラフ', '图', '圖'],
  ['검색', 'retrieval', 'search', 'discovery', '検索', '检索'],
  ['멀티모달', 'multimodal', 'multi modal', 'マルチモーダル', '多模态'],
  ['기후', 'climate'],
  ['정책', 'policy', 'public policy'],
  ['의료영상', 'medical imaging', 'radiology imaging', '医用画像', '医学影像'],
  ['엣지 컴퓨팅', 'edge', 'edge computing', 'edge ai', 'エッジコンピューティング', '边缘计算'],
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
  ['기계학습', 'machine learning', '機械学習', '机器学习'],
  ['딥러닝', 'deep learning', 'neural network', '深層学習', '深度学习'],
  ['신경망', 'neural network'],
  ['추천', 'recommendation', 'recommend'],
  ['유사도', 'similarity', 'similar'],
  ['차별성', 'differentiation', 'novelty', 'distinctiveness'],
  ['센서', 'sensor', 'sensing'],
  ['센서 융합', 'sensor fusion', 'multi sensor fusion', 'multimodal sensor fusion'],
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
  ['카메라', 'camera', 'rgb camera'],
  ['레이더', 'radar'],
  ['로봇', 'robot', 'robotics'],
  ['유전자', 'gene', 'genetic'],
  ['면역치료', 'immunotherapy'],
  ['단백질', 'protein'],
  ['수질', 'water quality'],
  ['이상 탐지', 'anomaly detection', 'anomaly monitoring'],
  ['미세먼지', 'particulate matter', 'air pollution'],
  ['우주', 'space'],
  ['우주 쓰레기', 'space debris'],
  ['플라즈마', 'plasma'],
  ['수소', 'hydrogen'],
  ['수소 저장', 'hydrogen storage'],
  ['수소 취성', 'hydrogen embrittlement'],
  ['탄소 포집', 'carbon capture'],
  ['고체 전해질', 'solid electrolyte'],
  ['고체 전지', '전고체 전지', '전고체 배터리', 'solid state battery', 'all solid state battery', 'solid state lithium battery', 'solid state lithium metal battery'],
  ['리튬 금속', '리튬 금속 음극', 'lithium metal', 'lithium metal anode', 'li metal anode'],
  ['덴드라이트', '리튬 덴드라이트', 'dendrite', 'lithium dendrite', 'dendrite growth', 'dendrite suppression'],
  ['고체 전해질 계면', '계면 공학', 'solid electrolyte interphase', 'sei', 'interfacial engineering', 'interface engineering'],
  ['페로브스카이트', 'perovskite', 'metal halide perovskite'],
  ['태양전지', '태양 전지', 'solar cell', 'photovoltaic', 'photovoltaics', 'pv'],
  ['안정성 열화', '페로브스카이트 안정성', '페로브스카이트 열화', 'perovskite stability', 'perovskite degradation', 'operational stability', 'photostability'],
  ['패시베이션', '결함 패시베이션', 'passivation', 'defect passivation', 'surface passivation', 'trap state passivation'],
  ['멀티모달 검색', 'multimodal retrieval'],
  ['연구 인프라', 'research infrastructure'],
  ['학생 발명', 'student invention'],
  ['전람회', '과학전람회', '전국과학전람회', '학생부 전람회', 'science fair', 'national science fair', 'student science fair', 'science exhibition'],
  ['발명품', 'invention exhibit'],
  ['R&E', 'RNE', '알앤이', '창의연구', '과학영재 창의연구', '공동연구', 'research and education', 'student research report', 'rne report'],
  ['한화 사이언스 챌린지', '한화사이언스챌린지', '사이언스 챌린지', 'Hanwha Science Challenge', 'science challenge', 'saving the earth', 'sustainable idea', '고등학생 과학 아이디어'],
  ['수상작', '대상', '금상', '은상', '동상', '본선', '연도별 수상작', 'award winner', 'grand prize', 'gold prize', 'silver prize', 'bronze prize', 'finalist'],
  ['자기진자', '자석진자', 'magnetic pendulum'],
  ['에너지 하베스팅', 'energy harvesting'],
  ['문서 분석', 'document analysis'],
  ['광학', 'optical'],
  ['마이크로플루이딕스', 'microfluidics'],
  ['페더레이티드 러닝', 'federated learning', 'federated averaging', 'fedavg', 'cross silo federated learning', 'cross device federated learning'],
  ['의료 데이터', '건강 데이터', '헬스케어', '의료', 'healthcare', 'health care', 'medical data', 'health data', 'clinical data', 'electronic health record', 'ehr'],
  ['개인정보 보호', '프라이버시 보존', 'privacy preserving', 'privacy preserving ai', 'data privacy', 'differential privacy', 'secure aggregation', 'privacy preservation'],
  ['인과추론', 'causal inference', 'causal effect', 'treatment effect', 'counterfactual', 'potential outcome', 'do calculus'],
  ['차분의 차분', '이중차분', 'difference in differences', 'difference-in-differences', 'did', 'quasi experiment', 'quasi experimental', 'natural experiment'],
  ['교육 정책', '교육 정책 평가', 'education policy', 'educational policy', 'policy evaluation', 'program evaluation', 'student outcome', 'tutoring program'],
  ['그래프 신경망', 'graph neural network', 'gnn'],
  ['디지털 트윈', 'digital twin'],
  ['스마트팜', '스마트 농업', 'smart farm', 'smart farming', 'smart agriculture', 'precision agriculture', 'digital agriculture', 'agriculture 4 0'],
  ['온실', '스마트 온실', 'greenhouse', 'smart greenhouse', 'controlled environment agriculture', 'cea', 'vertical farm', 'hydroponic farm'],
  ['생육 환경', '생육 최적화', 'crop growth', 'crop recommendation', 'greenhouse climate', 'microclimate', 'climate control'],
  ['강유전체 메모리', 'ferroelectric memory'],
  ['양자 센서', 'quantum sensor', 'quantum sensing'],
  ['원격탐사', '위성 영상', 'remote sensing', 'satellite imagery', 'satellite radar', 'synthetic aperture radar', 'sar', 'sentinel 1', 'sentinel-1'],
  ['홍수 탐지', '홍수 매핑', 'flood detection', 'flood mapping', 'flood inundation', 'flood extent', 'inundation mapping', 'disaster response'],
  ['폐플라스틱', '플라스틱 폐기물', 'plastic waste', 'waste plastics', 'mixed plastics', 'municipal plastic waste', 'polyethylene', 'polypropylene', 'polystyrene'],
  ['플라스틱 재활용', '화학적 재활용', 'chemical recycling', 'plastic recycling', 'advanced recycling', 'upcycling'],
  ['촉매 열분해', '열분해 촉매', 'catalytic pyrolysis', 'pyrolysis catalyst', 'thermal pyrolysis', 'pyrolysis oil', 'zeolite catalyst', 'zsm 5', 'hzsm 5', 'fcc catalyst'],
  ['미세플라스틱', '마이크로플라스틱', 'microplastic', 'microplastics', 'nanoplastic', 'microplastic pollutants', '해양 폐기물', '해양 플라스틱', 'marine debris', 'marine waste', 'ocean plastic', 'floating pollutants'],
  ['하천 미세플라스틱 정화', '미세플라스틱 제거', '바이오차 흡착', '바이오차 흡착제', 'microplastic remediation', 'microplastic removal', 'microplastic adsorption', 'microplastic adsorbent', 'biochar microplastic'],
  ['바이오차', 'biochar'],
  ['혈당', '혈당 모니터링', 'glucose', 'blood glucose', 'glycemic', 'glucose monitoring', 'continuous glucose monitoring', 'cgm'],
  ['비침습', '비침습 센서', 'noninvasive', 'non invasive', 'non-invasive', 'wearable', 'wearable sensor', 'biosensor'],
  ['마이크로파 공진기', '전자기 센서', 'microwave resonator', 'electromagnetic sensor', 'interstitial fluid', 'optical biosensor', 'raman spectroscopy'],
  ['초전도체', '초전도', 'superconductor', 'superconductivity', 'high temperature superconductor', 'room temperature superconductor'],
  ['상온 초전도', '상온 상압', 'ambient pressure', 'room temperature', 'zero resistance', '제로 저항', 'critical temperature', 'tc', 'hydride superconductor'],
  ['LLM 에이전트', '에이전트 메모리', 'llm agent', 'agent memory', 'agentic memory', 'long term memory', 'persistent memory', 'episodic memory'],
  ['그래프 메모리', '지식 그래프 메모리', 'graph memory', 'graph based memory', 'knowledge graph memory', 'temporal knowledge graph', 'graphrag'],
  ['PFAS', '과불화화합물', 'per and polyfluoroalkyl substances', 'perfluoroalkyl substances', 'pfoa', 'pfos', 'forever chemicals'],
  ['PFAS 수처리', 'PFAS 제거', 'pfas water treatment', 'pfas removal', 'pfas remediation', 'adsorptive membrane', 'ion exchange resin', 'granular activated carbon', 'reverse osmosis', 'nanofiltration'],
  ['직접 리튬 추출', '염수 리튬 추출', 'direct lithium extraction', 'dle', 'lithium brine', 'brine lithium', 'lithium sorbent', 'ion sieve', 'li al ldh', 'electrodialysis', 'membrane separation'],
  ['암모니아 크래킹', '암모니아 분해', 'ammonia cracking', 'ammonia decomposition', 'catalytic ammonia cracking', 'nh3 cracking', 'hydrogen carrier', 'ruthenium catalyst', 'nickel catalyst'],
  ['mRNA 백신', 'mRNA vaccine', 'mrna therapeutic', 'messenger rna', 'mrna stability'],
  ['지질 나노입자', 'lipid nanoparticle', 'lipid nanoparticles', 'lnp', 'mrna lnp', 'ionizable lipid', 'peg lipid', 'cold chain', 'freeze drying', 'lyophilization'],
  ['크리스퍼', 'crispr', 'crispr cas9', 'genome editing', 'gene editing', 'guide rna', 'grna'],
  ['염기교정', 'base editing', 'base editor', 'adenine base editor', 'cytosine base editor', 'prime editing', 'off target', 'off-target', 'off target effects'],
  ['단백질 언어 모델', 'protein language model', 'protein language models', 'plm', 'esm', 'protein design', 'sequence design'],
  ['효소 설계', 'enzyme design', 'generative enzyme design', 'enzyme reaction', 'enzyme function prediction', 'enzyme engineering', 'biocatalyst design'],
  ['도시 열섬', 'urban heat island', 'uhi', 'land surface temperature', 'lst', 'urban climate', 'heatwave'],
  ['토양 탄소 격리', 'soil carbon sequestration', 'soil carbon storage', 'carbon sequestration', 'biochar soil', 'carbon removal'],
  ['담수화 막오염', 'membrane desalination', 'reverse osmosis desalination', 'ro desalination', 'membrane fouling', 'fouling prediction', 'flux decline', 'ultrafiltration membrane'],
  ['고체산화물 수전해', 'solid oxide electrolysis', 'solid oxide electrolyzer', 'solid oxide electrolyser', 'soec', 'high temperature electrolysis', 'steam electrolysis', 'protonic ceramic'],
  ['배터리 재활용', 'battery recycling', 'lithium ion battery recycling', 'spent lithium ion batteries', 'black mass', 'hydrometallurgy', 'hydrometallurgical recycling', 'leaching', 'cathode recycling'],
  ['EUV 리소그래피', 'euv lithography', 'photoresist', 'euv photoresist', 'stochastic defect', 'stochastic defects', 'line edge roughness', 'ler', 'lcdu', 'metal oxide resist', 'high na euv'],
  ['로봇 촉각', 'tactile sensing', 'robot tactile sensing', 'soft gripper', 'soft robotic gripper', 'vision based tactile', 'vision-based tactile', 'gelsight', 'tactile palm', 'compliant gripper'],
  ['RAG', '검색증강생성', 'retrieval augmented generation', 'retrieval-augmented generation', 'rag', 'privacy preserving rag', 'rag watermarking', 'watermarking', 'data provenance', 'retrieval watermark']
];

function normalizeKey(value = '') {
  return String(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

const TERM_GROUPS = RAW_GROUPS.map((group) => group.map(normalizeKey).filter(Boolean));
const TERM_INDEX = new Map();
for (const group of TERM_GROUPS) {
  for (const item of group) TERM_INDEX.set(item, group);
}

const GENERIC_CONTAINED_TERM_BLOCKLIST = new Set([
  'cell',
  'cells',
  'learning',
  'data',
  'model',
  'models',
  'system',
  'systems',
  'sensor',
  'sensors',
  'policy',
  'graph',
  'memory',
  'agent',
  'agents',
  'health',
  'medical',
  'bio',
  'adsorption',
  'membrane',
  'stability',
  'catalyst',
  'carbon',
  'hydrogen',
  'recycling',
  'water',
  'treatment',
  'prediction',
  'design',
  'study',
  'paper',
  'article',
  'research'
]);

function canExpandFromContainedInput(value = '') {
  if (!value || GENERIC_CONTAINED_TERM_BLOCKLIST.has(value)) return false;
  if (/\s/.test(value)) return true;
  if (/[가-힣]/.test(value) && value.length >= 2) return true;
  return value.length >= 10;
}

function canExpandFromContainedKey(key = '') {
  if (!key || GENERIC_CONTAINED_TERM_BLOCKLIST.has(key)) return false;
  if (/\s/.test(key)) return true;
  if (/[가-힣]/.test(key) && key.length >= 2) return true;
  return key.length >= 4;
}

export function expandSemanticLexiconTerms(values = []) {
  const output = new Set();
  for (const rawValue of values) {
    const value = normalizeKey(rawValue);
    if (!value) continue;
    output.add(value);
    for (const [key, group] of TERM_INDEX.entries()) {
      if (
        value === key ||
        (value.includes(key) && canExpandFromContainedKey(key)) ||
        (key.includes(value) && canExpandFromContainedInput(value))
      ) {
        for (const item of group) output.add(item);
      }
    }
  }
  return [...output];
}

export function semanticLexiconGroups() {
  return TERM_GROUPS.map((group) => [...group]);
}
