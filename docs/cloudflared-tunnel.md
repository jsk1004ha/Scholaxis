# Cloudflared Tunnel Setup

This demo can be shared safely for verification by tunneling the single local origin.

## 1. Install cloudflared

Follow Cloudflare's platform-specific installer for your OS.

## 2. Run the app locally

```bash
npm start
```

## 3. Create a quick verification tunnel

```bash
cloudflared tunnel --url http://localhost:3000
```

This is the fastest path for stakeholder review.

## 4. Named tunnel for repeatable demos

```bash
cloudflared tunnel login
cloudflared tunnel create scholaxis-demo
cloudflared tunnel route dns scholaxis-demo research-demo.example.com
```

Example `~/.cloudflared/config.yml`:

```yaml
tunnel: scholaxis-demo
credentials-file: /home/<user>/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: research-demo.example.com
    service: http://localhost:3000
  - service: http_status:404
```

Then start it with:

```bash
cloudflared tunnel run scholaxis-demo
```

## 5. Verification checklist

- Home/search/detail/similarity screens load over the public tunnel
- `/api/health` returns `{"ok":true,...}`
- Security headers remain present through the tunnel/proxy layer
