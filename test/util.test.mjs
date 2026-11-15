import assert from 'node:assert/strict';
import test from 'node:test';
import { dedupeSources, isWebUrl, normalizeUrl, previewText } from '../lib/util.js';

test('isWebUrl accepts only absolute http(s) URLs', () => {
  assert.equal(isWebUrl('https://example.com/a'), true);
  assert.equal(isWebUrl('http://example.com'), true);
  assert.equal(isWebUrl('HTTP://Example.com'), true);
  assert.equal(isWebUrl('/relative'), false);
  assert.equal(isWebUrl('example.com'), false);
  assert.equal(isWebUrl('javascript:alert(1)'), false);
  assert.equal(isWebUrl('mailto:a@b.example'), false);
  assert.equal(isWebUrl('   '), false);
  assert.equal(isWebUrl(undefined), false);
});

test('normalizeUrl drops fragment and trailing slash but keeps the path', () => {
  assert.equal(normalizeUrl('https://Example.COM/a/#frag'), 'https://example.com/a');
  assert.equal(normalizeUrl('https://example.com/'), 'https://example.com');
  assert.equal(normalizeUrl('https://example.com'), 'https://example.com');
  assert.equal(normalizeUrl('https://example.com/a/?q=1'), 'https://example.com/a?q=1');
  assert.equal(normalizeUrl('nope'), undefined);
});

test('dedupeSources keeps the first occurrence', () => {
  const sources = dedupeSources([
    { url: 'https://example.com/a', title: 'first' },
    { url: 'https://example.com/a/', title: 'second' },
    { url: 'broken' },
  ]);
  assert.deepEqual(sources, [{ url: 'https://example.com/a', title: 'first' }]);
});

test('previewText collapses whitespace and bounds the length', () => {
  assert.equal(previewText('a\n\n  b'), 'a b');
  assert.equal(previewText('abcdef', 4), 'abc…');
});
