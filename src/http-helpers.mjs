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
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  );
}

export async function readRawBody(req, maxBytes = 200_000) {
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

  if (chunks.length === 0) return Buffer.from('');

  return Buffer.concat(chunks);
}

export async function readJsonBody(req, maxBytes = 200_000) {
  const body = await readRawBody(req, maxBytes);
  if (body.length === 0) return {};

  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON body');
    error.statusCode = 400;
    throw error;
  }
}

export function parseMultipartForm(bodyBuffer, contentType = '') {
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) return {};

  const boundary = `--${boundaryMatch[1]}`;
  const text = bodyBuffer.toString('utf8');
  const parts = text.split(boundary).slice(1, -1);
  const fields = {};

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const [rawHeaders, ...rest] = trimmed.split('\r\n\r\n');
    const content = rest.join('\r\n\r\n').replace(/\r\n--$/, '').trim();
    const nameMatch = rawHeaders.match(/name="([^"]+)"/i);
    const fileNameMatch = rawHeaders.match(/filename="([^"]*)"/i);
    if (!nameMatch) continue;
    const name = nameMatch[1];

    fields[name] = {
      value: content,
      filename: fileNameMatch?.[1] || ''
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
