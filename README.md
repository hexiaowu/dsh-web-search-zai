# @hexiaowu/dsh-web-search-zai

[![npm](https://img.shields.io/npm/v/@hexiaowu/dsh-web-search-zai?label=npm)](https://www.npmjs.com/package/@hexiaowu/dsh-web-search-zai)
[![CI](https://github.com/hexiaowu/dsh-web-search-zai/actions/workflows/ci.yml/badge.svg)](https://github.com/hexiaowu/dsh-web-search-zai/actions/workflows/ci.yml)

[GitHub](https://github.com/hexiaowu/dsh-web-search-zai) · [npm](https://www.npmjs.com/package/@hexiaowu/dsh-web-search-zai) · [English](https://github.com/hexiaowu/dsh-web-search-zai/blob/main/README.en.md)

给 DeepSeek Harness（DSH）加一个 Z.ai / 智谱 GLM 搜索插件。启用后，模型的网页搜索会走 Z.ai，
不再走 DeepSeek 官方搜索。

## 功能

- 支持 `plan` / `api` 两条通道；`auto` 先走套餐，失败再走原生。
- Z.ai 失败时可以用 DeepSeek 兜底，也可以关掉这个功能。
- 设置页可以填写 API Key、打开或关闭兜底、跑一次测试搜索。
- 不依赖额外运行时，也不用构建。

## 安装

桌面端在 **插件 → 添加插件** 里填写 `@hexiaowu/dsh-web-search-zai`。也可以用插件管理器：

```text
plugin_manager install_bundle -> @hexiaowu/dsh-web-search-zai
```

安装完成后重启一次 Harness。插件会自动启用，网页抓取不受影响。

## 配置

打开 **设置 → Z.ai 搜索**，填入 API Key 即可。API Key 会写入 DSH 凭据库，不会写进 profile 配置。
也可以写入 `~/.dsh/.credentials.yaml` 的 `refs.ZAI_CODING_CN_API_KEY`，或者用启动环境变量；
配置里的 `apiKey` 优先级最高。

同一个页面还可以打开或关闭兜底，也可以测试搜索。

## 通道与计费

| 通道 | 计费 | 说明 |
|---|---|---|
| `plan` | GLM 编程套餐额度 | Anthropic 兼容接口 + `web_search_20250305` |
| `api` | 按次 | 原生 `/web_search`，需要搜索资源包 |

`mode` 可选 `auto`（默认，先 `plan` 后 `api`）、`plan`、`api`。

## 兜底

`fallbackEnabled` 默认开启。Z.ai 失败（主动取消除外）后，会按 DeepSeek 官方搜索、DeepSeek 原生搜索
的顺序兜底；会消耗 DeepSeek 额度，不想用就关掉。

## 主要配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `mode` | `auto` | `auto` / `plan` / `api` |
| `region` | `cn` | `cn` 走 open.bigmodel.cn，`global` 走 api.z.ai |
| `model` | `glm-4.6` | `plan` 通道使用的模型 |
| `timeoutMs` | `25000` | `plan` 通道超时；`api` 通道最多 15 秒 |
| `fallbackEnabled` | `true` | Z.ai 失败后是否转 DeepSeek 兜底 |
| `fallbackProviders` | `deepseek-official,deepseek-search-api` | 兜底顺序（逗号分隔） |
| `apiKeyEnv` | `ZAI_CODING_CN_API_KEY` | 凭据名称 |

其余字段（`planBaseURL`、`apiBaseURL`、`apiVersion`、`maxTokens`、`maxUses`、`searchEngine`、
`count`、`apiKey`）可以在插件配置里按需修改，改完下一次搜索生效。

## 注意

- 环境：DSH `0.2.2-rc.1`；Node 22.19+ 或 24。
- Z.ai：`plan` 通道需要编程套餐，`api` 通道需要搜索资源包；国内 API Key 用 `cn`，海外用 `global`。
- API Key 会显示在本机设置页，也会出现在浏览器开发者工具的网络面板；共享屏幕时注意遮挡。
- 测试搜索会实际消耗一次调用；免费模型不执行服务端 `web_search`，`plan` 通道请用付费模型（默认 `glm-4.6`）。

## 常见问题

| 现象 | 处理 |
|---|---|
| 设置里没有 **Z.ai 搜索** | 重启一次 Harness，或刷新页面 |
| `web_search` 消失 | API Key 没配，且没有可用的 DeepSeek 兜底 |
| HTTP 401 / 403 | API Key 与 region 不匹配，或 API Key 没有对应权限 |
| HTTP 429 / 错误码 `1113` | 余额不足，或 `api` 通道没有搜索资源包 |
| `plan` 通道返回 400，提示不支持 `web_search` | 用 `auto` 或 `api` |
| `plan` 通道超时 | 调大 `timeoutMs`，或改用 `api` |

## 卸载

在侧边栏 **插件 → 已安装插件** 里卸载 **Z.ai 网页搜索**，重启 Harness。搜索会回到 DeepSeek 官方通道。

## 许可证

MIT
