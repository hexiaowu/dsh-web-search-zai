# @hexiaowu/dsh-web-search-zai

[![npm](https://img.shields.io/npm/v/@hexiaowu/dsh-web-search-zai?label=npm)](https://www.npmjs.com/package/@hexiaowu/dsh-web-search-zai)
[![CI](https://github.com/hexiaowu/dsh-web-search-zai/actions/workflows/ci.yml/badge.svg)](https://github.com/hexiaowu/dsh-web-search-zai/actions/workflows/ci.yml)

[GitHub](https://github.com/hexiaowu/dsh-web-search-zai) · [npm](https://www.npmjs.com/package/@hexiaowu/dsh-web-search-zai) · [English](https://github.com/hexiaowu/dsh-web-search-zai/blob/main/README.en.md) · [更新日志](https://github.com/hexiaowu/dsh-web-search-zai/blob/main/CHANGELOG.md) · [参与开发](https://github.com/hexiaowu/dsh-web-search-zai/blob/main/CONTRIBUTING.md)

这是给 DeepSeek Harness（DSH）加的一个 Z.ai / 智谱 GLM 搜索插件，provider id 为 `zai`。装好并启用后，
模型调用 `web_search` 会走你的 Z.ai 套餐额度或原生搜索 API，不再走 DeepSeek 官方搜索通道——后者每次
搜索都要完整跑一次模型，花的是 DeepSeek 余额。

## 功能

- **两条 Z.ai 通道**：`plan` 走 GLM 编程套餐的 Anthropic 兼容接口，用 `web_search_20250305` 服务端
  工具；`api` 走原生 `/web_search`。`auto` 先试套餐，不行再走原生 API。
- **DeepSeek 兜底**：Z.ai 整体不可用（包括没配 key）时，按顺序尝试已注册的 `deepseek-official` /
  `deepseek-search-api`，`web_search` 不会直接失效。
- **设置页**：打开设置里的 **Z.ai 搜索**，可以填 key、开关兜底、跑一次真实搜索测试。
- **没有运行时依赖，也不需要构建**：Host 端是可直接运行的 ESM，前端是一个手写的 `client.js`。

## 快速开始

1. **安装**
   - Desktop 客户端：侧边栏 **插件 → 添加插件**，填 `@hexiaowu/dsh-web-search-zai`。
   - 插件管理器：`plugin_manager install_bundle -> @hexiaowu/dsh-web-search-zai`。
   - 命令行：`dsh plugin --profile <profile> add @hexiaowu/dsh-web-search-zai`。
2. **第一次安装后重启一次 Harness**，让前端模块加载进来。
3. 打开设置，找到 **Z.ai 搜索**，粘贴 Z.ai / 智谱 key 并保存；可以点 **测试搜索** 验证。
4. 正常使用 `web_search`。

## 环境要求

| 项 | 要求 |
|---|---|
| DSH | `0.2.2-rc.1`；`engines.dsh` 是 `>=0.2.2-rc.1 <0.3.0`，0.3 需要新版本 |
| Profile | 任意可管理的 profile；Desktop 客户端通过插件管理器安装 |
| Node | `^22.19.0 \|\| >=24.0.0`（Desktop 自带 24.21.0） |
| Z.ai | 可用的 Z.ai / 智谱 key；`plan` 需要 GLM 编程套餐，`api` 需要原生搜索资源包或余额 |

## 两条通道与计费

| 通道 | 接口 | 计费 | 特点 |
|---|---|---|---|
| `plan` | `{planBaseURL}/messages`（Anthropic 兼容 + `web_search_20250305`） | 消耗 **GLM 编程套餐额度**，一次搜索等于一次模型调用 | 一般返回标准 Anthropic 结构，摘要可能在 `encrypted_content` 里；也能解析智谱的 `tool_result` Python 字面量 |
| `api` | `{apiBaseURL}/web_search`（原生搜索） | **按次计费**；需要单独的搜索资源包或余额 | 结构化结果，通常几秒内返回 |

`mode` 决定走哪条：

- `auto`（默认）：先走 `plan`；超时、额度不够、接口不支持等失败后，再走 `api`。调用方主动取消时
  直接结束，不兜底。
- `plan`：只走套餐通道；套餐不支持服务端 `web_search` 时直接报错。
- `api`：只走原生搜索 API，稳定，但按次收费。

> 只有编程套餐、没有单独买搜索资源包时，保持 `auto` 就行。plan 成功就不会走 api。
> `auto` 最坏会花 `timeoutMs + min(timeoutMs, 15000)`；Web 预设给 `web_search` 的工具时限默认是 60s，
> 默认配置（25s + 15s）还有余量。如果把 `timeoutMs` 调到 40s 以上，建议只用一条通道，免得撞上工具超时。

## Z.ai 失败后转 DeepSeek（兜底）

`fallbackEnabled` 默认是 `true`。Z.ai 除了“调用方主动取消”之外的失败——没配 key、两条通道都报错、
超时、接口不可用——都会把同一个搜索请求交给已注册的 DeepSeek 搜索服务：

- `fallbackProviders` 默认 `deepseek-official,deepseek-search-api`，按顺序尝试；
- 只使用已注册、`available()` 和 `ready()` 都为 true 的 provider，不可用的跳过；
- 调用方主动取消（`WEB_ABORTED`）不会兜底，避免为已经取消的搜索再花另一家的额度；
- DeepSeek 也失败时，报错信息会分别列出 `zai` 和每个兜底 provider 的原因；
- provider id 仍然是 `zai`，不会改 `web.searchProvider`，也不会触发 `WEB_PROVIDER_AMBIGUOUS`；
- Z.ai key 没配、但兜底可用时，`ready()` 仍返回 true，`web_search` 不会从模型上下文里消失。

> **计费提醒**：兜底会用 DeepSeek 的凭据和额度。`deepseek-official` 是一次 DeepSeek 模型调用，
> `deepseek-search-api` 是原生搜索（按次）。不想兜底就把 `fallbackEnabled` 设为 `false`。
>
> **超时提醒**：如果 Z.ai 是超时失败，`auto` 先花 25s + 15s，60s 的工具时限只剩约 20s 给兜底。
> 可以把 `timeoutMs` 调小，或者把 `fallbackProviders` 改成 `deepseek-search-api,deepseek-official`，
> 让更快的原生搜索先试。

## 设置

### 填写 API Key

四种来源，优先级从高到低：

1. **在设置页填写（推荐）**：打开设置，找到 **Z.ai 搜索**，粘贴 key 后保存。插件会通过 DSH 的凭据
   服务写到 `~/.dsh/.credentials.yaml` 的 `refs.ZAI_CODING_CN_API_KEY`，不会写进 profile 配置。
2. **凭据文件**：在 `~/.dsh/.credentials.yaml` 的 `refs:` 段加一行，然后 `chmod 600`：

   ```yaml
   refs:
     ZAI_CODING_CN_API_KEY: <你的 Z.ai / 智谱 key>
   ```

3. **启动环境变量**：`ZAI_CODING_CN_API_KEY=...` 放在启动 Harness 的环境里（`.env` 也可以）。
4. **插件配置里的 `apiKey`**：优先级最高，只建议临时排查；它会以密钥字段出现在配置里。

`apiKeyEnv` 默认是 `ZAI_CODING_CN_API_KEY`，可以改成任意合法环境变量名。插件每次搜索前通过
`ctx.credentials` 解析，换 key 不用重启。

> **显示 key 的本机接口**：`GET /dsh-web-search-zai/key`，只接受本机 GET，`no-store`，不写日志。
> key 会出现在设置页和浏览器开发者工具的网络面板里；共享屏幕或录屏前注意遮挡。

### 兜底开关和测试

同一个 **Z.ai 搜索** 页面里还有：

- **兜底开关**「Z.ai 不可用时回退到 DeepSeek」：对应 `fallbackEnabled`，保存后下一次搜索生效，
  不用重启；关掉后 Z.ai 全失败就直接报错。
- **测试搜索**：调用本机 Host 的 `GET /dsh-web-search-zai/test`，用同一套 `ctx.web` 跑一次固定
  搜索（最多 3 条），显示结果条数、首条标题或完整错误。它会真的消耗一次 Z.ai
  套餐调用（Z.ai 失败时可能走 DeepSeek）；接口只接受本机 GET，45s 超时。

> 设置页是前端插件提供的。第一次安装或更新后如果看不到 **Z.ai 搜索**，重启一次 Harness 或刷新页面。
> 侧边栏的插件页只负责安装、启停和卸载，没有第二份配置表单。

### region 和接口地址

| region | planBaseURL | apiBaseURL |
|---|---|---|
| `cn`（默认） | `https://open.bigmodel.cn/api/anthropic/v1` | `https://open.bigmodel.cn/api/paas/v4` |
| `global` | `https://api.z.ai/api/anthropic/v1` | `https://api.z.ai/api/paas/v4` |

显式填了 `planBaseURL` / `apiBaseURL` 就以填的为准。国内 key 用 `cn`，海外 key 用 `global`。

### 配置项

所有字段改完下一次搜索就生效，不用重启。

| 字段 | 默认 | 说明 |
|---|---|---|
| `mode` | `auto` | `auto` / `plan` / `api` |
| `region` | `cn` | `cn` / `global`，决定接口地址的默认值 |
| `planBaseURL` | 空（按 region） | 套餐通道的接口前缀，插件会追加 `/messages` |
| `apiBaseURL` | 空（按 region） | 原生搜索的接口前缀，插件会追加 `/web_search` |
| `apiKey` | 空 | 直接写在配置里的 key（不推荐长期使用） |
| `apiKeyEnv` | `ZAI_CODING_CN_API_KEY` | 凭据名 |
| `model` | `glm-4.6` | plan 通道使用的模型 |
| `apiVersion` | `2023-06-01` | `anthropic-version` 请求头 |
| `maxTokens` | `4096` | plan 通道的 `max_tokens` |
| `maxUses` | `3` | plan 通道里 `web_search` 工具最多使用几次 |
| `searchEngine` | `search_std` | 原生搜索的 `search_engine` |
| `count` | `10` | 原生搜索请求的结果数（1–50） |
| `timeoutMs` | `25000` | plan 通道超时；api 通道取 `min(timeoutMs, 15000)` |
| `fallbackEnabled` | `true` | Z.ai 全失败时是否转 DeepSeek |
| `fallbackProviders` | `deepseek-official,deepseek-search-api` | 兜底 provider 的 id，用逗号分隔，按顺序尝试 |

## 安全与隐私

- key 存在 DSH 凭据库（`~/.dsh/.credentials.yaml` 的 `refs`），不写 profile 配置，也不写会话日志。
- `GET /dsh-web-search-zai/key` 会把当前 key 返回给本机设置页（只监听本机、`no-store`、不写日志）；
  key 也会出现在浏览器开发者工具的网络面板里。共享屏幕或录屏前请先隐藏。
- `GET /dsh-web-search-zai/test` 会真的发起一次搜索，可能消耗 Z.ai 套餐调用或 DeepSeek 额度。
- 搜索词会发给 Z.ai；开了兜底后，Z.ai 全失败时同一个搜索词也会发给 DeepSeek。
- 插件没有遥测或分析上报；除了这些搜索请求，不会往外发数据。
- `apiKey` 直接写在配置里是应急写法，优先级最高；日常建议用凭据库，避免 key 落进 profile 配置。

## 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 设置里没有 **Z.ai 搜索** | 前端插件还没加载：第一次安装或更新后重启一次 Harness，或者刷新页面。侧边栏的插件页只负责安装、启停。 |
| `web_search` 从模型上下文里消失 | `ready()` 返回 false：Z.ai key 没配，同时也没有可用的 DeepSeek 兜底。补 key，或者检查兜底 provider 的凭据。 |
| Z.ai 全挂了，但 `web_search` 还能用 | 正常：`fallbackEnabled=true` 时会转 DeepSeek。不想兜底就设为 `false`。 |
| Z.ai 和 DeepSeek 都失败 | `WEB_PROVIDER_ERROR`，报错信息会逐条列出 `zai` 和每个兜底 provider 的原因。 |
| `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` | `planBaseURL` / `apiBaseURL` 不是合法的绝对 URL，或者 `timeoutMs` 不是正整数。 |
| `WEB_PROVIDER_CREDENTIAL_MISSING` | 没解析到 Z.ai key，同时兜底不可用或被禁用。 |
| HTTP 401 / 403 | key 和 region 不匹配，或者 key 没有对应套餐/搜索权限。 |
| HTTP 429 / code `1113` | 余额不足或没有可用资源包；`api` 通道要单独开通搜索资源包；`fallbackEnabled=true` 时会转 DeepSeek。 |
| HTTP 401 / code `1000`（模型接口） | key 被模型/套餐接口拒绝；确认编程套餐 key 有效，账号没有欠费或风控。 |
| 免费模型能调通，但搜不出结果 | 免费模型不执行服务端 `web_search`（`web_search_requests = 0`）；plan 通道要用付费模型（默认 `glm-4.6`）。 |
| plan 通道 400，提示不支持 `web_search` | 这个套餐接口不支持服务端 web_search；`auto` 会继续试 api/DeepSeek。 |
| plan 通道超时 | 套餐通道是一次完整模型调用，可能比较慢；调大 `timeoutMs`，或者改用 `api`。 |
| 中文标题乱码 | 智谱的 Python 字面量会用 `\uXXXX` 转义；解析器会解码。仍然乱码的话，请附 `docs/raw-plan.json` 的结构提交 issue。 |

## 卸载 / 回滚

在侧边栏 **插件 → 已安装插件** 里找到 **Z.ai 网页搜索**，卸载（或者 `plugin_manager remove_bundle`），
然后重启 Harness。`- id: web` 会回到基础 bundle 的 `searchProvider: deepseek-official` /
`fetchProvider: http`，搜索重新走 DeepSeek。凭据库里的 Z.ai key 不动，可以留着。

## 开发

```sh
npm install
npm test          # 72 个测试用例
npm run check     # 语法检查 + 全部测试（发布前也会跑）
npm run probe     # 真实接口冒烟测试；需要 ZAI_CODING_CN_API_KEY
```

开发约定、目录结构、本地安装和测试细节见 [CONTRIBUTING.md](https://github.com/hexiaowu/dsh-web-search-zai/blob/main/CONTRIBUTING.md)。

## License

MIT
