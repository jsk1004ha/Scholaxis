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
    return { text: '', method: 'hwpx-none', warnings: ['empty-hwpx-buffer'], confidence: 0, structured: false };
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
      'def local(tag):',
      "    return tag.split('}', 1)[-1] if '}' in tag else tag",
      'def clean(text):',
      "    return re.sub(r'\\s+', ' ', text or '').strip()",
      'def collect_block(node, lines):',
      '    tag = local(node.tag).lower()',
      "    if tag in ('tbl', 'table'):",
      '        rows = []',
      "        for tr in node.iter():",
      "            if local(tr.tag).lower() not in ('tr', 'row'):",
      '                continue',
      '            cells = []',
      '            for tc in tr.iter():',
      "                if local(tc.tag).lower() not in ('tc', 'cell'):",
      '                    continue',
      "                text = clean(' '.join(part for part in tc.itertext() if part and part.strip()))",
      '                if text:',
      '                    cells.append(text)',
      '            if cells:',
      "                rows.append(' | '.join(cells))",
      '        if rows:',
      "            lines.append('[TABLE]')",
      '            lines.extend(rows)',
      '        return',
      "    if tag in ('p', 'paragraph'):",
      "        text = clean(' '.join(part for part in node.itertext() if part and part.strip()))",
      '        if text:',
      '            lines.append(text)',
      '        return',
      '    for child in list(node):',
      '        collect_block(child, lines)',
      'with zipfile.ZipFile(path) as zf:',
      '    names = sorted(name for name in zf.namelist() if name.lower().endswith(".xml") and ("section" in name.lower() or "contents" in name.lower()))',
      '    for name in names:',
      '        try:',
      '            root = ET.fromstring(zf.read(name))',
      '            lines = []',
      '            collect_block(root, lines)',
      "            section = '\\n'.join(line for line in lines if line).strip()",
      '            if section:',
      '                parts.append(section)',
      '        except Exception:',
      '            continue',
      "print(re.sub(r'\\n{3,}', '\\n\\n', '\\n\\n'.join(parts)).strip())",
    ].join('\n');
    const { stdout } = await execFileAsync('python3', ['-c', script]);
    return {
      text: stdout.trim(),
      method: 'python-zipfile-hwpx',
      warnings: [],
      confidence: 86,
      structured: true,
    };
  } catch (error) {
    return {
      text: '',
      method: 'hwpx-error',
      warnings: [error.message],
      confidence: 12,
      structured: false,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function extractHwpText(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return { text: '', method: 'hwp-none', warnings: ['empty-hwp-buffer'], confidence: 0, structured: false };
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
      confidence: pythonText.length >= chunkText.length ? 48 : 42,
      structured: false,
    };
  } catch (error) {
    const fallback = sanitizeExtractedText(buffer.toString('utf8')) || extractPrintableChunks(buffer);
    return {
      text: fallback,
      method: fallback ? 'hwp-best-effort-fallback' : 'hwp-error',
      warnings: ['binary-hwp-best-effort-only', error.message],
      confidence: fallback ? 30 : 0,
      structured: false,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
