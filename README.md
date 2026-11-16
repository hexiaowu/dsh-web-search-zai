# @hexiaowu/dsh-web-search-zai

[![npm](https://img.shields.io/npm/v/@hexiaowu/dsh-web-search-zai?label=npm)](https://www.npmjs.com/package/@hexiaowu/dsh-web-search-zai)
[![CI](https://github.com/hexiaowu/dsh-web-search-zai/actions/workflows/ci.yml/badge.svg)](https://github.com/hexiaowu/dsh-web-search-zai/actions/workflows/ci.yml)

[GitHub](https://github.com/hexiaowu/dsh-web-search-zai) · [npm](https://www.npmjs.com/package/@hexiaowu/dsh-web-search-zai) · [English](https://github.com/hexiaowu/dsh-web-search-zai/blob/main/README.en.md)

给 DeepSeek Harness 的 `ctx.web` 加一个 Z.ai / 智谱 GLM 搜索 provider（id `zai`）。启用后
`web_search` 走 Z.ai，不再走 DeepSeek 官方搜索通道。

## 功能

- `plan` / `api` 两条通道；`auto` 先套餐，失败再原生。
- Z.ai 失败时可转 DeepSeek 兜底，可关。
- 设置页填 key、开关兜底、测试搜索。
- 无运行时依赖，无构建。

## 安装

Desktop 在 **插件 → 添加插件** 里填 `@hexiaowu/dsh-web-search-zai`；或者：

```text
plugin_manager install_bundle -> @hexiaowu/dsh-web-search-zai
```

装完重启一次 Harness。插件会自动把 `web.searchProvider` 设为 `zai`，`web_fetch` 不受影响。

## 配置

打开 **设置 → Z.ai 搜索**，填 key 即可。key 写入 DSH 凭据库，不写 profile 配置。
也可以放 `~/.dsh/.credentials.yaml` 的 `refs.ZAI_CODING_CN_API_KEY`，或用启动环境变量；
配置里的 `apiKey` 优先级最高。

同一个页面可以开关兜底、跑一次测试搜索。

## 通道与计费

| 通道 | 计费 | 说明 |
|---|---|---|
| `plan` | GLM 编程套餐额度 | Anthropic 兼容接口 + `web_search_20250305` |
| `api` | 按次 | 原生 `/web_search`，需要搜索资源包 |

`mode`：`auto`（默认，先 plan 后 api）、`plan`、`api`。

## 兜底

`fallbackEnabled` 默认开。Z.ai 失败（主动取消除外）后按
`deepseek-official,deepseek-search-api` 顺序转 DeepSeek；会花 DeepSeek 额度，不想用就关掉。

## 主要配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `mode` | `auto` | `auto` / `plan` / `api` |
| `region` | `cn` | `cn` 用 open.bigmodel.cn，`global` 用 api.z.ai |
| `model` | `glm-4.6` | plan 通道模型 |
| `timeoutMs` | `25000` | plan 超时；api 最多 15s |
| `fallbackEnabled` | `true` | Z.ai 失败后是否转 DeepSeek |
| `fallbackProviders` | `deepseek-official,deepseek-search-api` | 兜底顺序 |
| `apiKeyEnv` | `ZAI_CODING_CN_API_KEY` | 凭据名 |

其余字段（`planBaseURL`、`apiBaseURL`、`apiVersion`、`maxTokens`、`maxUses`、`searchEngine`、
`count`、`apiKey`）按需在 Config 里改，改完下一次搜索生效。

## 注意

- DSH `0.2.2-rc.1`；Node 22.19+ / 24；Z.ai key（plan 要编程套餐，api 要资源包）。
- 国内 key 用 `region=cn`，海外用 `global`。
- key 会显示在本机设置页，也会出现在浏览器开发者工具的网络面板；共享屏幕注意。
- 测试搜索会真实消耗一次调用。
- 免费模型不执行服务端 `web_search`；plan 用付费模型（默认 `glm-4.6`）。

## 常见问题

| 现象 | 处理 |
|---|---|
| 设置里没有 **Z.ai 搜索** | 重启一次 Harness，或刷新页面 |
| `web_search` 消失 | key 没配，且没有可用的 DeepSeek 兜底 |
| HTTP 401 / 403 | key 与 region 不匹配，或 key 没有对应权限 |
| HTTP 429 / `1113` | 余额不足，或 `api` 没有搜索资源包 |
| plan 400，提示不支持 `web_search` | 用 `auto` 或 `api` |
| plan 超时 | 调大 `timeoutMs`，或改用 `api` |

## 卸载

在侧边栏 **插件 → 已安装插件** 里卸载 **Z.ai 网页搜索**，重启 Harness。`web` 会回到
`deepseek-official`。

## License

MIT
