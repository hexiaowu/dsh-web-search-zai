/**
 * Z.ai / Zhipu GLM web-search provider for the `ctx.web` seam.
 *
 * The provider registers as `zai` and owns two channels:
 *
 * - `plan`: the GLM coding-plan Messages endpoint with Anthropic's
 *   `web_search_20250305` server tool (spends plan quota).
 * - `api`: the native `/web_search` endpoint (metered per call).
 *
 * `mode: auto` tries the plan channel first and falls back to the native API.
 * If every Z.ai attempt fails (including a missing Z.ai key), the provider can
 * hand the search to the built-in DeepSeek search providers, so `web_search`
 * stays usable instead of going dark. Caller cancellation never falls back.
 *
 * Every setting is volatile, so a change on the Plugins page applies to the
 * next search without restarting the Host; `apply` snapshots the live values at
 * each operation instead of caching them.
 *
 * @module dsh-web-search-zai
 */
import z from '@deepseek-ai/schemastery';
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import { WebError } from '@deepseek-ai/dsh-web';
import { runSearch } from './search.js';
import { isNonBlankString, nonBlank } from './util.js';

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-zai';

/** The web seam this provider registers into. */
export const inject = ['web'];

/** Provider id this plugin registers under. Must not collide with built-ins. */
const PROVIDER_ID = 'zai';

const DEFAULT_API_KEY_ENV = 'ZAI_CODING_CN_API_KEY';
const DEFAULT_MODEL = 'glm-4.6';
const DEFAULT_API_VERSION = '2023-06-01';
const DEFAULT_SEARCH_ENGINE = 'search_std';
/** Built-in search providers that can stand in when Z.ai is entirely down. */
const DEFAULT_FALLBACK_PROVIDERS = 'deepseek-official,deepseek-search-api';
/** Local-only HTTP endpoint behind the Settings page's Test button. */
const TEST_ROUTE_PATH = '/dsh-web-search-zai/test';
/** Local-only endpoint that reveals the current key to the Settings page. */
const KEY_ROUTE_PATH = '/dsh-web-search-zai/key';
/** Fixed test query: the point is reachability, not a user-facing search. */
const TEST_QUERY = '今天的人工智能新闻';
/** Keep the test cheap: one search, at most three sources. */
const TEST_MAX_RESULTS = 3;
/** Bound the whole test, including a slow plan call and its fallback. */
const TEST_TIMEOUT_MS = 45000;
const DEFAULT_ENDPOINTS = Object.freeze({
  cn: Object.freeze({
    plan: 'https://open.bigmodel.cn/api/anthropic/v1',
    api: 'https://open.bigmodel.cn/api/paas/v4',
  }),
  global: Object.freeze({
    plan: 'https://api.z.ai/api/anthropic/v1',
    api: 'https://api.z.ai/api/paas/v4',
  }),
});

/**
 * Every field is `.volatile()`: the Settings/Plugins form writes it, the
 * Host re-runs `apply` only for structural changes, and this plugin reads the
 * live value on every search (`config.<field>.get()`).
 *
 * `region` picks the endpoint pair; an explicit `planBaseURL`/`apiBaseURL`
 * wins over it. `apiKey` is the literal escape hatch; `apiKeyEnv` names a
 * credential reference resolved per search.
 */
export const Config = z.object({
  mode: z.string().default('auto').volatile(),
  region: z.string().default('cn').volatile(),
  planBaseURL: z.string().volatile(),
  apiBaseURL: z.string().volatile(),
  apiKey: z.string().role('secret').volatile(),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile(),
  model: z.string().default(DEFAULT_MODEL).volatile(),
  apiVersion: z.string().default(DEFAULT_API_VERSION).volatile(),
  maxTokens: z.number().step(1).min(1).default(4096).volatile(),
  maxUses: z.number().step(1).min(1).default(3).volatile(),
  searchEngine: z.string().default(DEFAULT_SEARCH_ENGINE).volatile(),
  count: z.number().step(1).min(1).max(50).default(10).volatile(),
  timeoutMs: z.number().step(1).min(1000).default(25000).volatile(),
  fallbackEnabled: z.boolean().default(true).volatile(),
  fallbackProviders: z.string().default(DEFAULT_FALLBACK_PROVIDERS).volatile(),
});

/**
 * Register the provider with `ctx.web`.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {any} config - the validated row config; fields are live getters.
 */
export function apply(ctx, config) {
  /** Snapshot the currently effective settings; never cache across operations. */
  const options = () => snapshotOptions(config);

  ctx.web.registerSearchProvider({
    id: PROVIDER_ID,
    // Synchronous and purely local: the seam calls this while selecting.
    // A broken Z.ai config still counts as selectable while a fallback works.
    available: () => {
      const snapshot = options();
      return isAvailable(snapshot) || hasUsableFallback(ctx, snapshot);
    },
    // Presence only — no network, because the Host calls it before every model step.
    // A missing Z.ai key still admits the tool when DeepSeek can stand in.
    ready: (llmProvider) => isSearchReady(ctx, options(), llmProvider),
    search: async (request, signal) => {
      const snapshot = options();
      let zaiFailure;
      try {
        const apiKey = await resolveApiKey(ctx, snapshot, signal);
        return await runSearch({
          query: request?.query,
          options: snapshot,
          apiKey,
          signal,
        });
      } catch (error) {
        // A cancelled call is final: never spend another provider's quota.
        if (isAbort(error, signal)) throw error;
        zaiFailure = error;
      }

      if (!snapshot.fallbackEnabled) throw zaiFailure;
      return await searchFallback(ctx, snapshot, request, signal, zaiFailure);
    },
  });

  registerTestRoute(ctx, options);
}

/**
 * Register the Plugins page's "Test" endpoint. It uses the same `ctx.web.seam`
 * as the model's tool, so it exercises the configured Z.ai channels and the
 * DeepSeek fallback rather than a separate probe. Local requests only.
 */
function registerTestRoute(ctx, options) {
  const register = (webServer) => {
    const test = webServer.register({
      kind: 'exact',
      path: TEST_ROUTE_PATH,
      handler: (request, response) => {
        void handleTestRequest(ctx, request, response);
      },
    });
    const key = webServer.register({
      kind: 'exact',
      path: KEY_ROUTE_PATH,
      handler: (request, response) => {
        void handleKeyRequest(ctx, options, request, response);
      },
    });
    return () => {
      test();
      key();
    };
  };

  // `webServer` may activate after this plugin: wait for it instead of reading
  // `ctx.get` once at apply time. A headless composition never gets the service,
  // and the search provider still works without the local endpoints.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (webCtx) => {
      webCtx.effect(() => register(webCtx.webServer), 'dsh-web-search-zai: local endpoints');
    });
    return;
  }

  const webServer = ctx.get('webServer');
  if (webServer === undefined || typeof webServer.register !== 'function') return;
  ctx.effect(() => register(webServer), 'dsh-web-search-zai: local endpoints');
}

/** Write one JSON response (never cached, never headers already sent). */
function sendJson(response, status, body) {
  if (response.writableEnded === true) return;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

/**
 * Reveal the current key to the Settings page. The user explicitly asked to see
 * the value; the endpoint is loopback-only, uncached, and never logs the key.
 */
async function handleKeyRequest(ctx, options, request, response) {
  if (request.method !== 'GET') {
    sendJson(response, 405, { ok: false, message: 'GET only' });
    return;
  }
  if (!isLoopbackAddress(request.socket?.remoteAddress)) {
    sendJson(response, 403, { ok: false, message: 'local access only' });
    return;
  }
  try {
    const apiKey = await resolveApiKey(ctx, options(), undefined);
    sendJson(response, 200, { ok: true, apiKey });
  } catch (error) {
    sendJson(response, 200, {
      ok: false,
      code: error?.code,
      message: messageOf(error),
    });
  }
}

/** Answer one test request with a compact success or the full error. */
async function handleTestRequest(ctx, request, response) {
  if (request.method !== 'GET') {
    sendJson(response, 405, { ok: false, message: 'GET only' });
    return;
  }
  if (!isLoopbackAddress(request.socket?.remoteAddress)) {
    sendJson(response, 403, { ok: false, message: 'local access only' });
    return;
  }

  try {
    const result = await ctx.web.search(
      { query: TEST_QUERY, maxResults: TEST_MAX_RESULTS },
      AbortSignal.timeout(TEST_TIMEOUT_MS),
    );
    sendJson(response, 200, {
      ok: true,
      query: TEST_QUERY,
      count: result.sources.length,
      truncated: result.truncated === true,
      firstTitle: result.sources[0]?.title,
      firstUrl: result.sources[0]?.url,
      sources: result.sources.slice(0, 3).map((source) => ({
        title: source.title,
        url: source.url,
      })),
    });
  } catch (error) {
    sendJson(response, 200, {
      ok: false,
      query: TEST_QUERY,
      code: error?.code,
      message: messageOf(error),
    });
  }
}

/** Loopback-only guard for the test endpoint. */
function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false;
  const normalized = address.toLowerCase();
  return normalized === '::1'
    || normalized === '::ffff:127.0.0.1'
    || normalized.startsWith('127.');
}

/** Project the live config getters into the plain options one operation uses. */
function snapshotOptions(config) {
  const region = config.region.get() === 'global' ? 'global' : 'cn';
  const endpoints = DEFAULT_ENDPOINTS[region];
  return {
    mode: config.mode.get(),
    region,
    planBaseURL: nonBlank(config.planBaseURL.get()) ?? endpoints.plan,
    apiBaseURL: nonBlank(config.apiBaseURL.get()) ?? endpoints.api,
    apiKey: nonBlank(config.apiKey.get()),
    apiKeyEnv: nonBlank(config.apiKeyEnv.get()) ?? DEFAULT_API_KEY_ENV,
    model: nonBlank(config.model.get()) ?? DEFAULT_MODEL,
    apiVersion: nonBlank(config.apiVersion.get()) ?? DEFAULT_API_VERSION,
    maxTokens: config.maxTokens.get(),
    maxUses: config.maxUses.get(),
    searchEngine: nonBlank(config.searchEngine.get()) ?? DEFAULT_SEARCH_ENGINE,
    count: config.count.get(),
    timeoutMs: config.timeoutMs.get(),
    fallbackEnabled: config.fallbackEnabled.get() !== false,
    fallbackProviders: nonBlank(config.fallbackProviders.get()) ?? DEFAULT_FALLBACK_PROVIDERS,
  };
}

/** Keep a malformed row from being selected and failing every search later. */
function isAvailable(options) {
  return URL.canParse(options.planBaseURL)
    && URL.canParse(options.apiBaseURL)
    && Number.isInteger(options.maxTokens)
    && options.maxTokens > 0
    && Number.isInteger(options.timeoutMs)
    && options.timeoutMs > 0;
}

/**
 * Whether the next search would have a credential. Reads only presence from
 * the credential store (never the value) and never touches the network.
 */
async function isKeyConfigured(ctx, options) {
  if (options.apiKey !== undefined) return true;
  const ref = toCredentialRef(options.apiKeyEnv);
  if (ref === undefined) return false;

  const credentials = ctx.get('credentials');
  if (credentials === undefined) {
    return isNonBlankString(launchEnvironmentOf(ctx).get(ref)?.value);
  }
  try {
    return (await credentials.describe(ref)).configured === true;
  } catch {
    return false;
  }
}

/**
 * Whether the tool should stay admitted: Z.ai has a key, or a built-in
 * fallback provider is registered, available, and reports a credential.
 * No network; the Host calls this before every model step.
 */
async function isSearchReady(ctx, options, llmProvider) {
  if (await isKeyConfigured(ctx, options)) return true;
  if (!options.fallbackEnabled) return false;
  for (const { provider } of fallbackProviders(ctx, options)) {
    if (provider === undefined || !providerAvailable(provider)) continue;
    if (provider.ready === undefined) return true;
    try {
      if (await provider.ready(llmProvider)) return true;
    } catch {
      // Try the next fallback.
    }
  }
  return false;
}

/** Whether at least one configured fallback provider can currently be selected. */
function hasUsableFallback(ctx, options) {
  if (!options.fallbackEnabled) return false;
  return fallbackProviders(ctx, options).some(({ provider }) => providerAvailable(provider));
}

/**
 * Run the same search through the configured built-in providers after every
 * Z.ai attempt failed. Providers already registered on the seam are called
 * directly, so this never re-enters `ctx.web.search()` or the `zai` provider.
 */
async function searchFallback(ctx, options, request, signal, zaiFailure) {
  const candidates = fallbackProviders(ctx, options);
  // No fallback route exists at all: preserve the original Z.ai error and code
  // (for example CREDENTIAL_MISSING) instead of wrapping it as a fallback failure.
  if (!candidates.some(({ provider }) => provider !== undefined)) throw zaiFailure;

  const failures = [`${PROVIDER_ID}: ${messageOf(zaiFailure)}`];
  for (const { id, provider } of candidates) {
    if (provider === undefined) {
      failures.push(`${id}: not registered`);
      continue;
    }
    if (!providerAvailable(provider)) {
      failures.push(`${id}: unavailable`);
      continue;
    }
    if (provider.ready !== undefined) {
      try {
        if (!(await provider.ready())) {
          failures.push(`${id}: not ready (credential missing)`);
          continue;
        }
      } catch (error) {
        failures.push(`${id}: readiness check failed: ${messageOf(error)}`);
        continue;
      }
    }
    try {
      const result = await provider.search(request, signal);
      if (result === undefined || result === null || !Array.isArray(result.sources)) {
        failures.push(`${id}: returned no search result`);
        continue;
      }
      return result;
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      failures.push(`${id}: ${messageOf(error)}`);
    }
  }

  throw new WebError(
    'Z.ai web search failed, and every fallback provider also failed.\n'
      + failures.map((line) => `- ${line}`).join('\n')
      + '\n\nSet fallbackEnabled=false in the web-search-zai settings to fail on Z.ai alone, '
      + 'or fix the credentials/quotas named above.',
    'WEB_PROVIDER_ERROR',
    { cause: zaiFailure },
  );
}

/** Registered fallback providers named by the config, in configured order. */
function fallbackProviders(ctx, options) {
  const providers = ctx.web?.searchProviders;
  if (!(providers instanceof Map)) return [];
  const seen = new Set();
  const candidates = [];
  for (const raw of String(options.fallbackProviders ?? '').split(',')) {
    const id = raw.trim();
    if (id.length === 0 || id === PROVIDER_ID || seen.has(id)) continue;
    seen.add(id);
    candidates.push({ id, provider: providers.get(id) });
  }
  return candidates;
}

/** Defensive `available()` check for another provider. */
function providerAvailable(provider) {
  try {
    return typeof provider?.available === 'function' && provider.available() === true;
  } catch {
    return false;
  }
}

/** A cancelled call is final; do not spend another provider's quota. */
function isAbort(error, signal) {
  return error?.code === 'WEB_ABORTED' || signal?.aborted === true;
}

/**
 * Resolve the key for exactly this operation, in the same order the official
 * provider uses: literal config first, then the credential store, then the
 * launching environment. A rotated key therefore reaches the next search
 * without a restart.
 */
async function resolveApiKey(ctx, options, signal) {
  throwIfAborted(signal);
  if (options.apiKey !== undefined) return options.apiKey;

  const ref = toCredentialRef(options.apiKeyEnv);
  let value;
  if (ref !== undefined) {
    const credentials = ctx.get('credentials');
    if (credentials !== undefined) {
      try {
        value = (await credentials.resolve(ref))?.value;
      } catch (error) {
        throwIfAborted(signal);
        throw new WebError(
          `Z.ai web search could not read credential "${ref}": ${messageOf(error)}`,
          'WEB_PROVIDER_ERROR',
          { cause: error },
        );
      }
    }
    throwIfAborted(signal);
    if (!isNonBlankString(value)) value = launchEnvironmentOf(ctx).get(ref)?.value;
  }
  if (isNonBlankString(value)) return value.trim();

  throw new WebError(
    `Z.ai web search has no API key for "${options.apiKeyEnv}". `
      + 'Store it as that reference in the DSH credential store (the `refs:` section of ~/.dsh/.credentials.yaml, '
      + 'chmod 600), export it in the launching environment, or set the literal "apiKey" in the '
      + 'web-search-zai plugin settings.',
    'WEB_PROVIDER_CREDENTIAL_MISSING',
  );
}

/** Brand a configured reference, or `undefined` when the row names none. */
function toCredentialRef(value) {
  if (!isNonBlankString(value) || !isCredentialRefName(value)) return undefined;
  return credentialRef(value);
}

function throwIfAborted(signal) {
  if (signal?.aborted === true) {
    throw new WebError('Z.ai web search aborted', 'WEB_ABORTED', { cause: signal.reason });
  }
}

function messageOf(error) {
  return error instanceof Error && isNonBlankString(error.message) ? error.message : String(error);
}
