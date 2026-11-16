# Changelog

## 0.1.1 — 2026-11-15

- Rewrote the README for end users; split developer notes into `CONTRIBUTING.md`; added `README.en.md`.
- Prepared the first release for GitHub Actions Trusted Publishing (OIDC) + provenance; `0.1.0` was
  published manually.
- No runtime behavior changes since 0.1.0.

## 0.1.0 — 2026-11-15

- Initial release of `@hexiaowu/dsh-web-search-zai`: a Z.ai / Zhipu GLM search provider for the
  DeepSeek Harness `ctx.web` seam.
- Provider id `zai`, registered as `searchProvider: zai` with `fetchProvider: http` restated.
- Two channels:
  - `plan`: Anthropic-compatible Messages endpoint with the `web_search_20250305` server tool,
    billed against the GLM coding plan.
  - `api`: native `/web_search` endpoint, billed per call / search resource package.
- `mode`: `auto` (plan → api), `plan`, `api`; per-channel timeouts and structured `WebError`s.
- DeepSeek fallback: `deepseek-official` then `deepseek-search-api` when every Z.ai attempt fails
  (including a missing Z.ai key). Caller cancellation never falls back.
- Parsing: standard Anthropic `web_search_tool_result` blocks, Zhipu `tool_result` Python-repr
  payloads, `encrypted_content` excerpts, `link`/`url` aliases, `\uXXXX` decoding, URL dedupe.
- Settings → Z.ai 搜索 (a `settings.section` like `dsh-mcp-link`):
  - API key form backed by the DSH credential store (`ZAI_CODING_CN_API_KEY`).
  - Show/hide eye control inside the key input; the saved key is read from a local loopback
    endpoint for display.
  - Fallback switch (`fallbackEnabled`) and a real "test search" button.
- Local-only endpoints: `GET /dsh-web-search-zai/test` and `GET /dsh-web-search-zai/key`
  (loopback, GET, `no-store`, no logging).
- Tests: 72 `*.test.mjs` cases (Node 20.19.2 and 24.21.0); `node --test test/` additionally
  discovers `probe.mjs` as a no-op under the test runner.
