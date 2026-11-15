import assert from 'node:assert/strict';
import test from 'node:test';

/** Capture the browser module-table entry without a real browser. */
let captured;
globalThis.window = {
  __ModuleLoader__: {
    load(module) {
      captured = module;
    },
  },
};
await import('../client.js?client-test');

/** Minimal React surface used by the form's render path. */
const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children };
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}];
  },
  useEffect() {},
  useCallback(fn) {
    return fn;
  },
};

function createClient() {
  assert.ok(captured, 'client.js must register a module');
  assert.equal(captured.id, '@hexiaowu/dsh-web-search-zai');
  return captured.factory((id) => {
    if (id === 'react') return React;
    throw new Error(`unexpected client require: ${id}`);
  });
}

function renderComponent(element) {
  let current = element;
  while (current && typeof current.type === 'function') {
    current = current.type(current.props);
  }
  return current;
}

function walk(node, visit) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node !== 'object') return;
  visit(node);
  if (node.children !== undefined) walk(node.children, visit);
}

function createContext({ form } = {}) {
  const registrations = [];
  const dictionaries = new Map();
  const remoteCalls = [];
  const context = {
    configForms: {
      get(id) {
        assert.equal(id, 'web-search-zai');
        return form;
      },
    },
    effect(fn) {
      return fn();
    },
    locale: {
      bind: () => (key) => key,
      register(namespace, dictionary) {
        dictionaries.set(namespace, dictionary);
        return () => {};
      },
    },
    remote: {
      credentials: {
        async describe(refs) {
          remoteCalls.push(['describe', refs]);
          return {
            ok: true,
            value: { ZAI_CODING_CN_API_KEY: { configured: true, writable: true } },
          };
        },
        async set(ref, value) {
          remoteCalls.push(['set', ref, value]);
          return { ok: true };
        },
      },
    },
    slots: {
      inject(name, register) {
        return register();
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };
  return { context, registrations, dictionaries, remoteCalls };
}

test('registers the Settings section and its icon', () => {
  const client = createClient();
  assert.deepEqual(client.inject, ['slots', 'locale', 'remote', 'remote.credentials', 'configForms']);

  const { context, registrations, dictionaries } = createContext();
  client.apply(context);

  assert.equal(registrations.length, 2);
  const section = registrations.find((entry) => entry.options.name === 'settings.section');
  const icon = registrations.find((entry) => entry.options.name === 'settings.section.icon');
  assert.ok(section, 'the Settings section must be registered');
  assert.ok(icon, 'the Settings section icon must be registered');
  assert.equal(registrations.some((entry) => entry.options.name === 'plugins.bundle.config'), false);

  assert.equal(section.options.id, 'web-search-zai');
  assert.equal(section.options.order, 19);
  assert.equal(section.options.label(), 'nav');
  assert.equal(dictionaries.get('dsh-web-search-zai').zh.keyTitle, 'API Key');
  assert.equal(dictionaries.get('dsh-web-search-zai').en.keyTitle, 'API key');

  const props = section.options.inject();
  assert.equal(typeof props.t, 'function');
  assert.equal(typeof props.describeKey, 'function');
  assert.equal(typeof props.setKey, 'function');

  const page = section.component(props);
  let input;
  let button;
  let toggle;
  walk(page, (node) => {
    if (node.type === 'input' && node.props.type === 'text') input = node;
    if (node.type === 'button' && Array.isArray(node.children) && node.children.includes('save')) button = node;
    if (node.type === 'button' && node.props['aria-pressed'] === true) toggle = node;
  });
  assert.ok(input, 'the Settings section must render a key input');
  assert.equal(input.props.type, 'text');
  assert.equal(input.props.autoComplete, 'off');
  assert.ok(button, 'the Settings section must render a save button');
  assert.equal(typeof button.props.onClick, 'function');
  assert.ok(toggle, 'the key input must have an eye toggle');
  assert.equal(toggle.props['aria-label'], 'hideKey');
  assert.equal(typeof toggle.props.onClick, 'function');
  assert.equal(typeof toggle.children[0].type, 'function');

  const iconNode = icon.component({ size: 16 });
  assert.equal(iconNode.type, 'svg');
  assert.equal(iconNode.props.width, 16);
});

test('the form writes and reads only through the credential seam', async () => {
  const client = createClient();
  const { context, registrations, remoteCalls } = createContext();
  client.apply(context);
  const props = registrations[0].options.inject();

  const described = await props.describeKey(['ZAI_CODING_CN_API_KEY']);
  assert.deepEqual(remoteCalls.shift(), ['describe', ['ZAI_CODING_CN_API_KEY']]);
  assert.equal(described.ok, true);
  assert.equal(described.value.ZAI_CODING_CN_API_KEY.configured, true);

  await props.setKey('ZAI_CODING_CN_API_KEY', 'sk-test-value');
  assert.deepEqual(remoteCalls.shift(), ['set', 'ZAI_CODING_CN_API_KEY', 'sk-test-value']);
});

test('the form never renders the stored key value', () => {
  const client = createClient();
  const { context, registrations } = createContext();
  client.apply(context);
  const props = registrations[0].options.inject();
  const page = registrations[0].component({ view: 'page', ...props });
  const texts = [];
  walk(page, (node) => {
    for (const child of node.children ?? []) if (typeof child === 'string') texts.push(child);
  });
  const joined = texts.join(' ');
  assert.equal(joined.includes('sk-test-value'), false);
  assert.equal(joined.includes('ZAI_CODING_CN_API_KEY'), true);
});

test('the fallback switch writes the live config form', async () => {
  const calls = [];
  const form = {
    getSnapshot: () => ({
      status: 'ready',
      value: { fallbackEnabled: true },
      base: { fallbackEnabled: true },
      writable: true,
      revision: 0,
    }),
    subscribe: () => () => {},
    set: async (field, value) => {
      calls.push(['set', field, value]);
      return true;
    },
    unset: async (field) => {
      calls.push(['unset', field]);
      return true;
    },
  };
  const client = createClient();
  const { context, registrations } = createContext({ form });
  client.apply(context);
  const props = registrations[0].options.inject();
  assert.equal(props.form, form);
  assert.equal(props.testPath, '/dsh-web-search-zai/test');

  const page = registrations[0].component({ view: 'page', ...props });
  let checkbox;
  walk(page, (node) => {
    if (node.type === 'input' && node.props.type === 'checkbox') checkbox = node;
  });
  assert.ok(checkbox, 'the page must render the fallback checkbox');
  assert.equal(checkbox.props.checked, true);
  assert.equal(checkbox.props.disabled, false);

  await checkbox.props.onChange({ target: { checked: false } });
  assert.deepEqual(calls[0], ['set', 'fallbackEnabled', false]);

  await checkbox.props.onChange({ target: { checked: true } });
  assert.deepEqual(calls[1], ['unset', 'fallbackEnabled']);
});

test('the test button calls the host endpoint', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      async json() {
        return { ok: true, count: 1, firstTitle: 'T', firstUrl: 'https://x.example/1' };
      },
    };
  };
  try {
    const client = createClient();
    const { context, registrations } = createContext();
    client.apply(context);
    const props = registrations[0].options.inject();
    const page = registrations[0].component({ view: 'page', ...props });
    let button;
    walk(page, (node) => {
      if (node.type === 'button' && Array.isArray(node.children) && node.children.includes('testRun')) button = node;
    });
    assert.ok(button, 'the page must render the test button');
    await button.props.onClick();
    assert.deepEqual(calls, ['/dsh-web-search-zai/test']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
