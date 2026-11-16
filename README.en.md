# @hexiaowu/dsh-web-search-zai

[![npm](https://img.shields.io/npm/v/@hexiaowu/dsh-web-search-zai?label=npm)](https://www.npmjs.com/package/@hexiaowu/dsh-web-search-zai)
[![CI](https://github.com/hexiaowu/dsh-web-search-zai/actions/workflows/ci.yml/badge.svg)](https://github.com/hexiaowu/dsh-web-search-zai/actions/workflows/ci.yml)

[GitHub](https://github.com/hexiaowu/dsh-web-search-zai) · [npm](https://www.npmjs.com/package/@hexiaowu/dsh-web-search-zai) · [中文](https://github.com/hexiaowu/dsh-web-search-zai/blob/main/README.md) · [Changelog](https://github.com/hexiaowu/dsh-web-search-zai/blob/main/CHANGELOG.md)

A **Z.ai / Zhipu GLM** search provider (`zai`) for the DeepSeek Harness `ctx.web` seam. Once selected,
`web_search` uses your GLM coding plan or the native Z.ai search API instead of the DeepSeek official
search channel (which spends a full model call per search).

## What you get

- **`plan` channel**: Anthropic-compatible Messages endpoint with the `web_search_20250305` server tool;
  billed against the GLM coding plan.
- **`api` channel**: native `/web_search`; billed per call, requires a search resource package.
- **`auto`**: try `plan`, fall back to `api`.
- **DeepSeek fallback**: if every Z.ai attempt fails (including a missing key), try the registered
  `deepseek-official` / `deepseek-search-api` providers so `web_search` stays usable.
- **One Settings page**: **Settings → Z.ai 搜索** for the key, fallback switch, and a live test search.
- No build step and no runtime dependencies; the Host half is plain ESM.

## Quick start

1. Install:
   - Desktop: **Plugins** in the sidebar → **Add plugin** → `@hexiaowu/dsh-web-search-zai`.
   - Plugin manager: `plugin_manager install_bundle -> @hexiaowu/dsh-web-search-zai`.
   - CLI: `dsh plugin --profile <profile> add @hexiaowu/dsh-web-search-zai`.
2. Restart Harness once after the first install (loads the browser half).
3. Open **Settings → Z.ai 搜索**, paste your Z.ai / Zhipu key, save, then optionally click **Test search**.
4. Use `web_search` normally.

## Requirements

| Item | Requirement |
|---|---|
| DSH | `0.2.2-rc.1`; `engines.dsh` is `>=0.2.2-rc.1 <0.3.0` |
| Profile | Any manageable profile; Desktop uses the plugin manager |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Z.ai | A valid key; `plan` needs a GLM coding plan, `api` needs a search resource package/balance |

## Channels and billing

| Channel | Endpoint | Billing | Notes |
|---|---|---|---|
| `plan` | `{planBaseURL}/messages` | GLM coding-plan quota; one search = one model call | Standard Anthropic layout (excerpts may be in `encrypted_content`), also parses Zhipu `tool_result` reprs |
| `api` | `{apiBaseURL}/web_search` | Per call; requires a search resource package | Structured results, usually a few seconds |

`mode`: `auto` (plan → api), `plan` only, or `api` only. `auto`'s worst case is
`timeoutMs + min(timeoutMs, 15000)`; the Web preset gives `web_search` a 60s tool budget.

## DeepSeek fallback

`fallbackEnabled` defaults to `true`. After every non-cancel Z.ai failure, the plugin calls the
registered DeepSeek providers in `fallbackProviders` order (`deepseek-official,deepseek-search-api`),
skipping unavailable/unready ones. Caller cancellation never falls back. If all providers fail, the
error lists every reason. The fallback uses DeepSeek credentials/quota, so set `fallbackEnabled: false`
if you want Z.ai only.

## Settings

Open **Settings → Z.ai 搜索**:

- **API key**: writes `refs.ZAI_CODING_CN_API_KEY` through the DSH credential store; it is never written
  into the profile config.
- **Fallback switch**: writes `fallbackEnabled`; applies to the next search.
- **Test search**: one real search through the same `ctx.web` seam (up to 3 results), showing the first
  title/URL or the full error. It consumes one plan call (or DeepSeek quota when Z.ai fails).

Key precedence: literal `apiKey` config > credential store `refs` > launch environment.
`apiKeyEnv` defaults to `ZAI_CODING_CN_API_KEY`.

| Region | planBaseURL | apiBaseURL |
|---|---|---|
| `cn` (default) | `https://open.bigmodel.cn/api/anthropic/v1` | `https://open.bigmodel.cn/api/paas/v4` |
| `global` | `https://api.z.ai/api/anthropic/v1` | `https://api.z.ai/api/paas/v4` |

All config fields are volatile and apply to the next search without a restart.

## Security and privacy

- The key lives in `~/.dsh/.credentials.yaml` (`refs`), never in the profile config or session logs.
- `GET /dsh-web-search-zai/key` returns the current key to the local Settings page (loopback-only, GET,
  `no-store`, no logging). The key is visible in browser DevTools; hide it before screen sharing.
- `GET /dsh-web-search-zai/test` performs a real search and may spend Z.ai or DeepSeek quota.
- Search queries go to Z.ai; with the fallback enabled, a failed Z.ai query is also sent to DeepSeek.
- No telemetry.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No **Z.ai 搜索** in Settings | Restart Harness once after install/update, or refresh the page |
| `web_search` disappears | The Z.ai key is missing and no DeepSeek fallback is ready |
| Z.ai fails but search works | DeepSeek fallback ran; disable it with `fallbackEnabled: false` if unwanted |
| HTTP 401/403 | Wrong key/region, or the key lacks the plan/search permission |
| HTTP 429 / `1113` | No balance or search resource package; `api` needs its own package |
| HTTP 401 / `1000` on the model endpoint | The key was rejected by the plan/model endpoint; check the coding plan and account status |
| Free models return no results | Free models do not execute server-side `web_search`; use a paid model such as `glm-4.6` |

## Development

```sh
npm install
npm test
npm run check
npm run probe   # real endpoints; needs ZAI_CODING_CN_API_KEY
```

See [CONTRIBUTING.md](https://github.com/hexiaowu/dsh-web-search-zai/blob/main/CONTRIBUTING.md) for the
repo layout and test details.

## License

MIT
