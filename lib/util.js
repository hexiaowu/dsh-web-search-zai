/**
 * Small dependency-free helpers shared by the parser, the two channel
 * backends, and the provider registration.
 *
 * Keeping this module free of host imports lets the fixture tests run with a
 * plain `node --test test/`.
 *
 * @module dsh-web-search-zai/util
 */

/** Whether a value is a string that contains at least one non-whitespace character. */
export function isNonBlankString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Trimmed string, or `undefined` when the value is missing or blank. */
export function nonBlank(value) {
  return isNonBlankString(value) ? value.trim() : undefined;
}

/** Whether a value is a plain object (not null, not an array). */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is an absolute http(s) URL. Web-search results must be
 * fetchable links; anything else (`javascript:`, `mailto:`, relative paths)
 * is not a source worth handing to the model.
 */
export function isWebUrl(value) {
  if (!isNonBlankString(value)) return false;
  const candidate = value.trim();
  if (!URL.canParse(candidate)) return false;
  const { protocol } = new URL(candidate);
  return protocol === 'http:' || protocol === 'https:';
}

/**
 * Normalize a URL for first-wins deduplication: lower-case host, no fragment,
 * no trailing slash. The original URL is kept on the source; only the identity
 * used for deduplication changes.
 *
 * @returns the normalized identity, or `undefined` for an unusable URL.
 */
export function normalizeUrl(value) {
  if (!isNonBlankString(value)) return undefined;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  url.hash = '';
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, '');
  const normalized = url.toString();
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

/** Deduplicate sources by normalized URL, first occurrence wins. */
export function dedupeSources(sources) {
  const seen = new Set();
  const unique = [];
  for (const source of sources) {
    const key = normalizeUrl(source?.url);
    if (key === undefined || seen.has(key)) continue;
    seen.add(key);
    unique.push(source);
  }
  return unique;
}

/**
 * Bound a string for an error message or a response preview, appending an
 * ellipsis when the value was cut. Never used for model-facing excerpts.
 */
export function previewText(value, maxChars = 400) {
  if (typeof value !== 'string') return '';
  const collapsed = value.replace(/\s+/gu, ' ').trim();
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars - 1)}…`;
}
