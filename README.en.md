# @hexiaowu/dsh-web-search-zai

[![npm](https://img.shields.io/npm/v/@hexiaowu/dsh-web-search-zai?label=npm)](https://www.npmjs.com/package/@hexiaowu/dsh-web-search-zai)
[![CI](https://github.com/hexiaowu/dsh-web-search-zai/actions/workflows/ci.yml/badge.svg)](https://github.com/hexiaowu/dsh-web-search-zai/actions/workflows/ci.yml)

[GitHub](https://github.com/hexiaowu/dsh-web-search-zai) · [npm](https://www.npmjs.com/package/@hexiaowu/dsh-web-search-zai) · [中文](https://github.com/hexiaowu/dsh-web-search-zai/blob/main/README.md) · [Changelog](https://github.com/hexiaowu/dsh-web-search-zai/blob/main/CHANGELOG.md) · [Contributing](https://github.com/hexiaowu/dsh-web-search-zai/blob/main/CONTRIBUTING.md)

A Z.ai / Zhipu GLM search provider (`zai`) for DSH `ctx.web`. Once enabled, `web_search` uses Z.ai
instead of DeepSeek's official search channel.

## Features

- `plan` / `api` channels; `auto` tries the plan, then the native API.
- Optional DeepSeek fallback when Z.ai fails.
- Settings → Z.ai 搜索: key, fallback switch, test search.
- No runtime dependencies, no build step.

## Install

Add `@hexiaowu/dsh-web-search-zai` in **Plugins → Add plugin**, or:

```text
plugin_manager install_bundle -> @hexiaowu/dsh-web-search-zai
```

Restart Harness once. The plugin sets `web.searchProvider` to `zai`; `web_fetch` is unaffected.

## Configure

Open **Settings → Z.ai 搜索** and enter the key. It is stored in the DSH credential store, not in the
profile config. Alternatively use `~/.dsh/.credentials.yaml` (`refs.ZAI_CODING_CN_API_KEY`) or the launch
environment; a literal `apiKey` wins.

The same page has the fallback switch and a test search.

## Channels and billing

| Channel | Billing | Notes |
|---|---|---|
| `plan` | GLM coding-plan quota | Anthropic-compatible endpoint + `web_search_20250305` |
| `api` | Per call | Native `/web_search`; needs a search resource package |

`mode`: `auto` (default, plan then api), `plan`, or `api`.

## Fallback

`fallbackEnabled` defaults to `true`. After a non-cancel Z.ai failure, try
`deepseek-official,deepseek-search-api` in order. This spends DeepSeek quota; disable it with
`fallbackEnabled: false`.

## Main config

| Field | Default | Notes |
|---|---|---|
| `mode` | `auto` | `auto` / `plan` / `api` |
| `region` | `cn` | `cn` uses open.bigmodel.cn, `global` uses api.z.ai |
| `model` | `glm-4.6` | plan-channel model |
| `timeoutMs` | `25000` | plan timeout; api is capped at 15s |
| `fallbackEnabled` | `true` | Fall back to DeepSeek when Z.ai fails |
| `fallbackProviders` | `deepseek-official,deepseek-search-api` | Fallback order |
| `apiKeyEnv` | `ZAI_CODING_CN_API_KEY` | Credential name |

Other fields (`planBaseURL`, `apiBaseURL`, `apiVersion`, `maxTokens`, `maxUses`, `searchEngine`,
`count`, `apiKey`) can be changed in Config; changes apply to the next search.

## Notes

- DSH `0.2.2-rc.1`; Node 22.19+ / 24; Z.ai key (plan or search resource package).
- `region=cn` for mainland keys, `global` for international ones.
- The key is shown in the local Settings page and in browser DevTools; mind screen sharing.
- Test search spends one real call.
- Free models do not run server-side `web_search`; use a paid model (`glm-4.6`) for the plan channel.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No **Z.ai 搜索** in Settings | Restart Harness once, or refresh the page |
| `web_search` disappears | No Z.ai key and no usable DeepSeek fallback |
| HTTP 401 / 403 | Wrong key/region, or the key lacks permission |
| HTTP 429 / `1113` | No balance, or `api` has no search resource package |
| plan 400, `web_search` unsupported | Use `auto` or `api` |
| plan timeout | Raise `timeoutMs`, or switch to `api` |

## Uninstall

Remove **Z.ai 网页搜索** in Plugins → Installed, then restart Harness. `web` returns to
`deepseek-official`.

## Development

See [CONTRIBUTING.md](https://github.com/hexiaowu/dsh-web-search-zai/blob/main/CONTRIBUTING.md).

## License

MIT
