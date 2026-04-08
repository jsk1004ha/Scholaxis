import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function extractDocxText(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return { text: '', method: 'docx-none', warnings: ['empty-docx-buffer'], confidence: 0, structured: false };
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'scholaxis-docx-'));
  const inputPath = path.join(tempDir, 'input.docx');

  try {
    await writeFile(inputPath, buffer);
    const script = [
      'import zipfile, re',
      'from xml.etree import ElementTree as ET',
      'path = ' + JSON.stringify(inputPath),
      "ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}",
      'parts = []',
      'with zipfile.ZipFile(path) as zf:',
      "    xml = zf.read('word/document.xml')",
      'root = ET.fromstring(xml)',
      "for node in root.findall('.//w:body/*', ns):",
      "    tag = node.tag.split('}')[-1]",
      "    if tag == 'p':",
      "        texts = [t.text.strip() for t in node.findall('.//w:t', ns) if t.text and t.text.strip()]",
      "        if texts: parts.append(' '.join(texts))",
      "    elif tag == 'tbl':",
      "        for tr in node.findall('.//w:tr', ns):",
      "            cells = []",
      "            for tc in tr.findall('./w:tc', ns):",
      "                texts = [t.text.strip() for t in tc.findall('.//w:t', ns) if t.text and t.text.strip()]",
      "                if texts: cells.append(' '.join(texts))",
      "            if cells: parts.append(' | '.join(cells))",
      "print(re.sub(r'\\n{3,}', '\\n\\n', '\\n'.join(parts)).strip())"
    ].join('\n');
    const { stdout } = await execFileAsync('python3', ['-c', script]);
    return {
      text: stdout.trim(),
      method: 'python-zipfile-docx-structured',
      warnings: [],
      confidence: 88,
      structured: true,
    };
  } catch (error) {
    return {
      text: '',
      method: 'docx-error',
      warnings: [error.message],
      confidence: 12,
      structured: false,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
