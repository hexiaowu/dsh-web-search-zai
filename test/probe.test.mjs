import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE = join(HERE, 'probe.mjs');
const KEY = 'sk-test-1234-abcd';

let hostAvailable = true;
try {
  await import('@deepseek-ai/dsh-web');
} catch {
  hostAvailable = false;
}
const probeTest = hostAvailable
  ? test
  : (name, fn) => test(name, { skip: 'host modules are not resolvable' }, fn);

probeTest('probe.mjs exercises both channels against a loopback server and redacts the key', async (t) => {
  const docsDir = mkdtempSync(join(tmpdir(), 'zai-probe-'));
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    requests.push({ url: req.url, headers: req.headers, body });

    if (req.url === '/plan/messages') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        type: 'message',
        debugEcho: KEY,
        content: [{
          type: 'tool_result',
          content: "[{'text': [{'title': '中文标题', 'link': 'https://example.com/a', 'content': '摘要内容'}]}]",
        }],
      }));
      return;
    }
    if (req.url === '/api/web_search') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        code: 200,
        search_result: [{ title: 'API 标题', link: 'https://example.com/b', content: 'API 摘要' }],
        request_id: 'req-loopback',
      }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{}');
  });

  t.after(async () => {
    await new Promise((done) => server.close(done));
    rmSync(docsDir, { recursive: true, force: true });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // the probe must not short-circuit as a test-runner child
  Object.assign(env, {
    ZAI_CODING_CN_API_KEY: KEY,
    ZAI_REGION: 'cn',
    ZAI_PLAN_BASE_URL: `http://127.0.0.1:${port}/plan`,
    ZAI_API_BASE_URL: `http://127.0.0.1:${port}/api`,
    ZAI_PROBE_DOCS_DIR: docsDir,
  });

  const child = spawn(process.execPath, [PROBE, '测试查询'], {
    cwd: resolve(HERE, '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const [code] = await once(child, 'close');
  assert.equal(code, 0, `probe exited ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  assert.equal(stderr, '');
  assert.match(stdout, /probe: query="测试查询" region=cn key=sk-t\*\*\*/u);
  assert.match(stdout, /\[plan\] OK/u);
  assert.match(stdout, /\[api\] OK/u);
  assert.match(stdout, /summary: plan=1 sources, api=1 sources/u);
  assert.match(stdout, /中文标题/u);
  assert.match(stdout, /API 标题/u);
  assert.equal(stdout.includes(KEY), false, 'the probe must never print the key');

  const planDump = readFileSync(join(docsDir, 'raw-plan.json'), 'utf8');
  const apiDump = readFileSync(join(docsDir, 'raw-api.json'), 'utf8');
  assert.equal(planDump.includes(KEY), false, 'raw dumps must be redacted');
  assert.equal(apiDump.includes(KEY), false, 'raw dumps must be redacted');
  assert.match(planDump, /sk-t\*\*\*/u);
  assert.equal(JSON.parse(planDump).calls[0].status, 200);
  assert.equal(JSON.parse(apiDump).calls[0].status, 200);

  assert.equal(requests.length, 2);
  const planRequest = requests.find((request) => request.url === '/plan/messages');
  const apiRequest = requests.find((request) => request.url === '/api/web_search');
  assert.ok(planRequest);
  assert.ok(apiRequest);
  assert.equal(planRequest.headers.authorization, `Bearer ${KEY}`);
  assert.equal(planRequest.headers['x-api-key'], KEY);
  const planBody = JSON.parse(planRequest.body);
  assert.equal(planBody.tools[0].type, 'web_search_20250305');
  assert.match(planBody.messages[0].content[0].text, /测试查询/u);
  const apiBody = JSON.parse(apiRequest.body);
  assert.equal(apiBody.search_engine, 'search_std');
  assert.equal(apiBody.count, 10);
});
