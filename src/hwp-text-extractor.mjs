import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function sanitizeExtractedText(value = '') {
  return String(value || '')
    .replace(/[^\p{L}\p{N}\s.,:;()\-_/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPrintableChunks(buffer) {
  const latinText = buffer.toString('latin1');
  const chunks = latinText.match(/[\p{L}\p{N}][\p{L}\p{N}\s.,:;()\-_/]{4,}/gu) || [];
  return sanitizeExtractedText(chunks.join(' '));
}

export async function extractHwpxText(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return { text: '', method: 'hwpx-none', warnings: ['empty-hwpx-buffer'] };
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'scholaxis-hwpx-'));
  const inputPath = path.join(tempDir, 'input.hwpx');

  try {
    await writeFile(inputPath, buffer);
    const script = [
      'import io, re, zipfile',
      'from xml.etree import ElementTree as ET',
      `path = ${JSON.stringify(inputPath)}`,
      'parts = []',
      'with zipfile.ZipFile(path) as zf:',
      '    names = [name for name in zf.namelist() if name.lower().endswith(".xml") and ("section" in name.lower() or "contents" in name.lower())]',
      '    for name in names:',
      '        try:',
      '            root = ET.fromstring(zf.read(name))',
      '            parts.extend([text.strip() for text in root.itertext() if text and text.strip()])',
      '        except Exception:',
      '            continue',
      "print(re.sub(r'\\s+', ' ', ' '.join(parts)).strip())",
    ].join('\n');
    const { stdout } = await execFileAsync('python3', ['-c', script]);
    return {
      text: stdout.trim(),
      method: 'python-zipfile-hwpx',
      warnings: [],
    };
  } catch (error) {
    return {
      text: '',
      method: 'hwpx-error',
      warnings: [error.message],
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function extractHwpText(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return { text: '', method: 'hwp-none', warnings: ['empty-hwp-buffer'] };
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'scholaxis-hwp-'));
  const inputPath = path.join(tempDir, 'input.hwp');
  const warnings = ['binary-hwp-best-effort-only'];

  try {
    await writeFile(inputPath, buffer);
    const script = [
      'import pathlib, re',
      `raw = pathlib.Path(${JSON.stringify(inputPath)}).read_bytes()`,
      "encodings = ['utf-8', 'utf-16-le', 'utf-16-be', 'cp949', 'euc-kr', 'latin1']",
      'candidates = []',
      'for enc in encodings:',
      '    try:',
      "        text = raw.decode(enc, errors='ignore')",
      "        clean = re.sub(r'[^0-9A-Za-z가-힣\\s.,:;()\\-_/]', ' ', text)",
      "        clean = re.sub(r'\\s+', ' ', clean).strip()",
      '        if clean:',
      '            hangul = sum(1 for ch in clean if "가" <= ch <= "힣")',
      '            score = len(clean) + hangul * 4',
      '            candidates.append((score, enc, clean))',
      '    except Exception:',
      '        continue',
      'print(max(candidates)[2] if candidates else "")',
      'print(max(candidates)[1] if candidates else "", file=__import__("sys").stderr)',
    ].join('\n');
    const { stdout, stderr } = await execFileAsync('python3', ['-c', script], {
      maxBuffer: 8 * 1024 * 1024
    });
    const pythonText = sanitizeExtractedText(stdout);
    const pythonEncoding = String(stderr || '').trim();
    const chunkText = extractPrintableChunks(buffer);
    const bestText = pythonText.length >= chunkText.length ? pythonText : chunkText;

    if (bestText && pythonEncoding) {
      warnings.push(`heuristic-decoder:${pythonEncoding}`);
    }

    return {
      text: bestText,
      method: pythonText.length >= chunkText.length ? 'hwp-heuristic-python' : 'hwp-heuristic-chunks',
      warnings,
    };
  } catch (error) {
    const fallback = sanitizeExtractedText(buffer.toString('utf8')) || extractPrintableChunks(buffer);
    return {
      text: fallback,
      method: fallback ? 'hwp-best-effort-fallback' : 'hwp-error',
      warnings: ['binary-hwp-best-effort-only', error.message],
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
