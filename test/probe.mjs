#!/usr/bin/env node
/**
 * Real-endpoint smoke test for both Z.ai search channels.
 *
 * It reads the key from `$ZAI_CODING_CN_API_KEY` first, then from the `refs:`
 * section of `$DSH_HOME/.credentials.yaml` (`~/.dsh/.credentials.yaml`).
 * The key is never printed: every log line and every raw dump is redacted.
 *
 * Usage:
 *   node test/probe.mjs ['query']
 *
 * Environment: `ZAI_REGION` (`cn`/`global`), `ZAI_PROBE_TIMEOUT_MS`.
 * Test-only overrides: `ZAI_PLAN_BASE_URL`, `ZAI_API_BASE_URL`,
 * `ZAI_PROBE_DOCS_DIR` (the integration test uses a loopback server).
 *
 * Exit code is non-zero only when both channels fail.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchViaApi, searchViaPlan } from '../lib/search.js';

const API_KEY_ENV = 'ZAI_CODING_CN_API_KEY';
const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = process.env.ZAI_PROBE_DOCS_DIR === undefined
  ? resolve(HERE, '..', 'docs')
  : resolve(process.env.ZAI_PROBE_DOCS_DIR);
const RAW_TRUNCATE_CHARS = 1200;

const query = process.argv[2] ?? '今天的人工智能新闻';
const region = process.env.ZAI_REGION === 'global' ? 'global' : 'cn';
const timeoutMs = positiveInteger(process.env.ZAI_PROBE_TIMEOUT_MS, 30000);
const regionEndpoints = region === 'global'
  ? { plan: 'https://api.z.ai/api/anthropic/v1', api: 'https://api.z.ai/api/paas/v4' }
  : { plan: 'https://open.bigmodel.cn/api/anthropic/v1', api: 'https://open.bigmodel.cn/api/paas/v4' };
// Test-only overrides: the integration test points these at a loopback server.
const endpoints = {
  plan: process.env.ZAI_PLAN_BASE_URL ?? regionEndpoints.plan,
  api: process.env.ZAI_API_BASE_URL ?? regionEndpoints.api,
};

/** The resolved key, set by {@link main}; used only for redaction. */
let apiKey;
if (process.env.NODE_TEST_CONTEXT === undefined) await main();

/**
 * Entry point. Every line stays inside a function so that `node --test test/`
 * can discover this file as a script without executing any network probe.
 */
async function main() {
  apiKey = readApiKey();
  if (apiKey === undefined) {
    process.stderr.write(
      `No ${API_KEY_ENV} found.\n`
        + `Set it in the launching environment, or add it under "refs:" in ${credentialsPath()}:\n`
        + `  ${API_KEY_ENV}: <your Z.ai key>\n`,
    );
    process.exitCode = 2;
    return;
  }

  process.stdout.write([
    `probe: query=${JSON.stringify(query)} region=${region} key=${maskKey(apiKey)}`,
    `  plan base: ${endpoints.plan}`,
    `  api  base: ${endpoints.api}`,
    '',
  ].join('\n'));

  const options = {
    mode: 'auto',
    region,
    planBaseURL: endpoints.plan,
    apiBaseURL: endpoints.api,
    apiKeyEnv: API_KEY_ENV,
    model: 'glm-4.6',
    apiVersion: '2023-06-01',
    maxTokens: 4096,
    maxUses: 3,
    searchEngine: 'search_std',
    count: 10,
    timeoutMs,
  };

  const plan = await probeChannel({
    label: 'plan',
    rawPath: join(DOCS_DIR, 'raw-plan.json'),
    run: (fetchImpl) => searchViaPlan({ query, options, apiKey, fetchImpl }),
  });
  const api = await probeChannel({
    label: 'api',
    rawPath: join(DOCS_DIR, 'raw-api.json'),
    run: (fetchImpl) => searchViaApi({ query, options, apiKey, fetchImpl }),
  });

  process.stdout.write(`\nsummary: plan=${plan.ok ? `${plan.count} sources` : 'FAILED'}, api=${api.ok ? `${api.count} sources` : 'FAILED'}\n`);
  if (!plan.ok && !api.ok) process.exitCode = 1;
}

/** Run one channel while capturing every HTTP exchange for the raw dump. */
async function probeChannel({ label, rawPath, run }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const started = Date.now();
    const response = await fetch(url, init);
    const clone = response.clone();
    const body = await clone.text();
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      status: response.status,
      durationMs: Date.now() - started,
      body,
    });
    return response;
  };

  const started = performance.now();
  try {
    const result = await run(fetchImpl);
    const durationMs = Math.round(performance.now() - started);
    const first = result.sources[0];
    process.stdout.write([
      `\n[${label}] OK in ${durationMs}ms — ${result.sources.length} sources`,
      `  first title: ${redact(first?.title ?? '(missing)')}`,
      `  first url:   ${redact(first?.url ?? '(missing)')}`,
      `  first 3 urls: ${result.sources.slice(0, 3).map((source) => redact(source.url)).join('\n                ')}`,
      '',
    ].join('\n'));
    writeRaw(rawPath, label, calls);
    return { ok: true, count: result.sources.length, durationMs };
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    process.stdout.write(`\n[${label}] FAILED in ${durationMs}ms (${error?.code ?? 'no code'})\n${redact(String(error?.message ?? error))}\n`);
    writeRaw(rawPath, label, calls);
    return { ok: false, count: 0, durationMs, error };
  }
}

/** Persist the response structure with secrets and long bodies removed. */
function writeRaw(rawPath, label, calls) {
  mkdirSync(dirname(rawPath), { recursive: true });
  const document = {
    generatedAt: new Date().toISOString(),
    channel: label,
    query,
    region,
    calls: calls.map((call) => ({
      url: call.url,
      method: call.method,
      status: call.status,
      durationMs: call.durationMs,
      body: sanitizeBody(call.body),
    })),
  };
  writeFileSync(rawPath, `${JSON.stringify(document, null, 2)}\n`);
  process.stdout.write(`  raw → ${rawPath}\n`);
}

/** Parse JSON when possible, then bound every string and redact the key. */
function sanitizeBody(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return redact(text).slice(0, RAW_TRUNCATE_CHARS * 2);
  }
  return bound(parsed, 0);
}

function bound(value, depth) {
  if (depth > 12) return '[depth limit]';
  if (typeof value === 'string') {
    const redacted = redact(value);
    return redacted.length <= RAW_TRUNCATE_CHARS ? redacted : `${redacted.slice(0, RAW_TRUNCATE_CHARS)}…[truncated]`;
  }
  if (Array.isArray(value)) return value.map((item) => bound(item, depth + 1));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bound(item, depth + 1)]));
  }
  return value;
}

/** Remove the API key and bearer-looking tokens from any string. */
function redact(value) {
  if (apiKey === undefined) return String(value);
  return String(value)
    .split(apiKey).join(maskKey(apiKey))
    .replace(/Bearer\s+[\w.~+/=-]+/giu, 'Bearer ***');
}

/** Read the key from the environment, then the credential store's refs section. */
function readApiKey() {
  const fromEnv = process.env[API_KEY_ENV];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return stripQuotes(fromEnv.trim());

  let text;
  try {
    text = readFileSync(credentialsPath(), 'utf8');
  } catch {
    return undefined;
  }
  const refs = /^refs:[ \t]*$/mu.exec(text);
  if (refs === null) return undefined;
  const section = text.slice(refs.index + refs[0].length);
  const entry = new RegExp(`^[ \\t]{2}${API_KEY_ENV}:[ \\t]*(.*)$`, 'mu').exec(section);
  if (entry === null) return undefined;
  const value = stripQuotes(entry[1].trim());
  return value.length > 0 ? value : undefined;
}

function credentialsPath() {
  const home = process.env.DSH_HOME;
  return typeof home === 'string' && home.length > 0
    ? join(home, '.credentials.yaml')
    : join(homedir(), '.dsh', '.credentials.yaml');
}

function stripQuotes(value) {
  return value.replace(/^(['"])(.*)\1$/u, '$2');
}

function maskKey(key) {
  return key.length <= 4 ? '***' : `${key.slice(0, 4)}***`;
}

function positiveInteger(raw, fallback) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1000 ? value : fallback;
}
