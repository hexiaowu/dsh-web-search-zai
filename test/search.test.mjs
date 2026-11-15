import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * These tests exercise the HTTP layer. They need the Host's `WebError` class,
 * which resolves from the installation at runtime and from the local dev shim
 * (`node_modules/@deepseek-ai/dsh-web`) in a checkout. When neither is present,
 * skip rather than fail: the parser fixtures remain runnable with zero setup.
 */
let searchModule;
let webModule;
try {
  searchModule = await import('../lib/search.js');
  webModule = await import('@deepseek-ai/dsh-web');
} catch (error) {
  process.stderr.write(`# search tests skipped: host modules are not resolvable (${error.message})\n`);
}

const searchTest = searchModule === undefined
  ? (name, fn) => test(name, { skip: 'host modules are not resolvable' }, fn)
  : test;

const { runSearch, searchViaApi, searchViaPlan } = searchModule ?? {};
const { WebError } = webModule ?? {};

const PLAN_URL = 'https://open.bigmodel.cn/api/anthropic/v1/messages';
const API_URL = 'https://open.bigmodel.cn/api/paas/v4/web_search';

function baseOptions(overrides = {}) {
  return {
    mode: 'auto',
    region: 'cn',
    planBaseURL: 'https://open.bigmodel.cn/api/anthropic/v1',
    apiBaseURL: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnv: 'ZAI_CODING_CN_API_KEY',
    model: 'glm-4.6',
    apiVersion: '2023-06-01',
    maxTokens: 4096,
    maxUses: 3,
    searchEngine: 'search_std',
    count: 10,
    timeoutMs: 25000,
    ...overrides,
  };
}

function jsonResponse(body, status = 200, statusText = '') {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  });
}

const PLAN_BODY = {
  content: [{
    type: 'tool_result',
    content: "[{'title': '标题', 'link': 'https://example.com/a', 'content': '摘要'}]",
  }],
};

const API_BODY = {
  code: 200,
  search_result: [{ title: 'API 结果', link: 'https://api.example/1', content: '来自原生 API' }],
  request_id: 'req-1',
};

searchTest('plan channel sends the Anthropic Messages shape and parses the Zhipu block', async () => {
  const calls = [];
  const result = await searchViaPlan({
    query: '今天的人工智能新闻',
    options: baseOptions(),
    apiKey: 'sk-test-key',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(PLAN_BODY);
    },
  });

  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].title, '标题');
  assert.equal(result.sources[0].snippet, '摘要');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, PLAN_URL);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers['x-api-key'], 'sk-test-key');
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-test-key');
  assert.equal(calls[0].init.headers['anthropic-version'], '2023-06-01');

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'glm-4.6');
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.messages[0].role, 'user');
  assert.match(body.messages[0].content[0].text, /Query: 今天的人工智能新闻/u);
  assert.deepEqual(body.tools, [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]);
  assert.equal('thinking' in body, false);
});

searchTest('native channel sends search_engine/search_query/count with bearer auth', async () => {
  const calls = [];
  const result = await searchViaApi({
    query: 'glm 5',
    options: baseOptions({ count: 7 }),
    apiKey: 'sk-test-key',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(API_BODY);
    },
  });

  assert.equal(result.sources[0].url, 'https://api.example/1');
  assert.equal(result.sources[0].title, 'API 结果');
  assert.equal(calls[0].url, API_URL);
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-test-key');
  assert.equal(calls[0].init.headers['x-api-key'], undefined);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    search_engine: 'search_std',
    search_query: 'glm 5',
    count: 7,
  });
});

searchTest('a non-2xx response keeps the status, upstream message, and endpoint', async () => {
  await assert.rejects(
    searchViaPlan({
      query: 'q',
      options: baseOptions(),
      apiKey: 'sk-bad',
      fetchImpl: async () => jsonResponse({ error: { message: 'invalid api key' } }, 401, 'Unauthorized'),
    }),
    (error) => {
      assert.ok(error instanceof WebError);
      assert.equal(error.code, 'WEB_PROVIDER_ERROR');
      assert.match(error.message, /HTTP 401 Unauthorized/u);
      assert.match(error.message, /invalid api key/u);
      assert.match(error.message, /open\.bigmodel\.cn\/api\/anthropic\/v1\/messages/u);
      return true;
    },
  );
});

searchTest('code 1113 adds an explicit recharge/resource-package hint', async () => {
  await assert.rejects(
    searchViaApi({
      query: 'q',
      options: baseOptions(),
      apiKey: 'sk-test',
      fetchImpl: async () => jsonResponse({
        error: { code: '1113', message: '余额不足或无可用资源包,请充值。' },
      }, 429, 'Too Many Requests'),
    }),
    (error) => {
      assert.equal(error.code, 'WEB_PROVIDER_ERROR');
      assert.match(error.message, /code 1113/u);
      assert.match(error.message, /余额不足/u);
      assert.match(error.message, /recharge or activate the GLM plan/u);
      return true;
    },
  );
});

searchTest('code 1000 adds an explicit key/model-access hint', async () => {
  await assert.rejects(
    searchViaPlan({
      query: 'q',
      options: baseOptions(),
      apiKey: 'sk-test',
      fetchImpl: async () => jsonResponse({ error: { type: '1000', message: '身份验证失败。' } }, 401, 'Unauthorized'),
    }),
    (error) => {
      assert.equal(error.code, 'WEB_PROVIDER_ERROR');
      assert.match(error.message, /code 1000/u);
      assert.match(error.message, /身份验证失败/u);
      assert.match(error.message, /regenerate the key/u);
      return true;
    },
  );
});

searchTest('a transport timeout names the budget and the endpoint', async () => {
  const timeout = Object.assign(new Error('the operation was aborted due to timeout'), { name: 'TimeoutError' });
  await assert.rejects(
    searchViaPlan({
      query: 'q',
      options: baseOptions({ timeoutMs: 1000 }),
      apiKey: 'sk-test',
      fetchImpl: async () => {
        throw timeout;
      },
    }),
    (error) => {
      assert.equal(error.code, 'WEB_PROVIDER_ERROR');
      assert.match(error.message, /timed out after 1000ms/u);
      assert.match(error.message, /\/messages/u);
      return true;
    },
  );
});

searchTest('the native channel caps its own timeout at 15s', async () => {
  const timeout = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
  await assert.rejects(
    searchViaApi({
      query: 'q',
      options: baseOptions({ timeoutMs: 60000 }),
      apiKey: 'sk-test',
      fetchImpl: async () => {
        throw timeout;
      },
    }),
    /timed out after 15000ms/u,
  );
});

searchTest('a caller abort never dispatches and surfaces WEB_ABORTED', async () => {
  const controller = new AbortController();
  controller.abort(new Error('user cancelled'));
  let called = 0;
  await assert.rejects(
    searchViaPlan({
      query: 'q',
      options: baseOptions(),
      apiKey: 'sk-test',
      signal: controller.signal,
      fetchImpl: async () => {
        called += 1;
        return jsonResponse(PLAN_BODY);
      },
    }),
    (error) => error.code === 'WEB_ABORTED',
  );
  assert.equal(called, 0);
});

searchTest('auto falls back from the plan channel to the native API', async () => {
  const calls = [];
  const result = await runSearch({
    query: 'q',
    options: baseOptions({ mode: 'auto' }),
    apiKey: 'sk-test',
    fetchImpl: async (url) => {
      calls.push(url);
      if (url === PLAN_URL) return jsonResponse({ error: { message: 'web_search tool unsupported' } }, 400);
      return jsonResponse(API_BODY);
    },
  });

  assert.deepEqual(calls, [PLAN_URL, API_URL]);
  assert.equal(result.sources[0].title, 'API 结果');
});

searchTest('auto names both channel failures when everything fails', async () => {
  await assert.rejects(
    runSearch({
      query: 'q',
      options: baseOptions({ mode: 'auto' }),
      apiKey: 'sk-test',
      fetchImpl: async (url) => (url === PLAN_URL
        ? jsonResponse({ error: { message: 'plan quota exhausted' } }, 402)
        : jsonResponse({ code: 500, message: 'internal error', request_id: 'r-2' }, 500)),
    }),
    (error) => {
      assert.equal(error.code, 'WEB_PROVIDER_ERROR');
      assert.match(error.message, /failed on both channels/u);
      assert.match(error.message, /plan channel: .*plan quota exhausted/u);
      assert.match(error.message, /api channel: .*code 500/u);
      return true;
    },
  );
});

searchTest('auto does not fall back when the caller aborted', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  let called = 0;
  await assert.rejects(
    runSearch({
      query: 'q',
      options: baseOptions({ mode: 'auto' }),
      apiKey: 'sk-test',
      signal: controller.signal,
      fetchImpl: async () => {
        called += 1;
        return jsonResponse(API_BODY);
      },
    }),
    (error) => error.code === 'WEB_ABORTED',
  );
  assert.equal(called, 0);
});

searchTest('an unknown mode behaves as auto', async () => {
  const calls = [];
  await runSearch({
    query: 'q',
    options: baseOptions({ mode: 'typo' }),
    apiKey: 'sk-test',
    fetchImpl: async (url) => {
      calls.push(url);
      if (url === PLAN_URL) return jsonResponse(PLAN_BODY);
      return jsonResponse(API_BODY);
    },
  });
  assert.deepEqual(calls, [PLAN_URL]);
});

searchTest('a 200 response without a search block becomes WEB_PROVIDER_ERROR with the endpoint', async () => {
  await assert.rejects(
    searchViaPlan({
      query: 'q',
      options: baseOptions(),
      apiKey: 'sk-test',
      fetchImpl: async () => jsonResponse({ content: [{ type: 'text', text: 'no tool call' }] }),
    }),
    (error) => error.code === 'WEB_PROVIDER_ERROR'
      && /may not have triggered server-side web_search/u.test(error.message)
      && /open\.bigmodel\.cn\/api\/anthropic\/v1\/messages/u.test(error.message),
  );
});

searchTest('a non-JSON body is reported with a bounded preview', async () => {
  await assert.rejects(
    searchViaApi({
      query: 'q',
      options: baseOptions(),
      apiKey: 'sk-test',
      fetchImpl: async () => new Response('<html>gateway error</html>', { status: 200 }),
    }),
    (error) => error.code === 'WEB_PROVIDER_ERROR'
      && /non-JSON response/u.test(error.message)
      && /gateway error/u.test(error.message),
  );
});

searchTest('a missing key is rejected before any dispatch', async () => {
  let called = 0;
  await assert.rejects(
    runSearch({
      query: 'q',
      options: baseOptions(),
      apiKey: '',
      fetchImpl: async () => {
        called += 1;
        return jsonResponse(API_BODY);
      },
    }),
    (error) => error.code === 'WEB_PROVIDER_CREDENTIAL_MISSING',
  );
  assert.equal(called, 0);
});

searchTest('a blank query is rejected before any dispatch', async () => {
  await assert.rejects(
    runSearch({ query: '   ', options: baseOptions(), apiKey: 'sk-test', fetchImpl: async () => jsonResponse(API_BODY) }),
    (error) => error.code === 'WEB_PROVIDER_ERROR' && /non-empty query/u.test(error.message),
  );
});
