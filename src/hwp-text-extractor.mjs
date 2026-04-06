import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

  const decoded = buffer
    .toString('utf8')
    .replace(/[^\p{L}\p{N}\s.,:;()\-_/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    text: decoded,
    method: 'hwp-best-effort',
    warnings: ['binary-hwp-best-effort-only'],
  };
}
