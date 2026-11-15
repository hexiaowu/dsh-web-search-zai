import assert from 'node:assert/strict';
import test from 'node:test';

let indexModule;
let webModule;
try {
  indexModule = await import('../lib/index.js');
  webModule = await import('@deepseek-ai/dsh-web');
} catch (error) {
  process.stderr.write(`# index tests skipped: host modules are not resolvable (${error.message})\n`);
}

const indexTest = indexModule === undefined
  ? (name, fn) => test(name, { skip: 'host modules are not resolvable' }, fn)
  : test;

const { Config, apply, inject, name } = indexModule ?? {};

function fakeConfig(overrides = {}) {
  const values = {
    mode: 'auto',
    region: 'cn',
    planBaseURL: undefined,
    apiBaseURL: undefined,
    apiKey: undefined,
    apiKeyEnv: 'ZAI_CODING_CN_API_KEY',
    model: 'glm-4.6',
    apiVersion: '2023-06-01',
    maxTokens: 4096,
    maxUses: 3,
    searchEngine: 'search_std',
    count: 10,
    timeoutMs: 25000,
    fallbackEnabled: true,
    fallbackProviders: 'deepseek-official,deepseek-search-api',
    ...overrides,
  };
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { get: () => value }]));
}

function fakeContext(credentials, webServer) {
  const providers = new Map();
  const web = {
    // The real seam exposes its registry as this Map; fallback lookup reads it.
    searchProviders: providers,
    registerSearchProvider(provider) {
      providers.set(provider.id, provider);
      return () => providers.delete(provider.id);
    },
    // The test route calls the seam; the fake returns one stable source.
    async search() {
      return { sources: [{ url: 'https://test.example/1', title: 'Test' }], truncated: false };
    },
  };
  const context = {
    web,
    effect(fn) {
      return fn();
    },
    inject(deps, callback) {
      if (!deps.includes('webServer') || webServer === undefined) return;
      callback({ ...context, webServer });
    },
    get(serviceName) {
      if (serviceName === 'credentials') return credentials;
      if (serviceName === 'webServer') return webServer;
      return undefined;
    },
    providers,
  };
  return context;
}

function registered(overrides = {}, credentials, seedProviders = [], webServer) {
  const context = fakeContext(credentials, webServer);
  for (const provider of seedProviders) context.providers.set(provider.id, provider);
  apply(context, fakeConfig(overrides));
  const provider = context.providers.get('zai');
  assert.ok(provider, 'the zai provider must be registered');
  return { context, provider };
}

async function withFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const PLAN_BODY = {
  content: [{ type: 'tool_result', content: "[{'title': '标题', 'link': 'https://example.com/a', 'content': '摘要'}]" }],
};

indexTest('exports the Cordis plugin surface without a default export', () => {
  assert.equal(name, 'web-search-zai');
  assert.deepEqual(inject, ['web']);
  assert.deepEqual(Object.keys(indexModule).sort(), ['Config', 'apply', 'inject', 'name']);
  assert.ok(Config);
});

indexTest('registers the zai provider and derives cn endpoints by region', async () => {
  const { provider } = registered({ apiKey: 'sk-literal' });
  assert.equal(provider.id, 'zai');
  assert.equal(provider.available(), true);
  assert.equal(await provider.ready(), true);

  const urls = [];
  const result = await withFetch(async (url) => {
    urls.push(url);
    return new Response(JSON.stringify(PLAN_BODY), { status: 200 });
  }, () => provider.search({ query: 'q' }, undefined));

  assert.equal(result.sources[0].title, '标题');
  assert.deepEqual(urls, ['https://open.bigmodel.cn/api/anthropic/v1/messages']);
});

indexTest('region=global switches both channel bases', async () => {
  const { provider } = registered({ region: 'global', apiKey: 'sk-literal', mode: 'plan' });
  const urls = [];
  await withFetch(async (url) => {
    urls.push(url);
    return new Response(JSON.stringify(PLAN_BODY), { status: 200 });
  }, () => provider.search({ query: 'q' }, undefined));
  assert.deepEqual(urls, ['https://api.z.ai/api/anthropic/v1/messages']);
});

indexTest('explicit base URLs override the region defaults', async () => {
  const { provider } = registered({
    apiKey: 'sk-literal',
    mode: 'api',
    apiBaseURL: 'https://mirror.example/paas/v4/',
  });
  const urls = [];
  await withFetch(async (url) => {
    urls.push(url);
    return new Response(JSON.stringify({
      code: 200,
      search_result: [{ title: 't', link: 'https://x.example/1' }],
    }), { status: 200 });
  }, () => provider.search({ query: 'q' }, undefined));
  assert.deepEqual(urls, ['https://mirror.example/paas/v4/web_search']);
});

indexTest('available() rejects a malformed numeric setting without throwing', () => {
  const { context } = registered({ timeoutMs: 0 });
  const provider = context.providers.get('zai');
  assert.equal(provider.available(), false);

  const broken = registered({ planBaseURL: 'not a url' }).provider;
  assert.equal(broken.available(), false);
});

indexTest('ready() reports presence only and never reads the value', async () => {
  let resolveCalls = 0;
  let describeCalls = 0;
  const credentials = {
    async resolve() {
      resolveCalls += 1;
      return { value: 'sk-from-store' };
    },
    async describe() {
      describeCalls += 1;
      return { configured: true };
    },
  };

  const { provider } = registered({}, credentials);
  assert.equal(await provider.ready(), true);
  assert.equal(resolveCalls, 0);
  assert.equal(describeCalls, 1);
});

indexTest('ready() answers false when the credential store cannot be read', async () => {
  const credentials = {
    async resolve() {
      return undefined;
    },
    async describe() {
      throw new Error('store offline');
    },
  };
  const { provider } = registered({}, credentials);
  assert.equal(await provider.ready(), false);
});

indexTest('search resolves the key from the credential store per operation', async () => {
  const credentials = {
    async resolve(ref) {
      assert.equal(ref, 'ZAI_CODING_CN_API_KEY');
      return { value: 'sk-from-store' };
    },
    async describe() {
      return { configured: true };
    },
  };
  const { provider } = registered({}, credentials);
  let authorization;
  await withFetch(async (_url, init) => {
    authorization = init.headers.authorization;
    return new Response(JSON.stringify(PLAN_BODY), { status: 200 });
  }, () => provider.search({ query: 'q' }, undefined));
  assert.equal(authorization, 'Bearer sk-from-store');
});

indexTest('a literal key wins over the credential store', async () => {
  let resolved = false;
  const credentials = {
    async resolve() {
      resolved = true;
      return { value: 'sk-from-store' };
    },
    async describe() {
      return { configured: true };
    },
  };
  const { provider } = registered({ apiKey: 'sk-literal' }, credentials);
  let authorization;
  await withFetch(async (_url, init) => {
    authorization = init.headers.authorization;
    return new Response(JSON.stringify(PLAN_BODY), { status: 200 });
  }, () => provider.search({ query: 'q' }, undefined));
  assert.equal(authorization, 'Bearer sk-literal');
  assert.equal(resolved, false);
});

indexTest('a missing key fails with an actionable CREDENTIAL_MISSING error', async () => {
  const previous = process.env.ZAI_CODING_CN_API_KEY;
  delete process.env.ZAI_CODING_CN_API_KEY;
  try {
    const { provider } = registered({});
    assert.equal(await provider.ready(), false);
    await assert.rejects(
      provider.search({ query: 'q' }, undefined),
      (error) => {
        assert.ok(error instanceof webModule.WebError);
        assert.equal(error.code, 'WEB_PROVIDER_CREDENTIAL_MISSING');
        assert.match(error.message, /~\/\.dsh\/\.credentials\.yaml/u);
        return true;
      },
    );
  } finally {
    if (previous !== undefined) process.env.ZAI_CODING_CN_API_KEY = previous;
  }
});

indexTest('an aborted caller signal surfaces WEB_ABORTED before dispatch', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  const { provider } = registered({ apiKey: 'sk-literal' });
  let called = 0;
  await withFetch(async () => {
    called += 1;
    return new Response(JSON.stringify(PLAN_BODY), { status: 200 });
  }, async () => {
    await assert.rejects(
      provider.search({ query: 'q' }, controller.signal),
      (error) => error.code === 'WEB_ABORTED',
    );
  });
  assert.equal(called, 0);
});

indexTest('an invalid apiKeyEnv name is treated as unconfigured, not a crash', async () => {
  const previous = process.env.ZAI_CODING_CN_API_KEY;
  delete process.env.ZAI_CODING_CN_API_KEY;
  try {
    const { provider } = registered({ apiKeyEnv: 'not a valid ref' });
    assert.equal(await provider.ready(), false);
    await assert.rejects(
      provider.search({ query: 'q' }, undefined),
      (error) => error.code === 'WEB_PROVIDER_CREDENTIAL_MISSING',
    );
  } finally {
    if (previous !== undefined) process.env.ZAI_CODING_CN_API_KEY = previous;
  }
});

function fakeFallbackProvider({ id = 'deepseek-official', available = true, ready = true, search } = {}) {
  const calls = [];
  return {
    calls,
    provider: {
      id,
      available: () => available,
      ready: async () => ready,
      async search(request, signal) {
        calls.push({ request, signal });
        if (search !== undefined) return search(request, signal);
        return {
          sources: [{ url: 'https://fallback.example/1', title: 'DeepSeek 兜底', snippet: 'fallback' }],
          truncated: false,
        };
      },
    },
  };
}

function plan429() {
  return new Response(JSON.stringify({ error: { code: '1113', message: '余额不足' } }), { status: 429 });
}

indexTest('plan failure falls back to a registered DeepSeek provider', async () => {
  const fallback = fakeFallbackProvider();
  const { provider } = registered({ mode: 'plan', apiKey: 'sk-literal' }, undefined, [fallback.provider]);

  const result = await withFetch(plan429, () => provider.search({ query: 'q', maxResults: 3 }, undefined));

  assert.equal(result.sources[0].title, 'DeepSeek 兜底');
  assert.equal(fallback.calls.length, 1);
  assert.equal(fallback.calls[0].request.query, 'q');
  assert.equal(fallback.calls[0].request.maxResults, 3);
});

indexTest('a missing Z.ai key keeps the tool admitted and falls back', async () => {
  const previous = process.env.ZAI_CODING_CN_API_KEY;
  delete process.env.ZAI_CODING_CN_API_KEY;
  try {
    const fallback = fakeFallbackProvider();
    const { provider } = registered({ mode: 'plan' }, undefined, [fallback.provider]);

    assert.equal(await provider.ready(), true, 'the fallback readiness must keep the tool visible');
    let fetchCalls = 0;
    const result = await withFetch(async () => {
      fetchCalls += 1;
      return plan429();
    }, () => provider.search({ query: 'q' }, undefined));

    assert.equal(result.sources[0].url, 'https://fallback.example/1');
    assert.equal(fetchCalls, 0, 'a missing Z.ai key must not dispatch a Z.ai request');
    assert.equal(fallback.calls.length, 1);
  } finally {
    if (previous !== undefined) process.env.ZAI_CODING_CN_API_KEY = previous;
  }
});

indexTest('fallbackEnabled=false keeps the original Z.ai credential error', async () => {
  const previous = process.env.ZAI_CODING_CN_API_KEY;
  delete process.env.ZAI_CODING_CN_API_KEY;
  try {
    const fallback = fakeFallbackProvider();
    const { provider } = registered({ mode: 'plan', fallbackEnabled: false }, undefined, [fallback.provider]);

    assert.equal(await provider.ready(), false);
    await assert.rejects(
      provider.search({ query: 'q' }, undefined),
      (error) => error.code === 'WEB_PROVIDER_CREDENTIAL_MISSING',
    );
    assert.equal(fallback.calls.length, 0);
  } finally {
    if (previous !== undefined) process.env.ZAI_CODING_CN_API_KEY = previous;
  }
});

indexTest('both Z.ai and fallback failures are listed in one error', async () => {
  const fallback = fakeFallbackProvider({
    search: async () => {
      throw new Error('DeepSeek down');
    },
  });
  const { provider } = registered({ mode: 'plan', apiKey: 'sk-literal' }, undefined, [fallback.provider]);

  await assert.rejects(
    withFetch(plan429, () => provider.search({ query: 'q' }, undefined)),
    (error) => {
      assert.equal(error.code, 'WEB_PROVIDER_ERROR');
      assert.match(error.message, /zai: /u);
      assert.match(error.message, /deepseek-official: DeepSeek down/u);
      return true;
    },
  );
});

indexTest('caller cancellation never falls back', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  const fallback = fakeFallbackProvider();
  const { provider } = registered({ mode: 'plan', apiKey: 'sk-literal' }, undefined, [fallback.provider]);

  let fetchCalls = 0;
  await withFetch(async () => {
    fetchCalls += 1;
    return plan429();
  }, async () => {
    await assert.rejects(
      provider.search({ query: 'q' }, controller.signal),
      (error) => error.code === 'WEB_ABORTED',
    );
  });
  assert.equal(fetchCalls, 0);
  assert.equal(fallback.calls.length, 0);
});

indexTest('unavailable fallback providers are skipped and the next one is tried', async () => {
  const unavailable = fakeFallbackProvider({ id: 'deepseek-official', available: false });
  const usable = fakeFallbackProvider({ id: 'deepseek-search-api' });
  const { provider } = registered(
    { mode: 'plan', apiKey: 'sk-literal' },
    undefined,
    [unavailable.provider, usable.provider],
  );

  const result = await withFetch(plan429, () => provider.search({ query: 'q' }, undefined));

  assert.equal(result.sources[0].url, 'https://fallback.example/1');
  assert.equal(unavailable.calls.length, 0);
  assert.equal(usable.calls.length, 1);
});

indexTest('available() survives a broken Z.ai config while a fallback is usable', () => {
  const fallback = fakeFallbackProvider();
  const brokenZai = registered({ planBaseURL: 'not a url' }, undefined, [fallback.provider]);
  assert.equal(brokenZai.provider.available(), true);

  const noFallback = registered({ planBaseURL: 'not a url', fallbackEnabled: false });
  assert.equal(noFallback.provider.available(), false);
});

indexTest('ready() is false when both Z.ai and fallback lack credentials', async () => {
  const previous = process.env.ZAI_CODING_CN_API_KEY;
  delete process.env.ZAI_CODING_CN_API_KEY;
  try {
    const fallback = fakeFallbackProvider({ ready: false });
    const { provider } = registered({ mode: 'plan' }, undefined, [fallback.provider]);
    assert.equal(await provider.ready(), false);
  } finally {
    if (previous !== undefined) process.env.ZAI_CODING_CN_API_KEY = previous;
  }
});

indexTest('no registered fallback keeps the original Z.ai error unwrapped', async () => {
  const { provider } = registered({ mode: 'plan', apiKey: 'sk-literal' });

  await assert.rejects(
    withFetch(plan429, () => provider.search({ query: 'q' }, undefined)),
    (error) => {
      assert.equal(error.code, 'WEB_PROVIDER_ERROR');
      assert.match(error.message, /code 1113/u);
      assert.equal(error.message.includes('every fallback provider'), false);
      return true;
    },
  );
});

function makeWebServer() {
  const routes = [];
  return {
    routes,
    webServer: {
      register(route) {
        routes.push(route);
        return () => {};
      },
    },
  };
}

async function callRoute(route, request) {
  let status;
  let body;
  await route.handler(request, {
    writableEnded: false,
    writeHead(code) {
      status = code;
    },
    end(text) {
      body = text;
    },
  });
  return { status, data: JSON.parse(body) };
}

indexTest('the Settings page test route runs a real search through the seam', async () => {
  const { routes, webServer } = makeWebServer();
  registered({ apiKey: 'sk-literal' }, undefined, [], webServer);

  assert.equal(routes.length, 2);
  const route = routes.find((candidate) => candidate.path === '/dsh-web-search-zai/test');
  assert.ok(route);
  assert.equal(route.kind, 'exact');

  const { status, data } = await callRoute(
    route,
    { method: 'GET', url: '/dsh-web-search-zai/test', socket: { remoteAddress: '127.0.0.1' } },
  );

  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.count, 1);
  assert.equal(data.firstUrl, 'https://test.example/1');
});

indexTest('the test route rejects non-loopback and non-GET callers', async () => {
  const { routes, webServer } = makeWebServer();
  registered({ apiKey: 'sk-literal' }, undefined, [], webServer);
  const route = routes.find((candidate) => candidate.path === '/dsh-web-search-zai/test');
  assert.ok(route);

  const remote = await callRoute(route, {
    method: 'GET',
    url: '/',
    socket: { remoteAddress: '10.0.0.5' },
  });
  assert.equal(remote.status, 403);
  assert.equal(remote.data.ok, false);

  const post = await callRoute(route, {
    method: 'POST',
    url: '/',
    socket: { remoteAddress: '127.0.0.1' },
  });
  assert.equal(post.status, 405);
  assert.equal(post.data.ok, false);
});

indexTest('the key route reveals the current key to loopback only', async () => {
  const { routes, webServer } = makeWebServer();
  registered({ apiKey: 'sk-visible' }, undefined, [], webServer);

  const route = routes.find((candidate) => candidate.path === '/dsh-web-search-zai/key');
  assert.ok(route);

  const local = await callRoute(route, {
    method: 'GET',
    url: '/dsh-web-search-zai/key',
    socket: { remoteAddress: '::1' },
  });
  assert.equal(local.status, 200);
  assert.equal(local.data.ok, true);
  assert.equal(local.data.apiKey, 'sk-visible');

  const remote = await callRoute(route, {
    method: 'GET',
    url: '/dsh-web-search-zai/key',
    socket: { remoteAddress: '10.0.0.5' },
  });
  assert.equal(remote.status, 403);
  assert.equal(remote.data.ok, false);
});

indexTest('no webServer service leaves the local endpoints unregistered', () => {
  const routes = [];
  registered({ apiKey: 'sk-literal' });
  assert.equal(routes.length, 0);
});
