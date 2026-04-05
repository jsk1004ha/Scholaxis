# Deployment Guide

## Local run

```bash
npm start
```

The server listens on `PORT` if provided, otherwise `3000`.

## Live source mode

To enable external source fan-out:

```bash
SCHOLAXIS_ENABLE_LIVE_SOURCES=true npm start
```

If you have provider credentials:

```bash
SEMANTIC_SCHOLAR_API_KEY=... \
DBPIA_API_KEY=... \
KIPRIS_PLUS_API_KEY=... \
KIPRIS_PLUS_SEARCH_URL=... \
SCHOLAXIS_ENABLE_LIVE_SOURCES=true \
npm start
```

## Recommended production shape

- Run the Node process behind Nginx, Caddy, or a cloud load balancer.
- Terminate TLS at the edge.
- Keep the unified origin model (`/` for the SPA, `/api/*` for APIs).
- Apply proxy-level rate limiting for expensive crawl/API fan-out requests.
- Prefer explicit source keys over anonymous scraping where providers offer official APIs.

## Cloudflare Tunnel

Cloudflare Tunnel is supported as the primary single-origin publishing method.

Quick share:

```bash
cloudflared tunnel --url http://localhost:3000
```

Named tunnel validation:

```bash
cloudflared tunnel ingress validate --config cloudflared/config.example.yml
cloudflared tunnel run scholaxis-demo
```

## Example systemd unit

```ini
[Unit]
Description=Scholaxis unified research app
After=network.target

[Service]
WorkingDirectory=/opt/scholaxis
ExecStart=/usr/bin/node /opt/scholaxis/src/server.mjs
Environment=PORT=3000
Restart=always
User=scholaxis
Group=scholaxis

[Install]
WantedBy=multi-user.target
```
