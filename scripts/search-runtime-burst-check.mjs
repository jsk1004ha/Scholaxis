import { once } from 'node:events';

const burstSize = Number(process.env.SCHOLAXIS_BURST_SIZE || 3);
const query = process.env.SCHOLAXIS_BURST_QUERY || '배터리 AI';
const healthTimeoutMs = Number(process.env.SCHOLAXIS_BURST_HEALTH_TIMEOUT_MS || 4000);
const healthBudgetMs = Number(process.env.SCHOLAXIS_BURST_HEALTH_BUDGET_MS || 750);
const requireSearchRuntime = ['1', 'true', 'yes', 'on'].includes(String(process.env.SCHOLAXIS_BURST_REQUIRE_SEARCH_RUNTIME || '1').toLowerCase());
const requireOverload = ['1', 'true', 'yes', 'on'].includes(String(process.env.SCHOLAXIS_BURST_REQUIRE_OVERLOAD || '0').toLowerCase());
const adminEmail = process.env.SCHOLAXIS_BURST_ADMIN_EMAIL || 'admin-burst@example.com';
const adminPassword = process.env.SCHOLAXIS_BURST_ADMIN_PASSWORD || 'test-password';
const externalBaseUrl = String(process.env.SCHOLAXIS_BURST_BASE_URL || '').trim();
const serverModulePath = process.env.SCHOLAXIS_BURST_SERVER_MODULE || '../src/server.mjs';

async function closeServer(server) {
  if (!server || !server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label}-timeout:${timeoutMs}`)), timeoutMs);
    }),
  ]);
}

async function main() {
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.SCHOLAXIS_ADMIN_EMAILS = process.env.SCHOLAXIS_ADMIN_EMAILS || adminEmail;
  process.env.SCHOLAXIS_DB_PATH = process.env.SCHOLAXIS_DB_PATH || `/tmp/scholaxis-burst-${Date.now()}.db`;
  process.env.SCHOLAXIS_LOCAL_MODEL_AUTOSTART = process.env.SCHOLAXIS_LOCAL_MODEL_AUTOSTART || '0';
  process.env.SCHOLAXIS_TRANSLATION_AUTOSTART = process.env.SCHOLAXIS_TRANSLATION_AUTOSTART || '0';
  process.env.SCHOLAXIS_RERANKER_AUTOSTART = process.env.SCHOLAXIS_RERANKER_AUTOSTART || '0';

  let server = null;
  let baseUrl = externalBaseUrl;
  if (!baseUrl) {
    const { createServer } = await import(serverModulePath);
    server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  }
  const failures = [];

  try {
    const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: adminEmail,
        password: adminPassword,
        displayName: 'Burst Admin',
      }),
    });
    const adminCookie = registerResponse.headers.get('set-cookie') || '';
    if (!registerResponse.ok || !adminCookie) {
      throw new Error(`admin-register-failed:${registerResponse.status}:${await registerResponse.text()}`);
    }

    const startedAt = Date.now();
    const searchPromises = Array.from({ length: burstSize }, async (_, index) => {
      const response = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent(query)}`);
      const bodyText = await response.text();
      let body = null;
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = { raw: bodyText };
      }
      return {
        index: index + 1,
        status: response.status,
        ok: response.ok,
        durationMs: Date.now() - startedAt,
        body,
      };
    });

    await new Promise((resolve) => setTimeout(resolve, 200));

    const healthStartedAt = Date.now();
    const healthResponse = await withTimeout(fetch(`${baseUrl}/api/health`), healthTimeoutMs, 'health');
    const healthBody = await healthResponse.json();
    const healthDurationMs = Date.now() - healthStartedAt;

    const opsResponse = await fetch(`${baseUrl}/api/admin/ops`, {
      headers: { cookie: adminCookie },
    });
    const opsBody = await opsResponse.json();
    const searchResponses = await Promise.all(searchPromises);

    const statusCounts = searchResponses.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {});

    const runtime = opsBody?.runtime || {};
    const searchRuntime = runtime.search || null;
    const analysisRuntime = runtime.analysis || null;
    const overloadedResponses = searchResponses.filter((item) => item.status >= 500);

    if (!healthResponse.ok) {
      failures.push(`health-status:${healthResponse.status}`);
    }
    if (healthDurationMs > healthBudgetMs) {
      failures.push(`health-too-slow:${healthDurationMs}>${healthBudgetMs}`);
    }
    if (requireSearchRuntime && !searchRuntime) {
      failures.push('missing-search-runtime-diagnostics');
    }
    if (requireOverload && overloadedResponses.length === 0) {
      failures.push('expected-overload-response');
    }
    if (searchRuntime && Number(searchRuntime.busyWorkers || 0) < 0) {
      failures.push('invalid-search-runtime-busyWorkers');
    }

    const summary = {
      ok: failures.length === 0,
      baseUrl,
      serverModulePath: externalBaseUrl ? null : serverModulePath,
      query,
      burstSize,
      health: {
        status: healthResponse.status,
        durationMs: healthDurationMs,
        budgetMs: healthBudgetMs,
        runtimeKeys: Object.keys(healthBody?.runtime || {}),
      },
      searches: {
        statuses: statusCounts,
        responses: searchResponses.map((item) => ({
          index: item.index,
          status: item.status,
          ok: item.ok,
          total: item.body?.total ?? null,
          error: item.body?.error || '',
        })),
      },
      runtime: {
        search: searchRuntime,
        analysis: analysisRuntime,
      },
      failures,
    };

    console.log(JSON.stringify(summary, null, 2));
    if (failures.length) {
      process.exitCode = 1;
    }
  } finally {
    await closeServer(server);
  }
}

await main();
