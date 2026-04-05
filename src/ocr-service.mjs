import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function commandExists(command) {
  try {
    await execFileAsync('bash', ['-lc', `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

async function rasterizePdf(pdfPath, outputDir) {
  if (await commandExists('pdftoppm')) {
    await execFileAsync('pdftoppm', ['-png', '-r', '200', pdfPath, path.join(outputDir, 'page')]);
    return;
  }
  if (await commandExists('pdftocairo')) {
    await execFileAsync('pdftocairo', ['-png', '-r', '200', pdfPath, path.join(outputDir, 'page')]);
    return;
  }
  throw new Error('no-pdf-rasterizer');
}

async function ocrImage(imagePath) {
  await execFileAsync('tesseract', [imagePath, 'stdout', '-l', 'kor+eng', '--psm', '6']);
  const { stdout } = await execFileAsync('tesseract', [imagePath, 'stdout', '-l', 'kor+eng', '--psm', '6']);
  return stdout.trim();
}

export async function extractPdfTextWithOcr(pdfBuffer) {
  if (!Buffer.isBuffer(pdfBuffer) || !pdfBuffer.length) {
    return { text: '', method: 'ocr-none', warnings: ['empty-pdf-buffer'] };
  }

  const hasTesseract = await commandExists('tesseract');
  const hasPpm = await commandExists('pdftoppm') || await commandExists('pdftocairo');
  if (!hasTesseract || !hasPpm) {
    return {
      text: '',
      method: 'ocr-unavailable',
      warnings: [
        !hasTesseract ? 'tesseract-not-installed' : null,
        !hasPpm ? 'pdf-rasterizer-not-installed' : null
      ].filter(Boolean)
    };
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'scholaxis-ocr-'));
  const pdfPath = path.join(tempDir, 'input.pdf');
  const imageDir = path.join(tempDir, 'pages');

  try {
    await writeFile(pdfPath, pdfBuffer);
    await execFileAsync('mkdir', ['-p', imageDir]);
    await rasterizePdf(pdfPath, imageDir);
    const files = (await readdir(imageDir))
      .filter((name) => name.endsWith('.png'))
      .sort();

    const pages = [];
    for (const file of files) {
      const text = await ocrImage(path.join(imageDir, file));
      if (text) pages.push(text);
    }

    return {
      text: pages.join('\n').trim(),
      method: 'tesseract-ocr',
      warnings: []
    };
  } catch (error) {
    return {
      text: '',
      method: 'ocr-error',
      warnings: [error.message]
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function getOcrDiagnostics() {
  const hasTesseract = await commandExists('tesseract');
  const hasPdftoppm = await commandExists('pdftoppm');
  const hasPdftocairo = await commandExists('pdftocairo');
  return {
    tesseract: hasTesseract,
    pdftoppm: hasPdftoppm,
    pdftocairo: hasPdftocairo,
    ocrReady: hasTesseract && (hasPdftoppm || hasPdftocairo)
  };
}
