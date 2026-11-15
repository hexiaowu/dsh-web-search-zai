/**
 * Response parsing for the two Z.ai search channels.
 *
 * The plan channel answers in an Anthropic-compatible envelope, but Zhipu's
 * implementation is not standard: the result block is `tool_result` (not
 * `web_search_tool_result`) and its `content` is a Python-repr string such as
 * `[{'text': [{'title': '…', 'link': 'https://…', 'content': '…'}]}]`.
 * The native API channel answers with `{ code, search_result: [...] }`.
 *
 * Both channels converge on `collectRecords`, which walks a value by its
 * bracket structure — never by scanning for the text "title"/"url" — and treats
 * `link` and `url`, `content` and `snippet`, `page_age` and `publish_date` as
 * equivalent. This module has no host imports, so its fixtures run with plain
 * `node --test`.
 *
 * @module dsh-web-search-zai/parse
 */
import { dedupeSources, isNonBlankString, isPlainObject, isWebUrl, normalizeUrl } from './util.js';

/** Maximum container nesting followed while collecting records. */
const MAX_PARSE_DEPTH = 16;

/** Record key aliases across the standard Anthropic, Zhipu, and native layouts. */
const URL_KEYS = ['url', 'link'];
const TITLE_KEYS = ['title', 'name'];
/**
 * Zhipu's standard-layout `web_search_result` items put the excerpt in
 * `encrypted_content` (the name comes from Anthropic's opaque page blob, but
 * Zhipu fills it with plain text). It is tried after the explicit excerpt
 * fields and before the generic `text` fallback.
 */
const SNIPPET_KEYS = ['snippet', 'content', 'encrypted_content', 'summary', 'abstract', 'description', 'cited_text', 'text'];
const DATE_KEYS = ['publishedAt', 'published_at', 'publish_date', 'publishDate', 'page_age', 'pageAge', 'date'];

/**
 * Raised when a response cannot yield any source. Carries the stable
 * `WEB_PROVIDER_ERROR` code so the provider can convert it without this module
 * depending on the host package.
 */
export class SearchParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SearchParseError';
    this.code = 'WEB_PROVIDER_ERROR';
  }
}

/**
 * Parse a response body into a search result.
 *
 * @param {unknown} json - the parsed Anthropic-compatible Messages response.
 * @returns {{ sources: object[], truncated: false }}
 * @throws {SearchParseError} when no result block yields a usable URL.
 */
export function parsePlanResponse(json) {
  if (!isPlainObject(json)) throw new SearchParseError('The Z.ai plan response was not a JSON object.');
  if (json.type === 'error' || isPlainObject(json.error)) {
    throw new SearchParseError(`The Z.ai plan response reported an error: ${describeError(json)}`);
  }

  const blocks = Array.isArray(json.content) ? json.content : [];
  const records = [];
  for (const block of blocks) {
    if (!isResultBlock(block)) continue;
    collectRecords(block.content === undefined ? block : block.content, records);
  }
  // Unknown block types (or a provider that puts the list somewhere unexpected)
  // still get one structural pass; the fallback only runs when nothing matched.
  if (records.length === 0) collectRecords(blocks, records);

  const sources = mergeCitations(dedupeSources(records), citationSnippets(blocks));
  if (sources.length === 0) {
    throw new SearchParseError(
      'The Z.ai plan response contained no web-search result with a usable http(s) URL. '
        + `Content block types: ${describeBlockTypes(blocks)}. `
        + 'The request may not have triggered server-side web_search on this endpoint.',
    );
  }
  return { sources, truncated: false };
}

/**
 * Parse a native `/web_search` response into a search result.
 *
 * @param {unknown} json - the parsed native search response.
 * @returns {{ sources: object[], truncated: false }}
 * @throws {SearchParseError} on a non-200 `code` or no usable result URL.
 */
export function parseApiResponse(json) {
  if (!isPlainObject(json)) throw new SearchParseError('The Z.ai native search response was not a JSON object.');

  const { code } = json;
  if (code !== undefined && code !== null && String(code) !== '200') {
    const requestId = nonBlankStringOrUndefined(json.request_id ?? json.requestId);
    throw new SearchParseError(
      `The Z.ai native search API returned code ${String(code)}`
        + `${requestId === undefined ? '' : ` (request_id ${requestId})`}: ${describeError(json)}. `
        + 'Check the search_engine value, the API key permissions, and the account balance.',
    );
  }

  const payload = json.search_result ?? json.searchResult ?? json.data?.search_result ?? json.data;
  const records = [];
  collectRecords(payload, records);
  if (records.length === 0) collectRecords(json, records);

  const sources = dedupeSources(records);
  if (sources.length === 0) {
    throw new SearchParseError(
      'The Z.ai native search response contained no result with a usable http(s) URL. '
        + `Top-level keys: ${Object.keys(json).join(', ') || 'none'}.`,
    );
  }
  return { sources, truncated: false };
}

/**
 * Walk an arbitrary nested value (object, array, JSON string, or Python-repr
 * string) and collect every record that names a valid web URL.
 *
 * @param {unknown} value - the value to walk.
 * @returns {object[]} deduplicated sources in first-seen order.
 */
export function parseSearchPayload(value) {
  const records = [];
  collectRecords(value, records);
  return dedupeSources(records);
}

/**
 * Parse a JSON string, falling back to a Python-literal parser. Returns
 * `undefined` when the text is not a structured value.
 *
 * @param {string} text - candidate JSON or Python repr.
 * @returns {unknown} the parsed value, or `undefined`.
 */
export function parseStructuredText(text) {
  if (typeof text !== 'string') return undefined;
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;

  const first = trimmed[0];
  if (first === '"' || first === "'") {
    // A repr of a string that itself contains the list (double encoding).
    const decoded = decodeQuotedText(trimmed, first);
    if (typeof decoded !== 'string') return undefined;
    const inner = decoded.trim();
    if (inner.startsWith('[') || inner.startsWith('{')) return parseStructuredText(inner);
    return undefined;
  }
  if (first !== '[' && first !== '{' && first !== '(') return undefined;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to the Python-literal grammar.
  }
  try {
    return new PythonLiteralParser(trimmed).parseSequence();
  } catch {
    return undefined;
  }
}

function decodeQuotedText(text, quote) {
  if (quote === '"') {
    try {
      return JSON.parse(text);
    } catch {
      // Fall through to the Python grammar for JSON-invalid escapes.
    }
  }
  try {
    return new PythonLiteralParser(text).parseSequence();
  } catch {
    return undefined;
  }
}

/** Whether a content block is a search-result carrier in either layout. */
function isResultBlock(block) {
  if (!isPlainObject(block)) return false;
  return block.type === 'web_search_tool_result'
    || block.type === 'tool_result'
    || block.type === 'web_search_result'
    || block.type === 'search_result';
}

/** Collect records from a value by its container structure. */
function collectRecords(value, out, depth = 0) {
  if (depth > MAX_PARSE_DEPTH) return;
  if (typeof value === 'string') {
    const parsed = parseStructuredText(value);
    if (parsed !== undefined) collectRecords(parsed, out, depth + 1);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, out, depth + 1);
    return;
  }
  if (!isPlainObject(value)) return;

  const source = toSource(value);
  if (source !== undefined) {
    out.push(source);
    return;
  }
  for (const child of Object.values(value)) collectRecords(child, out, depth + 1);
}

/** Project one record object to a seam source, or `undefined` when it is not one. */
function toSource(record) {
  if (hasText(record.cited_text)) return undefined; // a citation, not a result item
  const url = firstString(record, URL_KEYS);
  if (!isWebUrl(url)) return undefined;

  const title = firstString(record, TITLE_KEYS);
  const snippet = firstReadableSnippet(record, SNIPPET_KEYS);
  const publishedAt = firstString(record, DATE_KEYS);
  return {
    url: url.trim(),
    ...(title === undefined ? {} : { title }),
    ...(snippet === undefined ? {} : { snippet, summary: snippet }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
  };
}

/** Build a `normalized URL → cited_text` map from every `text` block's citations. */
function citationSnippets(blocks) {
  const snippets = new Map();
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!isPlainObject(block) || block.type !== 'text' || !Array.isArray(block.citations)) continue;
    for (const citation of block.citations) {
      const url = firstString(citation, URL_KEYS);
      const text = firstString(citation, ['cited_text', 'snippet', 'text']);
      if (url === undefined || text === undefined) continue;
      const key = normalizeUrl(url);
      if (key !== undefined && !snippets.has(key)) snippets.set(key, text);
    }
  }
  return snippets;
}

/** Fill a missing snippet from the matching citation (first occurrence wins). */
function mergeCitations(sources, snippets) {
  if (snippets.size === 0) return sources;
  return sources.map((source) => {
    if (source.snippet !== undefined) return source;
    const excerpt = snippets.get(normalizeUrl(source.url));
    return excerpt === undefined ? source : { ...source, snippet: excerpt, summary: excerpt };
  });
}

function firstString(record, keys) {
  if (!isPlainObject(record)) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (isNonBlankString(value)) return value.trim();
  }
  return undefined;
}

/**
 * Pick the first excerpt that reads like prose. Anthropic-compatible providers
 * may also put an opaque base64 blob in `encrypted_content`; that must not
 * become the model-facing summary, so a long whitespace-free base64-shaped
 * value is skipped and the next key is tried.
 */
function firstReadableSnippet(record, keys) {
  if (!isPlainObject(record)) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (!isNonBlankString(value)) continue;
    const trimmed = value.trim();
    if (looksOpaque(trimmed)) continue;
    return trimmed;
  }
  return undefined;
}

function looksOpaque(value) {
  return value.length > 120 && !/\s/u.test(value) && /^[A-Za-z0-9+/=_-]+$/u.test(value);
}

function hasText(value) {
  return isNonBlankString(value);
}

function nonBlankStringOrUndefined(value) {
  return isNonBlankString(value) ? value.trim() : undefined;
}

function describeBlockTypes(blocks) {
  if (blocks.length === 0) return 'none';
  return blocks.map((block) => (typeof block?.type === 'string' ? block.type : typeof block)).join(', ');
}

/** Extract the most specific human-readable error detail from a response. */
function describeError(value) {
  if (typeof value === 'string') return value.trim();
  if (!isPlainObject(value)) return String(value ?? 'unknown error');
  for (const key of ['error', 'message', 'msg', 'detail', 'error_message']) {
    const detail = value[key];
    if (typeof detail === 'string' && detail.trim().length > 0) return detail.trim();
    if (isPlainObject(detail)) {
      const nested = describeError(detail);
      if (nested.length > 0 && nested !== 'unknown error') return nested;
    }
  }
  try {
    return JSON.stringify(value).slice(0, 300);
  } catch {
    return 'unknown error';
  }
}

/**
 * Recursive-descent parser for Python literal reprs. Supports lists, tuples,
 * dicts, single- and double-quoted strings, integers/floats/nan/inf,
 * `True`/`False`/`None`, and the escapes Zhipu actually emits (`\uXXXX`,
 * `\xXX`, `\\`, quotes, and control escapes). Record boundaries come from the
 * bracket nesting, so a comma or brace inside a title cannot split a record.
 */
class PythonLiteralParser {
  constructor(text) {
    this.text = text;
    this.index = 0;
  }

  parseSequence() {
    this.skipWhitespace();
    const values = [this.parseValue()];
    this.skipWhitespace();
    while (this.peek() === ',') {
      this.index += 1;
      this.skipWhitespace();
      if (this.index >= this.text.length) break;
      values.push(this.parseValue());
      this.skipWhitespace();
    }
    if (this.index !== this.text.length) this.fail('unexpected trailing input');
    return values.length === 1 ? values[0] : values;
  }

  parseValue() {
    this.skipWhitespace();
    const char = this.peek();
    if (char === undefined) this.fail('unexpected end of input');
    if (char === '[') return this.parseSequenceContainer(']');
    if (char === '(') return this.parseSequenceContainer(')');
    if (char === '{') return this.parseObject();
    if (char === '"' || char === "'") return this.parseString(char);

    const rest = this.text.slice(this.index);
    const keyword = /^(?:True|true)\b/.exec(rest);
    if (keyword !== null) {
      this.index += keyword[0].length;
      return true;
    }
    const falsy = /^(?:False|false)\b/.exec(rest);
    if (falsy !== null) {
      this.index += falsy[0].length;
      return false;
    }
    const none = /^(?:None|null|undefined)\b/.exec(rest);
    if (none !== null) {
      this.index += none[0].length;
      return null;
    }
    const number = /^[+-]?(?:inf|infinity|nan|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/i.exec(rest);
    if (number !== null) {
      this.index += number[0].length;
      return toNumber(number[0]);
    }
    this.fail('unsupported value');
  }

  parseSequenceContainer(close) {
    this.index += 1;
    const values = [];
    this.skipWhitespace();
    if (this.peek() === close) {
      this.index += 1;
      return values;
    }
    for (;;) {
      values.push(this.parseValue());
      this.skipWhitespace();
      const char = this.peek();
      if (char === ',') {
        this.index += 1;
        this.skipWhitespace();
        if (this.peek() === close) {
          this.index += 1;
          return values;
        }
        continue;
      }
      if (char === close) {
        this.index += 1;
        return values;
      }
      this.fail(`expected "," or "${close}"`);
    }
  }

  parseObject() {
    this.index += 1;
    const object = {};
    this.skipWhitespace();
    if (this.peek() === '}') {
      this.index += 1;
      return object;
    }
    for (;;) {
      const key = this.parseKey();
      this.skipWhitespace();
      if (this.peek() !== ':') this.fail('expected ":"');
      this.index += 1;
      object[key] = this.parseValue();
      this.skipWhitespace();
      const char = this.peek();
      if (char === ',') {
        this.index += 1;
        this.skipWhitespace();
        if (this.peek() === '}') {
          this.index += 1;
          return object;
        }
        continue;
      }
      if (char === '}') {
        this.index += 1;
        return object;
      }
      this.fail('expected "," or "}"');
    }
  }

  parseKey() {
    this.skipWhitespace();
    const char = this.peek();
    if (char === '"' || char === "'") return this.parseString(char);
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.text.slice(this.index));
    if (identifier !== null) {
      this.index += identifier[0].length;
      return identifier[0];
    }
    const number = /^[+-]?\d+/.exec(this.text.slice(this.index));
    if (number !== null) {
      this.index += number[0].length;
      return number[0];
    }
    this.fail('expected an object key');
  }

  parseString(quote) {
    this.index += 1;
    let out = '';
    for (;;) {
      if (this.index >= this.text.length) this.fail('unterminated string');
      const char = this.text[this.index];
      this.index += 1;
      if (char === quote) return out;
      if (char !== '\\') {
        out += char;
        continue;
      }
      if (this.index >= this.text.length) this.fail('unterminated escape');
      const escape = this.text[this.index];
      this.index += 1;
      switch (escape) {
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'v': out += '\v'; break;
        case 'a': out += '\u0007'; break;
        case '0': case '1': case '2': case '3':
        case '4': case '5': case '6': case '7': {
          let digits = escape;
          while (digits.length < 3 && /[0-7]/u.test(this.peek() ?? '')) {
            digits += this.text[this.index];
            this.index += 1;
          }
          out += String.fromCharCode(Number.parseInt(digits, 8));
          break;
        }
        case 'x': out += String.fromCharCode(this.readHex(2)); break;
        case 'u': out += this.readUnicodeEscape(); break;
        case 'U': out += String.fromCodePoint(this.readHex(8)); break;
        case '\n': break;
        case '\\': out += '\\'; break;
        case '"': out += '"'; break;
        case "'": out += "'"; break;
        case '/': out += '/'; break;
        default: out += `\\${escape}`; break;
      }
    }
  }

  readUnicodeEscape() {
    const code = this.readHex(4);
    if (code >= 0xd800 && code <= 0xdbff && this.text.startsWith('\\u', this.index)) {
      const low = Number.parseInt(this.text.slice(this.index + 2, this.index + 6), 16);
      if (Number.isInteger(low) && low >= 0xdc00 && low <= 0xdfff) {
        this.index += 6;
        return String.fromCodePoint(0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00));
      }
    }
    return String.fromCharCode(code);
  }

  readHex(count) {
    const raw = this.text.slice(this.index, this.index + count);
    if (raw.length !== count || !/^[0-9a-fA-F]+$/u.test(raw)) this.fail(`expected ${count} hex digits`);
    this.index += count;
    return Number.parseInt(raw, 16);
  }

  peek() {
    return this.text[this.index];
  }

  skipWhitespace() {
    while (this.index < this.text.length && /\s/u.test(this.text[this.index])) this.index += 1;
  }

  fail(reason) {
    throw new SyntaxError(`${reason} at offset ${this.index}`);
  }
}

function toNumber(raw) {
  const lower = raw.toLowerCase();
  if (lower.endsWith('inf') || lower.endsWith('infinity')) return lower.startsWith('-') ? -Infinity : Infinity;
  if (lower.endsWith('nan')) return Number.NaN;
  return Number(raw);
}
