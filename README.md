# @hexiaowu/dsh-web-search-zai

[![npm](https://img.shields.io/npm/v/@hexiaowu/dsh-web-search-zai?label=npm)](https://www.npmjs.com/package/@hexiaowu/dsh-web-search-zai)
[![CI](https://github.com/hexiaowu/dsh-web-search-zai/actions/workflows/ci.yml/badge.svg)](https://github.com/hexiaowu/dsh-web-search-zai/actions/workflows/ci.yml)

[GitHub](https://github.com/hexiaowu/dsh-web-search-zai) · [npm](https://www.npmjs.com/package/@hexiaowu/dsh-web-search-zai) · [English](https://github.com/hexiaowu/dsh-web-search-zai/blob/main/README.en.md) · [Changelog](https://github.com/hexiaowu/dsh-web-search-zai/blob/main/CHANGELOG.md) · [Contributing](https://github.com/hexiaowu/dsh-web-search-zai/blob/main/CONTRIBUTING.md) · [Releasing](https://github.com/hexiaowu/dsh-web-search-zai/blob/main/RELEASING.md)

给 DeepSeek Harness（DSH）的 `ctx.web` 搜索通道加一个 **Z.ai / 智谱 GLM** provider（id `zai`）。
安装并选中 `zai` 后，模型调 `web_search` 走你的 Z.ai 套餐额度或原生搜索 API，而不是 DeepSeek 官方通道
（后者每次搜索都是一次完整模型调用，扣 DeepSeek 余额）。

## 你能得到什么

- **两条 Z.ai 通道**：`plan` 用 GLM 编程套餐的 Anthropic 兼容端点 + `web_search_20250305` 服务端工具；
  `api` 用原生 `/web_search`。`auto` 先走套餐，失败再走原生 API。
- **DeepSeek 兜底**：Z.ai 整体不可用（包括没配 key）时，自动按顺序尝试已注册的
  `deepseek-official` / `deepseek-search-api`，`web_search` 不会直接失效。
- **一个设置页**：设置（齿轮）→ **Z.ai 搜索**，可以填 key、切换是否兜底、跑一次真实搜索测试。
- **无运行时依赖、无构建步骤**：Host 半是直接可执行的 ESM；客户端半是一个手写 `client.js`。

## 快速开始

1. **安装**
   - Desktop：**侧边栏 → 插件 → 添加插件**，填 `@hexiaowu/dsh-web-search-zai`。
   - 插件管理器：`plugin_manager install_bundle -> @hexiaowu/dsh-web-search-zai`。
   - CLI：`dsh plugin --profile <profile> add @hexiaowu/dsh-web-search-zai`。
2. **首次安装后重启一次 Harness**（让客户端半进入浏览器 roster）。
3. 打开 **设置（齿轮）→ Z.ai 搜索**，粘贴 Z.ai / 智谱 key，点保存；可直接点 **测试搜索** 验证。
4. 在会话里正常使用 `web_search`。

## 环境要求

| 项 | 要求 |
|---|---|
| DSH | `0.2.2-rc.1`；`engines.dsh` 为 `>=0.2.2-rc.1 <0.3.0`，0.3 需要新版本 |
| Profile | 任意可管理 profile；Desktop 用插件管理器安装 |
| Node | `^22.19.0 \|\| >=24.0.0`（Desktop 自带 24.21.0） |
| Z.ai | 可用的 Z.ai / 智谱 key；`plan` 需要 GLM 编程套餐，`api` 需要原生搜索资源包/余额 |

## 两条通道与计费

| 通道 | 端点 | 计费 | 特点 |
|---|---|---|---|
| `plan` | `{planBaseURL}/messages`（Anthropic 兼容 + `web_search_20250305`） | 消耗 **GLM 编程套餐额度**，一次搜索 = 一次模型调用 | 真实响应通常是标准 Anthropic 布局（摘要可能在 `encrypted_content`），也兼容智谱的 `tool_result` repr |
| `api` | `{apiBaseURL}/web_search`（原生搜索） | **按次计费**；需要单独的搜索资源包/余额 | 结构化返回，通常几秒内完成 |

`mode` 控制走哪条：

- `auto`（默认）：先试 `plan`；失败（超时、额度、端点不支持等）再退到 `api`；调用方取消则立即中止。
- `plan`：只走套餐通道；套餐不支持 server-side `web_search` 时直接报错。
- `api`：只走原生搜索 API；稳定，但会产生按次费用。

> 只有 coding plan、没有单独搜索资源包时：保持 `auto`。plan 成功就不会走 api。
> `auto` 两次尝试的理论上限是 `timeoutMs + min(timeoutMs, 15000)`；Web 预设的工具预算默认 60s，
> 默认配置（25s + 15s）留有余量。把 `timeoutMs` 调到 40s 以上时建议用单一通道，避免撞上工具超时。

## 跨 provider 兜底（Z.ai → DeepSeek）

默认 `fallbackEnabled: true`。Z.ai 的所有非取消尝试都失败后，插件把同一个请求交给已注册的 DeepSeek
搜索 provider：

- `fallbackProviders` 默认 `deepseek-official,deepseek-search-api`，按顺序尝试；
- 只用已注册、`available()` 且 `ready()` 的 provider，不可用的跳过；
- 调用方取消（`WEB_ABORTED`）不会兜底，避免为已取消的搜索花另一家额度；
- DeepSeek 也失败时，错误 message 会列出 `zai` 和每个 fallback 的原因；
- provider id 仍是 `zai`，不改 `web.searchProvider`，不会触发 `WEB_PROVIDER_AMBIGUOUS`；
- Z.ai key 缺失但 fallback 可用时，`ready()` 仍为 true，`web_search` 不会从模型上下文消失。

> **计费提醒**：兜底会使用 DeepSeek 的凭据/额度。`deepseek-official` 是一次 DeepSeek 模型调用，
> `deepseek-search-api` 是原生搜索（按次）。不想兜底就把 `fallbackEnabled` 设为 `false`。
>
> **超时预算**：如果 Z.ai 是超时失败，`auto` 先花 25s + 15s，60s 工具预算只剩约 20s 给 fallback。
> 可以把 `timeoutMs` 调小，或把 `fallbackProviders` 改成 `deepseek-search-api,deepseek-official`
> 让快速的原生搜索先试。

## 设置

### 输入 key

四种来源，优先级从高到低：

1. **设置页（推荐）**：**设置（齿轮）→ Z.ai 搜索**，粘贴 key 后保存。它通过 DSH 凭据服务写到
   `~/.dsh/.credentials.yaml` 的 `refs.ZAI_CODING_CN_API_KEY`，**不会**写进 profile 配置。
   输入框会从本机 loopback 端点读取并**默认明文显示**当前 key；输入框内右侧的眼睛图标可切换明文/掩码。
2. **凭据库文件**：在 `~/.dsh/.credentials.yaml` 的 `refs:` 段加一行，然后 `chmod 600`：

   ```yaml
   refs:
     ZAI_CODING_CN_API_KEY: <你的 Z.ai / 智谱 key>
   ```

3. **启动环境变量**：`ZAI_CODING_CN_API_KEY=...` 放在启动 Harness 的环境里（`.env` 也可以）。
4. **插件配置里的字面 `apiKey`**：优先级最高，只建议临时排查；它会以 secret 字段出现在 Config 里。

`apiKeyEnv` 默认 `ZAI_CODING_CN_API_KEY`，可改成任意合法环境变量名。插件每次搜索前通过
`ctx.credentials` 解析，轮换 key 不需要重启。

> **显示 key 的端点**：`GET /dsh-web-search-zai/key`，仅接受 loopback 的 GET，`no-store`，不写日志。
> key 会出现在本机设置页和浏览器 DevTools 的网络面板；共享屏幕/录屏前建议先点眼睛图标隐藏。

### 回退开关与测试

同一个 **设置 → Z.ai 搜索** 页面还有：

- **回退开关**「Z.ai 不可用时回退到 DeepSeek」：写 `fallbackEnabled`，保存后下一次搜索生效
  （volatile）；关掉后 Z.ai 全失败直接报错。
- **测试搜索**：调用本机 Host 的 `GET /dsh-web-search-zai/test`，用同一套 `ctx.web` 搜索跑一次固定
  query（最多 3 条结果），显示「搜索可用 · N 条结果 · 首条标题」或完整错误。它**会真实消耗一次
  Z.ai 套餐调用**（Z.ai 失败时可能走 DeepSeek）；端点只接受 loopback 的 GET，45s 超时。

> 设置页属于客户端半。首次安装/更新插件后如果没看到 **Z.ai 搜索**，重启一次 Harness 或刷新页面。
> 插件页（侧边栏 → 插件）只负责安装/启停/卸载，不提供第二份配置表单。

### region 与端点

| region | planBaseURL | apiBaseURL |
|---|---|---|
| `cn`（默认） | `https://open.bigmodel.cn/api/anthropic/v1` | `https://open.bigmodel.cn/api/paas/v4` |
| `global` | `https://api.z.ai/api/anthropic/v1` | `https://api.z.ai/api/paas/v4` |

显式填了 `planBaseURL` / `apiBaseURL` 时以显式值为准。国内 key 走 `cn`，海外 key 走 `global`。

### 配置项

全部字段都是 `volatile`，改完下一次搜索生效，不需要重启。

| 字段 | 默认 | 说明 |
|---|---|---|
| `mode` | `auto` | `auto` / `plan` / `api` |
| `region` | `cn` | `cn` / `global`，决定端点默认值 |
| `planBaseURL` | 空（按 region） | 套餐通道 API 前缀，插件追加 `/messages` |
| `apiBaseURL` | 空（按 region） | 原生搜索 API 前缀，插件追加 `/web_search` |
| `apiKey` | 空 | 字面量 key（secret，不推荐长期使用） |
| `apiKeyEnv` | `ZAI_CODING_CN_API_KEY` | 凭据引用名 |
| `model` | `glm-4.6` | plan 通道使用的模型 |
| `apiVersion` | `2023-06-01` | `anthropic-version` 请求头 |
| `maxTokens` | `4096` | plan 通道的 `max_tokens` |
| `maxUses` | `3` | plan 通道 `web_search` 工具最多使用次数 |
| `searchEngine` | `search_std` | 原生搜索的 `search_engine` |
| `count` | `10` | 原生搜索请求的结果数（1–50） |
| `timeoutMs` | `25000` | plan 通道超时；api 通道取 `min(timeoutMs, 15000)` |
| `fallbackEnabled` | `true` | Z.ai 全失败时是否转 DeepSeek 搜索 |
| `fallbackProviders` | `deepseek-official,deepseek-search-api` | 逗号分隔的 fallback provider id，按顺序尝试 |

## 安全与隐私

- key 存在 DSH 凭据库（`~/.dsh/.credentials.yaml` 的 `refs`），不写 profile 配置、不写会话日志。
- `GET /dsh-web-search-zai/key` 会把当前 key 返回给本机设置页（loopback only、`no-store`、不写日志）；
  key 也会出现在浏览器 DevTools 的网络面板。共享屏幕/录屏前请先隐藏。
- `GET /dsh-web-search-zai/test` 会真实发起一次搜索，可能消耗 Z.ai 套餐调用或 DeepSeek 额度。
- 搜索 query 会发给 Z.ai；启用兜底时，Z.ai 全失败后同一个 query 会发给 DeepSeek。
- 插件没有遥测/分析上报；除上述搜索请求外不发送数据。
- `apiKey` 字面量配置是 escape hatch，优先级最高；日常建议用凭据库，避免 key 落进 profile 配置。

## 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 设置里没有 **Z.ai 搜索** | 客户端半未加载：首次安装/更新后重启一次 Harness，或刷新页面；插件页只负责安装/启停 |
| `web_search` 工具从模型上下文消失 | `ready()` 为 false：Z.ai key 没配置，且没有可用 DeepSeek fallback；补 key 或检查 fallback provider 凭据 |
| Z.ai 全挂了但 `web_search` 还能用 | 正常：`fallbackEnabled=true` 时转 DeepSeek；不想兜底把它设为 `false` |
| Z.ai 和 DeepSeek 都失败 | `WEB_PROVIDER_ERROR`，message 会逐条列出 `zai:` 和每个 fallback 的原因 |
| `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` | `planBaseURL` / `apiBaseURL` 不是合法绝对 URL，或 `timeoutMs` 非正整数 |
| `WEB_PROVIDER_CREDENTIAL_MISSING` | 没解析到 Z.ai key，且 fallback 不可用/被禁用 |
| HTTP 401 / 403 | key 与 region 不匹配，或 key 没有对应套餐/搜索权限 |
| HTTP 429 / code `1113` | 余额不足或无可用资源包；`api` 通道需要单独开通搜索资源包；`fallbackEnabled=true` 时会转 DeepSeek |
| HTTP 401 / code `1000`（模型端点） | key 被模型/套餐端点拒绝；确认 coding plan key 有效、账号无欠费/风控 |
| 免费模型能调通但搜不出结果 | 免费模型不执行服务端 `web_search`（`web_search_requests = 0`）；plan 通道要用付费模型（默认 `glm-4.6`） |
| plan 通道 400 且提示不支持 `web_search` | 该套餐端点不支持 server-side web_search；`auto` 会继续试 api/DeepSeek |
| plan 通道超时 | 套餐通道是完整模型调用，可能较慢；调大 `timeoutMs`，或改用 `api` |
| 中文标题乱码 | 智谱的 repr 会用 `\uXXXX` 转义；解析器会解码；仍乱码请附 `docs/raw-plan.json` 的结构提 issue |

## 卸载 / 回滚

在 **侧边栏 → 插件 → 已安装插件** 里找到 **Z.ai 网页搜索**，卸载（或 `plugin_manager remove_bundle`），
重启 Harness。`- id: web` 会回到 base bundle 的 `searchProvider: deepseek-official` /
`fetchProvider: http`，搜索重新走 DeepSeek。凭据库里的 Z.ai key 不参与回滚后的行为，可保留。

## 开发

```sh
npm install
npm test          # 72 个 .test.mjs 用例
npm run check     # 语法检查 + 全部测试（prepublishOnly 也跑这个）
npm run probe     # 真实端点冒烟；需要 ZAI_CODING_CN_API_KEY
```

开发约定、目录结构、本地安装和测试细节见 [CONTRIBUTING.md](https://github.com/hexiaowu/dsh-web-search-zai/blob/main/CONTRIBUTING.md)；
版本与发布流程见 [RELEASING.md](https://github.com/hexiaowu/dsh-web-search-zai/blob/main/RELEASING.md)。

## License

MIT
