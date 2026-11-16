# @hexiaowu/dsh-web-search-zai

[![npm](https://img.shields.io/npm/v/@hexiaowu/dsh-web-search-zai?label=npm)](https://www.npmjs.com/package/@hexiaowu/dsh-web-search-zai)
[![CI](https://github.com/hexiaowu/dsh-web-search-zai/actions/workflows/ci.yml/badge.svg)](https://github.com/hexiaowu/dsh-web-search-zai/actions/workflows/ci.yml)

[GitHub](https://github.com/hexiaowu/dsh-web-search-zai) · [npm](https://www.npmjs.com/package/@hexiaowu/dsh-web-search-zai) · [中文](https://github.com/hexiaowu/dsh-web-search-zai/blob/main/README.md)

A Z.ai / Zhipu GLM search plugin for DeepSeek Harness (DSH). Once enabled, `web_search` uses Z.ai
instead of DeepSeek's official search channel.

## Features

- `plan` / `api` channels; `auto` tries `plan` first, then the native API.
- Optional DeepSeek fallback when Z.ai fails.
- Settings → **Z.ai search** lets you set the API key, toggle the fallback, and run a test search.
- No extra runtime dependencies and no build step.

## Install

Requires DSH `>=0.2.2-rc.1 <0.3.0` (see `engines.dsh` in `package.json`). The package is published on npm and installed by name from npm.

Use the `dsh` launcher bundled with Desktop to add the package to a profile (use the full path if `dsh` is not on your PATH):

```bash
dsh plugin --profile desktop add @hexiaowu/dsh-web-search-zai
```

Restart Harness once; the plugin enables itself automatically, and web fetching is unaffected.

## Configure

Open **Settings → Z.ai search** and enter the API key. It is stored in the DSH credential store, not in
the profile configuration. You can also store it in `~/.dsh/.credentials.yaml`
(`refs.ZAI_CODING_CN_API_KEY`) or set it in Harness's launch environment; a literal `apiKey` takes
precedence.

The same page also lets you toggle the fallback and run a test search.

## Channels and billing

| Channel | Billing | Notes |
|---|---|---|
| `plan` | GLM coding-plan quota | Anthropic-compatible endpoint + `web_search_20250305` |
| `api` | Per call | Native `/web_search`; needs a search resource package |

`mode`: `auto` (default, `plan` then `api`), `plan`, or `api`.

## Fallback

`fallbackEnabled` defaults to `true`. If Z.ai fails (unless the caller cancels), the plugin tries
`deepseek-official` and `deepseek-search-api` in that order. This uses DeepSeek quota; set
`fallbackEnabled: false` to disable it.

## Main settings

| Field | Default | Notes |
|---|---|---|
| `mode` | `auto` | `auto` / `plan` / `api` |
| `region` | `cn` | `cn` uses open.bigmodel.cn; `global` uses api.z.ai |
| `model` | `glm-4.6` | Model for the `plan` channel |
| `timeoutMs` | `25000` | Timeout for `plan`; the `api` channel is capped at 15 seconds |
| `fallbackEnabled` | `true` | Fall back to DeepSeek when Z.ai fails |
| `fallbackProviders` | `deepseek-official,deepseek-search-api` | Fallback order (comma-separated) |
| `apiKeyEnv` | `ZAI_CODING_CN_API_KEY` | Credential name |

The remaining fields (`planBaseURL`, `apiBaseURL`, `apiVersion`, `maxTokens`, `maxUses`, `searchEngine`,
`count`, `apiKey`) can be changed in the plugin configuration; changes take effect on the next search.

## Notes

- DSH `0.2.2-rc.1`; Node 22.19+ or Node 24.
- Z.ai: the `plan` channel needs a coding plan, and the `api` channel needs a search resource package.
  Use `region=cn` for mainland keys and `global` for international ones.
- The API key is visible in the local Settings page and in browser DevTools; be careful when sharing your
  screen.
- A test search makes one real call. Free models do not run server-side `web_search`; use a paid model
  (`glm-4.6`) for the `plan` channel.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No **Z.ai search** in Settings | Restart Harness once, or refresh the page |
| `web_search` disappears | No Z.ai API key and no usable DeepSeek fallback |
| HTTP 401 / 403 | The API key and `region` don't match, or the key lacks the required permission |
| HTTP 429 / error `1113` | No balance, or the `api` channel has no search resource package |
| `plan` channel returns 400 (`web_search` unsupported) | Use `auto` or `api` |
| `plan` channel times out | Increase `timeoutMs`, or switch to `api` |

## Uninstall

```bash
dsh plugin --profile desktop remove @hexiaowu/dsh-web-search-zai
```

Restart Harness; search returns to the DeepSeek official channel.

## License

MIT
