import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const COMMAND_CACHE_TTL_MS = Number(process.env.SCHOLAXIS_COMMAND_CACHE_TTL_MS || 30000);
const commandAvailabilityCache = new Map();

async function commandExists(command) {
  const cached = commandAvailabilityCache.get(command);
  if (cached && Date.now() - cached.checkedAt < COMMAND_CACHE_TTL_MS) {
    return cached.available;
  }
  try {
    await execFileAsync('bash', ['-lc', `command -v ${command}`], { timeout: 1500 });
    commandAvailabilityCache.set(command, { checkedAt: Date.now(), available: true });
    return true;
  } catch {
    commandAvailabilityCache.set(command, { checkedAt: Date.now(), available: false });
    return false;
  }
}

async function rasterizePdf(pdfPath, outputDir) {
  if (await commandExists('pdftoppm')) {
    await execFileAsync('pdftoppm', ['-png', '-r', '300', pdfPath, path.join(outputDir, 'page')]);
    return;
  }
  if (await commandExists('pdftocairo')) {
    await execFileAsync('pdftocairo', ['-png', '-r', '300', pdfPath, path.join(outputDir, 'page')]);
    return;
  }
  throw new Error('no-pdf-rasterizer');
}

async function ocrImage(imagePath) {
  const { stdout } = await execFileAsync('tesseract', [
    imagePath,
    'stdout',
    '-l',
    'kor+eng',
    '--psm',
    '4',
    '-c',
    'preserve_interword_spaces=1'
  ]);
  return stdout.trim();
}

export async function extractPdfTextWithOcr(pdfBuffer) {
  if (!Buffer.isBuffer(pdfBuffer) || !pdfBuffer.length) {
    return { text: '', method: 'ocr-none', warnings: ['empty-pdf-buffer'], confidence: 0, structured: false };
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
      ].filter(Boolean),
      confidence: 0,
      structured: false,
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
      warnings: [],
      confidence: 46,
      structured: false,
    };
  } catch (error) {
    return {
      text: '',
      method: 'ocr-error',
      warnings: [error.message],
      confidence: 0,
      structured: false,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function getOcrDiagnostics() {
  const [hasTesseract, hasPdftoppm, hasPdftocairo] = await Promise.all([
    commandExists('tesseract'),
    commandExists('pdftoppm'),
    commandExists('pdftocairo'),
  ]);
  return {
    tesseract: hasTesseract,
    pdftoppm: hasPdftoppm,
    pdftocairo: hasPdftocairo,
    ocrReady: hasTesseract && (hasPdftoppm || hasPdftocairo)
  };
}
