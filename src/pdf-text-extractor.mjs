import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

const execFileAsync = promisify(execFile);

function decodePdfEscapes(value = '') {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b')
    .replace(/\\f/g, '\f')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

function decodeHexString(value = '') {
  const clean = value.replace(/\s+/g, '');
  if (!clean) return '';
  const padded = clean.length % 2 === 0 ? clean : `${clean}0`;
  return Buffer.from(padded, 'hex').toString('utf8');
}

function collectPdfTextOperators(source = '') {
  const pieces = [];
  const directMatches = source.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj/g);
  for (const match of directMatches) {
    const raw = match[0].replace(/\)\s*Tj$/, '').slice(1);
    pieces.push(decodePdfEscapes(raw));
  }

  const arrayMatches = source.matchAll(/\[(.*?)\]\s*TJ/gs);
  for (const match of arrayMatches) {
    const segment = match[1];
    const entries = segment.match(/\((?:\\.|[^\\)])*\)|<[^>]+>/g) || [];
    const text = entries
      .map((entry) => {
        if (entry.startsWith('(')) return decodePdfEscapes(entry.slice(1, -1));
        return decodeHexString(entry.slice(1, -1));
      })
      .join('');
    if (text) pieces.push(text);
  }

  const quoteMatches = source.matchAll(/\((?:\\.|[^\\)])*\)\s*['"]/g);
  for (const match of quoteMatches) {
    const closingIndex = match[0].lastIndexOf(')');
    const raw = match[0].slice(1, closingIndex);
    pieces.push(decodePdfEscapes(raw));
  }

  return pieces.join('\n');
}

function extractStreams(buffer) {
  const binary = buffer.toString('latin1');
  const decoded = [];
  let cursor = 0;

  while (cursor < binary.length) {
    const streamIndex = binary.indexOf('stream', cursor);
    if (streamIndex === -1) break;

    let bodyStart = streamIndex + 'stream'.length;
    if (binary.startsWith('\r\n', bodyStart)) bodyStart += 2;
    else if (binary[bodyStart] === '\n' || binary[bodyStart] === '\r') bodyStart += 1;

    const endIndex = binary.indexOf('endstream', bodyStart);
    if (endIndex === -1) break;

    let bodyEnd = endIndex;
    if (binary[bodyEnd - 2] === '\r' && binary[bodyEnd - 1] === '\n') bodyEnd -= 2;
    else if (binary[bodyEnd - 1] === '\n' || binary[bodyEnd - 1] === '\r') bodyEnd -= 1;

    const header = binary.slice(Math.max(0, streamIndex - 240), streamIndex);
    const streamBuffer = buffer.subarray(bodyStart, bodyEnd);

    try {
      if (/\/FlateDecode/.test(header)) decoded.push(zlib.inflateSync(streamBuffer).toString('latin1'));
      else decoded.push(streamBuffer.toString('latin1'));
    } catch {
      decoded.push(streamBuffer.toString('latin1'));
    }

    cursor = endIndex + 'endstream'.length;
  }

  return decoded;
}

async function tryPdftotext(buffer) {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'scholaxis-pdf-'));
  const inputPath = path.join(tempDir, 'input.pdf');
  const outputPath = path.join(tempDir, 'output.txt');

  try {
    await writeFile(inputPath, buffer);
    await execFileAsync('pdftotext', ['-enc', 'UTF-8', inputPath, outputPath]);
    const text = await readFile(outputPath, 'utf8');
    return text.trim();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function extractPdfText(pdfBuffer) {
  if (!Buffer.isBuffer(pdfBuffer) || !pdfBuffer.length) {
    return { text: '', method: 'none', warnings: ['empty-pdf-buffer'] };
  }

  try {
    const text = await tryPdftotext(pdfBuffer);
    if (text) {
      return {
        text,
        method: 'pdftotext',
        warnings: []
      };
    }
  } catch {
    // fall through to heuristic extraction
  }

  const streams = extractStreams(pdfBuffer);
  const text = streams
    .map((stream) => collectPdfTextOperators(stream))
    .filter(Boolean)
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();

  if (text) {
    return {
      text,
      method: 'heuristic-stream-parser',
      warnings: ['pdftotext-unavailable-or-failed']
    };
  }

  const rawFallback = pdfBuffer
    .toString('latin1')
    .match(/\((?:\\.|[^\\)])*\)/g)?.map((token) => decodePdfEscapes(token.slice(1, -1))).join(' ') || '';

  return {
    text: rawFallback.replace(/\s+/g, ' ').trim(),
    method: 'raw-fallback',
    warnings: ['low-confidence-pdf-extraction']
  };
}
