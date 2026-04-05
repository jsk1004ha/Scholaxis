import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function extractDocxText(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return { text: '', method: 'docx-none', warnings: ['empty-docx-buffer'] };
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'scholaxis-docx-'));
  const inputPath = path.join(tempDir, 'input.docx');

  try {
    await writeFile(inputPath, buffer);
    const script = [
      'import zipfile, re',
      'from xml.etree import ElementTree as ET',
      `path = ${JSON.stringify(inputPath)}`,
      'with zipfile.ZipFile(path) as zf:',
      "    xml = zf.read('word/document.xml')",
      'root = ET.fromstring(xml)',
      "ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}",
      "parts = [node.text for node in root.findall('.//w:t', ns) if node.text]",
      "print(re.sub(r'\\s+', ' ', ' '.join(parts)).strip())"
    ].join('\n');
    const { stdout } = await execFileAsync('python3', ['-c', script]);
    return {
      text: stdout.trim(),
      method: 'python-zipfile-docx',
      warnings: []
    };
  } catch (error) {
    return {
      text: '',
      method: 'docx-error',
      warnings: [error.message]
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
