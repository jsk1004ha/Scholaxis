import { readFile } from 'node:fs/promises';
import path from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

export function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(payload));
}

export function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  );
}

export async function readRawBody(req, maxBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error('Payload too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody(req, maxBytes = 200_000) {
  const raw = await readRawBody(req, maxBytes);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON body');
    error.statusCode = 400;
    throw error;
  }
}

export function parseMultipartForm(buffer, contentType = '') {
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) return {};

  const boundary = `--${boundaryMatch[1]}`;
  const raw = buffer.toString('latin1');
  const chunks = raw.split(boundary).slice(1, -1);
  const fields = {};

  for (const chunk of chunks) {
    const normalized = chunk.replace(/^\r\n/, '');
    const splitIndex = normalized.indexOf('\r\n\r\n');
    if (splitIndex === -1) continue;

    const rawHeaders = normalized.slice(0, splitIndex);
    const rawBody = normalized.slice(splitIndex + 4).replace(/\r\n$/, '');
    const nameMatch = rawHeaders.match(/name="([^"]+)"/i);
    if (!nameMatch) continue;

    const filenameMatch = rawHeaders.match(/filename="([^"]*)"/i);
    const contentTypeMatch = rawHeaders.match(/Content-Type:\s*([^\r\n]+)/i);
    const bodyBuffer = Buffer.from(rawBody, 'latin1');

    fields[nameMatch[1]] = {
      value: bodyBuffer.toString('utf8'),
      buffer: bodyBuffer,
      filename: filenameMatch?.[1] || '',
      contentType: contentTypeMatch?.[1] || 'application/octet-stream'
    };
  }

  return fields;
}

export async function serveStatic(reqPath, res, publicDir) {
  const resolvedPath = reqPath === '/' ? '/index.html' : reqPath;
  const safePath = path.normalize(resolvedPath).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(publicDir, safePath);

  try {
    const contents = await readFile(filePath);
    const extension = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] || 'application/octet-stream'
    });
    res.end(contents);
    return true;
  } catch {
    return false;
  }
}
