import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseApiResponse,
  parsePlanResponse,
  parseSearchPayload,
  parseStructuredText,
  SearchParseError,
} from '../lib/parse.js';

const ZHIPU_REPR = "[{'text': [{'title': '某标题', 'link': 'https://example.com/a', 'content': '摘要正文……', 'refer': 'ref_1'}, {'title': '另一条', 'link': 'https://example.com/b', 'content': '……'}]}]";

test('standard Anthropic layout: result blocks plus citation excerpts', () => {
  const response = {
    id: 'msg_1',
    content: [
      {
        type: 'text',
        text: 'Here is a summary.',
        citations: [
          { type: 'web_search_result_location', url: 'https://a.example/1', title: 'A', cited_text: 'citation excerpt for A' },
        ],
      },
      {
        type: 'web_search_tool_result',
        tool_use_id: 'toolu_1',
        content: [
          { type: 'web_search_result', url: 'https://a.example/1', title: 'Article A', page_age: '2026-11-15' },
          { type: 'web_search_result', url: 'https://b.example/2', title: 'Article B' },
        ],
      },
    ],
  };

  const { sources, truncated } = parsePlanResponse(response);
  assert.equal(truncated, false);
  assert.equal(sources.length, 2);
  assert.deepEqual(sources[0], {
    url: 'https://a.example/1',
    title: 'Article A',
    snippet: 'citation excerpt for A',
    summary: 'citation excerpt for A',
    publishedAt: '2026-11-15',
  });
  assert.deepEqual(sources[1], { url: 'https://b.example/2', title: 'Article B' });
});

test('Zhipu tool_result repr: link after title, Chinese intact, snippet mirrored to summary', () => {
  const { sources } = parsePlanResponse({
    content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: ZHIPU_REPR }],
  });

  assert.equal(sources.length, 2);
  assert.equal(sources[0].url, 'https://example.com/a');
  assert.equal(sources[0].title, '某标题');
  assert.equal(sources[0].snippet, '摘要正文……');
  assert.equal(sources[0].summary, '摘要正文……');
  assert.equal(sources[1].url, 'https://example.com/b');
  assert.equal(sources[1].title, '另一条');
});

test('Zhipu repr: link before title and comma-separated records stay two records', () => {
  const repr = "{'link':'https://a.example/1','title':'A'}, {'link':'https://b.example/2','title':'B'}";
  const sources = parseSearchPayload(repr);

  assert.equal(sources.length, 2);
  assert.deepEqual(sources.map((source) => source.url), ['https://a.example/1', 'https://b.example/2']);
  assert.deepEqual(sources.map((source) => source.title), ['A', 'B']);

  const wrapped = parsePlanResponse({ content: [{ type: 'tool_result', content: repr }] });
  assert.deepEqual(wrapped.sources, sources);
});

test('Zhipu repr: a missing title is allowed and the body still becomes the snippet', () => {
  const sources = parseSearchPayload("{'link':'https://c.example/3','content':'only body'}");

  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, 'https://c.example/3');
  assert.equal(sources[0].title, undefined);
  assert.equal(sources[0].snippet, 'only body');
  assert.equal(sources[0].summary, 'only body');
});

test('Zhipu repr: \\uXXXX escapes decode to Chinese, including surrogate pairs', () => {
  const sources = parseSearchPayload("{'title':'\\u4e2d\\u6587','link':'https://c.example/3'}");
  assert.equal(sources[0].title, '中文');

  const emoji = parseSearchPayload("{'title':'\\ud83d\\ude00 smile','link':'https://c.example/4'}");
  assert.equal(emoji[0].title, '😀 smile');
});

test('native /web_search layout: link/content/publish_date aliases', () => {
  const { sources } = parseApiResponse({
    code: 200,
    search_result: [
      {
        title: '标题',
        link: 'https://x.example/1',
        content: '内容摘要',
        publish_date: '2026-11-15',
        media: '来源媒体',
        refer: 'ref_1',
      },
    ],
    request_id: 'req-1',
  });

  assert.deepEqual(sources, [{
    url: 'https://x.example/1',
    title: '标题',
    snippet: '内容摘要',
    summary: '内容摘要',
    publishedAt: '2026-11-15',
  }]);
});

test('dedupe: trailing slash, fragment, and host case collapse to the first source', () => {
  const sources = parseSearchPayload([
    { url: 'https://Example.com/a/', title: 'first' },
    { url: 'https://example.com/a#section', title: 'second' },
    { url: 'https://example.com/a', title: 'third' },
    { url: 'https://example.com/b', title: 'other' },
  ]);

  assert.deepEqual(sources.map((source) => source.title), ['first', 'other']);
});

test('records without an absolute http(s) URL are dropped', () => {
  const sources = parseSearchPayload([
    { url: 'not a url', title: 'broken' },
    { url: '/relative/path', title: 'relative' },
    { url: 'javascript:alert(1)', title: 'script' },
    { link: 'https://ok.example/x', title: 'ok' },
  ]);

  assert.deepEqual(sources.map((source) => source.url), ['https://ok.example/x']);
});

test('a response with no result block raises WEB_PROVIDER_ERROR', () => {
  assert.throws(
    () => parsePlanResponse({ content: [{ type: 'text', text: 'The model answered from memory.' }] }),
    (error) => {
      assert.ok(error instanceof SearchParseError);
      assert.equal(error.code, 'WEB_PROVIDER_ERROR');
      assert.match(error.message, /may not have triggered server-side web_search/u);
      return true;
    },
  );

  assert.throws(
    () => parseApiResponse({ code: 200, search_result: [] }),
    (error) => error.code === 'WEB_PROVIDER_ERROR' && /no result with a usable http\(s\) URL/u.test(error.message),
  );
});

test('standard Zhipu layout: the excerpt lives in encrypted_content', () => {
  const excerpt = '3小时前 — 美联储金融稳定报告：AI成为华尔街头号金融风险.';
  const { sources } = parsePlanResponse({
    content: [
      { type: 'thinking', thinking: '…' },
      { type: 'server_tool_use', id: 'toolu_1', name: 'web_search', input: { query: 'q' } },
      {
        type: 'web_search_tool_result',
        tool_use_id: 'toolu_1',
        content: [{
          type: 'web_search_result',
          title: 'AI 日报',
          url: 'https://aihot.news/daily',
          encrypted_content: excerpt,
          page_age: null,
        }],
      },
      { type: 'text', text: '…' },
    ],
  });

  assert.equal(sources.length, 1);
  assert.equal(sources[0].title, 'AI 日报');
  assert.equal(sources[0].snippet, excerpt);
  assert.equal(sources[0].summary, excerpt);
  assert.equal(sources[0].publishedAt, undefined);
});

test('an opaque base64 encrypted_content is skipped instead of becoming the summary', () => {
  const opaque = 'A'.repeat(200);
  const { sources } = parsePlanResponse({
    content: [{
      type: 'web_search_tool_result',
      content: [{
        type: 'web_search_result',
        title: 'Opaque',
        url: 'https://x.example/1',
        encrypted_content: opaque,
      }],
    }],
  });

  assert.equal(sources.length, 1);
  assert.equal(sources[0].snippet, undefined);
  assert.equal(sources[0].summary, undefined);
});

test('a real content excerpt wins over encrypted_content', () => {
  const sources = parseSearchPayload([{
    title: 'T',
    url: 'https://x.example/2',
    content: 'real abstract',
    encrypted_content: 'other text',
  }]);
  assert.equal(sources[0].snippet, 'real abstract');
});

test('a non-200 native code names the code and request id', () => {
  assert.throws(
    () => parseApiResponse({ code: 429, message: 'rate limited', request_id: 'req-9' }),
    (error) => error.code === 'WEB_PROVIDER_ERROR'
      && /code 429/u.test(error.message)
      && /req-9/u.test(error.message)
      && /rate limited/u.test(error.message),
  );
});

test('double-encoded payloads: JSON-inside-a-string and Python-repr-inside-a-string', () => {
  const jsonInner = JSON.stringify([{ title: 'nested json', url: 'https://n.example/1' }]);
  assert.deepEqual(parseSearchPayload(jsonInner).map((source) => source.url), ['https://n.example/1']);

  const reprInner = JSON.stringify("[{'title': 'nested repr', 'link': 'https://n.example/2'}]");
  const sources = parseSearchPayload(reprInner);
  assert.equal(sources[0].title, 'nested repr');
  assert.equal(sources[0].url, 'https://n.example/2');
});

test('record boundaries follow bracket nesting: commas and braces inside values do not split records', () => {
  const repr = "[{'title': 'a } b, c [d]', 'link': 'https://e.example/1'}, {'title': 'second', 'link': 'https://e.example/2'}]";
  const sources = parseSearchPayload(repr);

  assert.equal(sources.length, 2);
  assert.equal(sources[0].title, 'a } b, c [d]');
  assert.deepEqual(sources.map((source) => source.url), ['https://e.example/1', 'https://e.example/2']);
});

test('python literals: True/False/None and \\x escapes', () => {
  const parsed = parseStructuredText("[{'a': True, 'b': False, 'c': None, 'title': '\\x41', 'link': 'https://f.example/1'}]");

  assert.ok(Array.isArray(parsed));
  assert.equal(parsed[0].a, true);
  assert.equal(parsed[0].b, false);
  assert.equal(parsed[0].c, null);
  assert.equal(parsed[0].title, 'A');
});

test('a URL inside a snippet stays part of that record', () => {
  const sources = parseSearchPayload([
    { title: 't', link: 'https://g.example/1', content: 'see https://other.example/x for details' },
  ]);

  assert.equal(sources.length, 1);
  assert.equal(sources[0].snippet, 'see https://other.example/x for details');
});

test('Zhipu repr nested under a text block: tool_result.content as an array', () => {
  const { sources } = parsePlanResponse({
    content: [{ type: 'tool_result', content: [{ type: 'text', text: ZHIPU_REPR }] }],
  });

  assert.equal(sources.length, 2);
  assert.equal(sources[0].title, '某标题');
});

test('top-level single dict and trailing commas are tolerated', () => {
  assert.equal(parseSearchPayload("{'title':'solo','link':'https://h.example/1',}").length, 1);
  assert.equal(parseSearchPayload("[{'title':'x','link':'https://h.example/2'},]").length, 1);
});

test('plain prose is not treated as a structured payload', () => {
  assert.equal(parseStructuredText('The answer is in the citation above.'), undefined);
  assert.equal(parseSearchPayload('no results here').length, 0);
});

test('citation-only text blocks never fabricate sources', () => {
  assert.throws(
    () => parsePlanResponse({
      content: [{
        type: 'text',
        text: 'No tool ran.',
        citations: [{ url: 'https://cite.example/x', cited_text: 'quoted text' }],
      }],
    }),
    (error) => error.code === 'WEB_PROVIDER_ERROR',
  );
});
