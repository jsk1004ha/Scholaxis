import { extractPdfText } from './pdf-text-extractor.mjs';
import { extractDocxText } from './docx-text-extractor.mjs';
import { extractHwpText, extractHwpxText } from './hwp-text-extractor.mjs';
import { extractPdfTextWithOcr } from './ocr-service.mjs';
import { expandPaperById } from './search-service.mjs';
import { buildSimilarityReport } from './similarity-service.mjs';

async function maybeDelayForTests() {
  const delayMs = Number(process.env.SCHOLAXIS_TEST_ANALYSIS_DELAY_MS || 0);
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

function reportProgress(hooks = {}, progress = 0, stage = '', label = '') {
  hooks.onProgress?.({ progress, stage, label });
}

export async function buildSimilarityFromRequest(body = {}, fallbackTitle = '업로드 문서', hooks = {}) {
  reportProgress(hooks, 18, 'prepare', '비교할 텍스트를 정리하고 있습니다.');
  await maybeDelayForTests();
  reportProgress(hooks, 62, 'compare', '유사 문헌과 섹션 구조를 비교하고 있습니다.');
  const report = await buildSimilarityReport({
    title: body.title || body.reportName || fallbackTitle,
    text: body.text || '',
    extraction: body.extraction || null,
  });
  reportProgress(hooks, 92, 'finalize', '결과를 정리하고 있습니다.');

  return {
    reportName: body.title || body.reportName || fallbackTitle,
    similarityScore: report.score,
    risk: report.riskLevel,
    verdict: report.verdict,
    sharedContext: `상위 일치 문헌은 ${report.topMatches[0]?.title || '없음'} 입니다.`,
    novelty: report.noveltySignals.join(', ') || '차별성 신호를 더 입력하면 개선됩니다.',
    structure: report.sectionComparisons
      .map((section) => `${section.inputSection} → ${section.matchedSection}`)
      .join(' / '),
    topicVerdict: report.verdict,
    sameTopicStatement: report.sameTopicStatement,
    relationship: report.relationship,
    differentiators: report.noveltySignals,
    differentiation: report.differentiationAnalysis?.summary || report.noveltySignals.join(', '),
    semanticDiff: report.semanticDiff || { summary: '', insights: [] },
    differentiationAnalysis: report.differentiationAnalysis || null,
    confidence: report.confidence || null,
    topMatches: report.topMatches,
    recommendations: report.recommendations,
    comparedPaperId: report.topMatches[0]?.id || null,
    priorStudies: report.priorStudies || [],
    priorStudiesMeta: report.priorStudiesMeta || { referenceDerivedCount: 0, catalogCount: 0 },
    sectionComparisons: report.sectionComparisons,
    analysis: report,
  };
}

export async function buildSimilarityFromMultipart(fields = {}, hooks = {}) {
  reportProgress(hooks, 15, 'prepare', '업로드 파일을 확인하고 있습니다.');
  await maybeDelayForTests();
  const fileField = fields.report || fields.file || {};
  const title = fileField.filename || fields.title?.value || '업로드 문서';
  let extractedText = fields.text?.value || fields.content?.value || '';
  let extraction = null;

  if (!extractedText && fileField.buffer?.length) {
    reportProgress(hooks, 35, 'extract', '문서에서 텍스트를 추출하고 있습니다.');
    if (/\.pdf$/i.test(fileField.filename || '') || /application\/pdf/i.test(fileField.contentType || '')) {
      extraction = await extractPdfText(fileField.buffer);
      extractedText = extraction.text || '';
      if ((!extractedText || extractedText.length < 80) && fileField.buffer?.length) {
        const ocrExtraction = await extractPdfTextWithOcr(fileField.buffer);
        if ((ocrExtraction.text || '').length > extractedText.length) {
          extraction = ocrExtraction;
          extractedText = ocrExtraction.text || extractedText;
        } else if (ocrExtraction.warnings?.length) {
          extraction = {
            ...extraction,
            warnings: [...new Set([...(extraction.warnings || []), ...ocrExtraction.warnings])],
          };
        }
      }
    } else if (/\.docx$/i.test(fileField.filename || '') || /wordprocessingml/.test(fileField.contentType || '')) {
      extraction = await extractDocxText(fileField.buffer);
      extractedText = extraction.text || '';
    } else if (/\.hwpx$/i.test(fileField.filename || '') || /application\/haansofthwpx/i.test(fileField.contentType || '')) {
      extraction = await extractHwpxText(fileField.buffer);
      extractedText = extraction.text || '';
    } else if (/\.hwp$/i.test(fileField.filename || '') || /application\/x-hwp/i.test(fileField.contentType || '')) {
      extraction = await extractHwpText(fileField.buffer);
      extractedText = extraction.text || '';
    } else {
      extractedText = fileField.buffer.toString('utf8').trim();
      extraction = {
        text: extractedText,
        method: 'utf8-buffer',
        warnings: [],
      };
    }
  }

  const payload = await buildSimilarityFromRequest(
    {
      title,
      text: extractedText || `${title} research manuscript scholarly similarity analysis`,
      extraction,
    },
    title,
    hooks,
  );

  if (extraction) {
    payload.extraction = {
      method: extraction.method,
      warnings: extraction.warnings,
      extractedCharacters: (extraction.text || '').length,
      preview: (extraction.text || '').slice(0, 240),
      confidence: extraction.confidence ?? 0,
      confidenceLabel:
        (extraction.confidence ?? 0) >= 76
          ? 'high'
          : (extraction.confidence ?? 0) >= 52
            ? 'moderate'
            : 'low',
      degraded: (extraction.confidence ?? 0) < 55 || Boolean(extraction.warnings?.length),
      structured: Boolean(extraction.structured),
    };
  }

  return payload;
}

export async function runAnalysisTaskByType(taskType = '', payload = {}, hooks = {}) {
  switch (taskType) {
    case 'paper-expand':
      reportProgress(hooks, 20, 'prepare', '문헌 상세 분석을 준비하고 있습니다.');
      await maybeDelayForTests();
      reportProgress(hooks, 65, 'expand', '추천·인용·그래프 정보를 계산하고 있습니다.');
      return expandPaperById(payload.id);
    case 'similarity-request':
      return buildSimilarityFromRequest(payload.body || {}, payload.fallbackTitle || '업로드 문서', hooks);
    case 'similarity-multipart':
      return buildSimilarityFromMultipart(payload.fields || {}, hooks);
    default:
      throw new Error(`unsupported-analysis-task:${taskType}`);
  }
}
