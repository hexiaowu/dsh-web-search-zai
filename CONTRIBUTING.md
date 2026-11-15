# Contributing

## Layout

```
lib/index.js      provider registration, key resolution, DeepSeek fallback, local test/key routes
lib/search.js     plan/api channels, timeouts, WebError mapping
lib/parse.js      Anthropic / Zhipu / native response parsing, URL dedupe, excerpts
lib/util.js       nonBlank, URL normalization, dedupe, previews
client.js         Settings → Z.ai 搜索 (client module table, React)
cordis.patch.yml  bundle patch: insert the row and pin web.searchProvider = zai
test/             parser, HTTP, provider, client and probe tests
```

The Host half is plain ESM; the client half is a hand-written `window.__ModuleLoader__` bundle. There is
no build step.

## Setup

```sh
npm install
npm test          # 72 .test.mjs cases
npm run check     # syntax checks + all tests (also runs from prepublishOnly)
npm run probe     # real Z.ai endpoints; needs ZAI_CODING_CN_API_KEY
```

`devDependencies` exist only for local/CI tests. Do **not** add the `@deepseek-ai/*` host packages to
`dependencies`: the profile resolves the host's copies, and a second schemastery would break the Config
schema identity.

## Tests

- `test/parse.test.mjs` / `test/util.test.mjs`: pure fixtures, no host imports; include link-before-key,
  missing title, `\uXXXX`, `encrypted_content`, dedupe, and bracket-boundary cases.
- `test/search.test.mjs`: channel request shapes, timeouts, abort, HTTP errors, fallback-free channel
  behavior; uses an injected `fetchImpl`.
- `test/index.test.mjs`: provider registration, credential precedence, fallback, local test/key routes.
- `test/client.test.mjs`: fake `window.__ModuleLoader__` + React + ctx; slot registration, password/key
  input, eye toggle, fallback switch, test button.
- `test/probe.test.mjs`: spawns `test/probe.mjs` against a loopback server and checks redaction.
- `test/probe.mjs` is a script, not a test; the test runner ignores it when it sees
  `NODE_TEST_CONTEXT`.

Run with `npm test` (Node 22/24). `node --test test/` on Node 20 additionally discovers `probe.mjs`;
Node 24 rejects a directory argument, so prefer `npm test` or `node --test test/*.test.mjs`.

## Local install

```text
plugin_manager install_bundle -> $(pwd)
```

or use **Sidebar → Plugins → Add plugin** with the absolute directory. After the first install/update,
restart Harness once so the client module enters the browser roster. The config lives in
**Settings → Z.ai 搜索** (`settings.section`, id `web-search-zai`); the bundle page only installs/enables.

## Adding a channel or response shape

- A channel belongs in `lib/search.js`: build the request, call `dispatchJson`, and return
  `{ sources, truncated }`. Keep `WebError` codes: `WEB_PROVIDER_ERROR` for any non-cancel failure,
  `WEB_ABORTED` for caller cancellation.
- A response shape belongs in `lib/parse.js`: extend `collectRecords`/`toSource` and add a fixture to
  `test/parse.test.mjs`. Do not split records with a regex; walk bracket structure.
- Keep the provider's `available()` synchronous/local and `ready()` network-free. The seam calls them
  while selecting/admitting the tool.

## Debugging

- `cordis_inspect_query` host `Config.listConfigs` with `name: "@hexiaowu/dsh-web-search-zai"` shows the
  live entry and its projected schema.
- `Client Slots.listSubTree` for `settings.section` should include `web-search-zai` (order 19).
- `GET /dsh-web-search-zai/key` and `/dsh-web-search-zai/test` are loopback-only; direct curl without
  the browser session may still be gated by the app's auth/route layer.
- With a linked package, changing Host JS needs a plugin-row restart (disable/enable) or a Harness
  restart; changing `client.js` may hot-reload, otherwise refresh.

## Conventions

- ESM, no TypeScript, no bundler, no `postinstall`.
- `package.json` keeps host packages in `peerDependencies`; test-only packages in `devDependencies`.
- Do not log credentials, request bodies, or the key. Errors may include upstream messages but not the key.
- Keep `files`/`exports` current: `lib`, `client.js`, `cordis.patch.yml`, `locale/*.json`, `icon.svg`,
  `README.md`, `README.en.md`, `LICENSE`, `CHANGELOG.md`, `CONTRIBUTING.md`, `RELEASING.md`.
- Before a PR: `npm run check`, `npm pack --dry-run`, and confirm no `docs/findings.md`, raw responses,
  credentials, or `EXECUTION-PLAN.md` are staged.

## Security

`/dsh-web-search-zai/key` intentionally returns the key to the local Settings page (the user asked for
plaintext display). Keep it loopback-only, `no-store`, and out of logs. Do not widen it to remote clients
or add CORS. The test route spends real quota; keep it local and bounded.
