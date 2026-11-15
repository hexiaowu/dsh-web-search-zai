/**
 * The two Z.ai search backends and their `auto` orchestration.
 *
 * - `plan`: one Anthropic-compatible Messages call with the server-side
 *   `web_search_20250305` tool. It spends the GLM coding-plan quota and can
 *   answer slowly because the provider model is thinking.
 * - `api`: the metered native `/web_search` endpoint. It returns structured
 *   results quickly but is billed per call.
 *
 * Both throw `WebError` with the seam's vocabulary
 * (`WEB_PROVIDER_ERROR` / `WEB_ABORTED`); this module never retries, because
 * the Host tool layer already owns cancellation and the retry budget.
 *
 * @module dsh-web-search-zai/search
 */
import { WebError } from '@deepseek-ai/dsh-web';
import { parseApiResponse, parsePlanResponse } from './parse.js';
import { isNonBlankString, previewText } from './util.js';

/** Accepted `mode` values. Anything else behaves as `auto`. */
export const SEARCH_MODES = Object.freeze(['auto', 'plan', 'api']);

/** Upper bound on the native API channel, which should answer in seconds. */
const API_TIMEOUT_CAP_MS = 15000;

/** Anthropic server-tool descriptor the plan channel requests. */
const PLAN_SEARCH_TOOL_TYPE = 'web_search_20250305';

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'dsh-web-search-zai/0.1.0';

/** Keep an upstream HTML error page from flooding the model-facing message. */
const MAX_ERROR_BODY_CHARS = 600;

/** Instruction that keeps the plan channel from answering out of memory. */
const PLAN_INSTRUCTION = 'Use the web_search tool to search the web for the query below, then stop. '
  + 'Do not answer from memory, do not add commentary.';

/**
 * Run one search through the configured channel(s).
 *
 * @param {object} input - the call input.
 * @param {string} input.query - one query; the Host fans multiple tool queries out to parallel calls.
 * @param {object} input.options - the settings snapshot for this operation.
 * @param {string} input.apiKey - the resolved API key.
 * @param {AbortSignal} [input.signal] - the Host tool call's cancellation signal.
 * @param {typeof fetch} [input.fetchImpl] - injectable transport for tests.
 * @returns {Promise<{ sources: object[], truncated: boolean }>} the normalized search result.
 * @throws {WebError} with `WEB_PROVIDER_ERROR` or `WEB_ABORTED`.
 */
export async function runSearch({ query, options, apiKey, signal, fetchImpl = fetch }) {
  if (!isNonBlankString(query)) {
    throw new WebError('Z.ai web search requires a non-empty query.', 'WEB_PROVIDER_ERROR');
  }
  if (!isNonBlankString(apiKey)) {
    throw new WebError(
      `Z.ai web search has no API key for "${options.apiKeyEnv ?? 'ZAI_CODING_CN_API_KEY'}".`,
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    );
  }

  const mode = normalizeMode(options.mode);
  if (mode === 'plan') return searchViaPlan({ query, options, apiKey, signal, fetchImpl });
  if (mode === 'api') return searchViaApi({ query, options, apiKey, signal, fetchImpl });
  return searchWithFallback({ query, options, apiKey, signal, fetchImpl });
}

/**
 * Search through the plan channel only.
 *
 * @param {object} input - the call input (see {@link runSearch}).
 * @returns {Promise<{ sources: object[], truncated: boolean }>}
 */
export async function searchViaPlan({ query, options, apiKey, signal, fetchImpl = fetch }) {
  const endpoint = joinEndpoint(options.planBaseURL, 'messages');
  return dispatchJson({
    fetchImpl,
    endpoint,
    label: 'Z.ai plan web search',
    headers: {
      'x-api-key': apiKey,
      authorization: `Bearer ${apiKey}`,
      'anthropic-version': options.apiVersion,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': USER_AGENT,
    },
    body: {
      model: options.model,
      max_tokens: options.maxTokens,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: `${PLAN_INSTRUCTION}\n\nQuery: ${query}` }],
      }],
      tools: [{ type: PLAN_SEARCH_TOOL_TYPE, name: 'web_search', max_uses: options.maxUses }],
    },
    validate: parsePlanResponse,
    callerSignal: signal,
    timeoutMs: options.timeoutMs,
  });
}

/**
 * Search through the metered native API only.
 *
 * @param {object} input - the call input (see {@link runSearch}).
 * @returns {Promise<{ sources: object[], truncated: boolean }>}
 */
export async function searchViaApi({ query, options, apiKey, signal, fetchImpl = fetch }) {
  const endpoint = joinEndpoint(options.apiBaseURL, 'web_search');
  return dispatchJson({
    fetchImpl,
    endpoint,
    label: 'Z.ai native web search',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': USER_AGENT,
    },
    body: {
      search_engine: options.searchEngine,
      search_query: query,
      count: options.count,
    },
    validate: parseApiResponse,
    callerSignal: signal,
    timeoutMs: Math.min(options.timeoutMs, API_TIMEOUT_CAP_MS),
  });
}

/** Try the plan channel, then fall back to the native API on any non-abort failure. */
async function searchWithFallback({ query, options, apiKey, signal, fetchImpl }) {
  let planError;
  try {
    return await searchViaPlan({ query, options, apiKey, signal, fetchImpl });
  } catch (error) {
    if (isAborted(error, signal)) throw error;
    planError = error;
  }

  let apiError;
  try {
    return await searchViaApi({ query, options, apiKey, signal, fetchImpl });
  } catch (error) {
    if (isAborted(error, signal)) throw error;
    apiError = error;
  }

  throw new WebError(
    'Z.ai web search failed on both channels.\n'
      + `- plan channel: ${errorMessage(planError)}\n`
      + `- api channel: ${errorMessage(apiError)}\n\n`
      + 'The plan channel spends GLM coding-plan quota on one model call and uses planBaseURL; '
      + 'the api channel is the metered native search API and uses apiBaseURL. '
      + 'Fix the endpoint, key, quota, or network problem named above, or set mode to "plan" or "api" '
      + 'in the web-search-zai plugin settings to use a single channel.',
    'WEB_PROVIDER_ERROR',
    { cause: apiError },
  );
}

/** POST a JSON body and hand the decoded JSON to a channel parser. */
async function dispatchJson({
  fetchImpl, endpoint, label, headers, body, validate, callerSignal, timeoutMs,
}) {
  throwIfAborted(callerSignal, label);

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = callerSignal === undefined ? timeoutSignal : AbortSignal.any([callerSignal, timeoutSignal]);

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw transportFailure(error, { label, endpoint, callerSignal, timeoutSignal, timeoutMs });
  }

  let text;
  try {
    text = await response.text();
  } catch (error) {
    throw transportFailure(error, { label, endpoint, callerSignal, timeoutSignal, timeoutMs });
  }

  if (!response.ok) throw upstreamFailure(response, text, label, endpoint);

  let json;
  try {
    json = text.trim().length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new WebError(
      `${label} returned a non-JSON response (HTTP ${response.status}): ${previewText(text, MAX_ERROR_BODY_CHARS)}\n\n`
        + `The request used endpoint ${endpoint}.`,
      'WEB_PROVIDER_ERROR',
    );
  }

  try {
    return validate(json);
  } catch (error) {
    if (error instanceof WebError) throw error;
    if (error?.code === 'WEB_PROVIDER_ERROR') {
      throw new WebError(
        `${error.message}\n\nThe request used endpoint ${endpoint}.`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      );
    }
    throw new WebError(
      `${label} returned a response this provider could not use: ${errorMessage(error)}\n\n`
        + `The request used endpoint ${endpoint}.`,
      'WEB_PROVIDER_ERROR',
      { cause: error },
    );
  }
}

/** Map a transport rejection to a timeout, cancellation, or provider error. */
function transportFailure(error, { label, endpoint, callerSignal, timeoutSignal, timeoutMs }) {
  if (callerSignal?.aborted === true) {
    return new WebError(`${label} aborted`, 'WEB_ABORTED', { cause: callerSignal.reason ?? error });
  }
  if (timeoutSignal?.aborted === true || error?.name === 'TimeoutError') {
    return new WebError(
      `${label} timed out after ${timeoutMs}ms (endpoint ${endpoint}). `
        + 'The Z.ai endpoint did not answer in time; raise timeoutMs in the web-search-zai settings '
        + 'if this is normal for the plan channel.',
      'WEB_PROVIDER_ERROR',
      { cause: error },
    );
  }
  return new WebError(
    `${label} request failed: ${errorMessage(error)}\n\n`
      + `The request used endpoint ${endpoint}. Check the network, the endpoint setting, the API key, `
      + 'and the Z.ai plan or account balance.',
    'WEB_PROVIDER_ERROR',
    { cause: error },
  );
}

/** Build the provider error for a non-2xx response, preserving the upstream detail. */
function upstreamFailure(response, text, label, endpoint) {
  const { detail, code } = upstreamInfo(text);
  const status = `HTTP ${response.status}${isNonBlankString(response.statusText) ? ` ${response.statusText}` : ''}`;
  const hint = code === '1113'
    ? 'the account balance or resource package (code 1113: recharge or activate the GLM plan / web-search resource package)'
    : code === '1000'
      ? 'the API key status or model access (code 1000: the key or model was rejected; check the account plan and regenerate the key if needed)'
      : label.includes('plan') ? 'the Z.ai plan quota' : 'the Z.ai account balance';
  return new WebError(
    `${label} failed (${status}): ${detail === undefined ? 'no response body' : detail}\n\n`
      + `The request used endpoint ${endpoint}. Check the endpoint, ${hint}, and the API key permissions.`,
    'WEB_PROVIDER_ERROR',
  );
}

/** Pull the most specific message, upstream code, and request id out of an error body. */
function upstreamInfo(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (trimmed.length === 0) return { detail: undefined, code: undefined };
  try {
    const parsed = JSON.parse(trimmed);
    const rawDetail = parsed?.error?.message ?? parsed?.error ?? parsed?.message ?? parsed?.msg ?? parsed?.detail;
    const detailText = isNonBlankString(rawDetail)
      ? rawDetail.trim()
      : rawDetail === undefined || rawDetail === null
        ? undefined
        : previewText(JSON.stringify(rawDetail), MAX_ERROR_BODY_CHARS);

    const rawCode = parsed?.code ?? parsed?.error?.code ?? parsed?.error?.type;
    const code = rawCode === undefined || rawCode === null || String(rawCode) === '200'
      ? undefined
      : String(rawCode);

    const parts = [];
    if (code !== undefined) parts.push(`code ${code}`);
    const requestId = parsed?.request_id ?? parsed?.requestId;
    if (isNonBlankString(requestId)) parts.push(`request_id ${requestId.trim()}`);
    if (detailText !== undefined) parts.push(detailText);
    return { detail: parts.length > 0 ? parts.join(' — ') : undefined, code };
  } catch {
    // Not JSON; fall through to the raw preview.
  }
  return { detail: previewText(trimmed, MAX_ERROR_BODY_CHARS), code: undefined };
}

/** Throw when the caller already cancelled, without dispatching a request. */
function throwIfAborted(signal, label) {
  if (signal?.aborted === true) {
    throw new WebError(`${label} aborted`, 'WEB_ABORTED', { cause: signal.reason });
  }
}

/** Treat a structured abort or an aborted caller signal as cancellation. */
function isAborted(error, signal) {
  return error?.code === 'WEB_ABORTED' || signal?.aborted === true;
}

/** Coerce an unknown mode to `auto` so a settings typo cannot break every search. */
function normalizeMode(mode) {
  return SEARCH_MODES.includes(mode) ? mode : 'auto';
}

/** Join a configured base URL with a channel path, tolerating trailing slashes. */
function joinEndpoint(baseURL, path) {
  const base = isNonBlankString(baseURL) ? baseURL.trim().replace(/\/+$/u, '') : '';
  return `${base}/${path}`;
}

/** Error text for the combined failure message. */
function errorMessage(error) {
  if (error instanceof Error && isNonBlankString(error.message)) return error.message;
  return String(error);
}
