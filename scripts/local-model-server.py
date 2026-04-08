#!/usr/bin/env python3
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

HOST = os.getenv('SCHOLAXIS_LOCAL_MODEL_HOST', '127.0.0.1')
PORT = int(os.getenv('SCHOLAXIS_LOCAL_MODEL_PORT', '11435'))
DEVICE = os.getenv('SCHOLAXIS_LOCAL_MODEL_DEVICE', 'cpu')
EMBED_MODEL = os.getenv('SCHOLAXIS_EMBEDDING_MODEL', 'BAAI/bge-m3')
RERANK_MODEL = os.getenv('SCHOLAXIS_RERANKER_MODEL', 'BAAI/bge-reranker-v2-m3')
BATCH_SIZE = int(os.getenv('SCHOLAXIS_EMBEDDING_BATCH_SIZE', '12'))

IMPORT_ERROR = None
SentenceTransformer = None
CrossEncoder = None

try:
    from sentence_transformers import CrossEncoder as _CrossEncoder
    from sentence_transformers import SentenceTransformer as _SentenceTransformer
    SentenceTransformer = _SentenceTransformer
    CrossEncoder = _CrossEncoder
except Exception as exc:  # pragma: no cover
    IMPORT_ERROR = f'{type(exc).__name__}: {exc}'

EMBEDDERS: dict[str, Any] = {}
RERANKERS: dict[str, Any] = {}


def response(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]):
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Content-Length', str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def parse_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get('Content-Length', '0') or '0')
    raw = handler.rfile.read(length) if length else b'{}'
    return json.loads(raw.decode('utf-8') or '{}')


def ensure_runtime_ready():
    if IMPORT_ERROR:
        raise RuntimeError(f'sentence-transformers unavailable: {IMPORT_ERROR}')


def get_embedder(model_name: str):
    ensure_runtime_ready()
    if model_name not in EMBEDDERS:
        EMBEDDERS[model_name] = SentenceTransformer(model_name, device=DEVICE)
    return EMBEDDERS[model_name]


def get_reranker(model_name: str):
    ensure_runtime_ready()
    if model_name not in RERANKERS:
        RERANKERS[model_name] = CrossEncoder(model_name, device=DEVICE)
    return RERANKERS[model_name]


def candidate_text(candidate: dict[str, Any]) -> str:
    return '\n'.join(
        str(value)
        for value in [
            candidate.get('title', ''),
            candidate.get('englishTitle', ''),
            candidate.get('abstract', ''),
            candidate.get('summary', ''),
            ' '.join(candidate.get('keywords', []) or []),
            ' '.join(candidate.get('highlights', []) or []),
            ' '.join(candidate.get('methods', []) or []),
        ]
        if value
    )


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args):
        sys.stderr.write('[local-model] ' + fmt % args + '\n')

    def do_GET(self):
        if self.path == '/health':
            return response(
                self,
                200,
                {
                    'ok': IMPORT_ERROR is None,
                    'device': DEVICE,
                    'embeddingModel': EMBED_MODEL,
                    'rerankerModel': RERANK_MODEL,
                    'importError': IMPORT_ERROR,
                    'loadedEmbedders': list(EMBEDDERS.keys()),
                    'loadedRerankers': list(RERANKERS.keys()),
                },
            )
        return response(self, 404, {'error': 'not found'})

    def do_POST(self):
        try:
            body = parse_json(self)
            if self.path == '/embed':
                model_name = body.get('model') or EMBED_MODEL
                texts = body.get('texts') or body.get('input') or []
                embedder = get_embedder(model_name)
                vectors = embedder.encode(
                    texts,
                    normalize_embeddings=True,
                    batch_size=max(1, min(BATCH_SIZE, len(texts) or 1)),
                    convert_to_numpy=True,
                )
                embeddings = [vector.tolist() for vector in vectors]
                return response(self, 200, {'ok': True, 'embeddings': embeddings, 'model': model_name})

            if self.path == '/rerank':
                model_name = body.get('model') or RERANK_MODEL
                query = body.get('query', '')
                candidates = body.get('candidates') or []
                top_k = int(body.get('topK') or len(candidates) or 0)
                reranker = get_reranker(model_name)
                pairs = [[query, candidate_text(candidate)] for candidate in candidates]
                scores = reranker.predict(pairs, batch_size=max(1, min(8, len(pairs) or 1)))
                results = []
                for candidate, score in zip(candidates, scores):
                    value = float(score)
                    normalized = 1.0 / (1.0 + pow(2.718281828, -value))
                    results.append(
                        {
                            'id': candidate.get('id'),
                            'score': round(normalized, 6),
                            'reason': 'local cross-encoder rerank',
                        }
                    )
                results.sort(key=lambda item: item['score'], reverse=True)
                return response(self, 200, {'ok': True, 'results': results[:top_k], 'model': model_name})

            return response(self, 404, {'error': 'not found'})
        except Exception as exc:  # pragma: no cover
            return response(self, 500, {'error': f'{type(exc).__name__}: {exc}'})


if __name__ == '__main__':
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f'Scholaxis local model server listening on http://{HOST}:{PORT}', flush=True)
    server.serve_forever()
