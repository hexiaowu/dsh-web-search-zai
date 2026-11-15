# @hexiaowu/dsh-web-search-zai

[GitHub](https://github.com/hexiaowu/dsh-web-search-zai) · [npm](https://www.npmjs.com/package/@hexiaowu/dsh-web-search-zai) · [Changelog](CHANGELOG.md)

给 DeepSeek Harness（DSH）的 `ctx.web` 搜索通道加一个 **Z.ai / 智谱 GLM** provider。
装上并把 `web.searchProvider` 指到 `zai` 之后，模型调 `web_search` 走的是你的 Z.ai 套餐额度或
原生搜索 API，而不是 DeepSeek 官方通道（后者每次搜索都是一次完整模型调用，扣 DeepSeek 余额）。

- Provider id：`zai`
- 宿主版本：DSH `0.2.2-rc.1`
- 运行时：Node `^22.19.0 || >=24.0.0`（Desktop 自带 Node 24.21.0）
- 不打包构建步骤、无运行时依赖，`lib/` 是直接可执行的 ESM

## 两条通道

| 通道 | 端点 | 计费 | 特点 |
|---|---|---|---|
| `plan` | `{planBaseURL}/messages`（Anthropic 兼容 + `web_search_20250305` 服务端工具） | 消耗 **GLM 编程套餐额度**，一次搜索 = 一次模型调用 | 真实响应通常是标准 Anthropic 布局（摘要可能在 `encrypted_content`），也兼容智谱的 `tool_result` repr 布局 |
| `api` | `{apiBaseURL}/web_search`（原生搜索） | **按次计费**；需要单独的搜索资源包/余额 | 结构化返回、通常几秒内完成 |

`mode` 控制走哪条：

- `auto`（默认）：先试 `plan`；失败（超时、额度、端点不支持等）再退到 `api`；调用方取消则立即中止，不再退。
- `plan`：只走套餐通道。套餐不支持 server-side `web_search` 时会直接报错。
- `api`：只走原生搜索 API，稳定但会产生按次费用。

> 只有 coding plan、没有单独购买原生搜索资源包时：保持 `auto` 即可。plan 成功就不会走 api；
> 把 `mode` 设为 `api` 会得到 `429 / 1113 余额不足或无可用资源包`。

> `auto` 的两次尝试理论上最多耗时 `timeoutMs + min(timeoutMs, 15000)`。当前 Web 预设给
> `web_search` 的工具预算默认是 60s，默认配置（25s + 15s）留有余量；如果你把 `timeoutMs`
> 调到 40s 以上，建议改用单一通道，避免撞上工具超时。

## 跨 provider 兜底（Z.ai → DeepSeek）

默认 `fallbackEnabled: true`。当 Z.ai 的所有尝试都失败时——包括没配 Z.ai key、plan 和 api 都报错、
超时、端点不可用——插件会把同一个搜索请求交给已经注册在 `ctx.web` 里的 DeepSeek 搜索 provider，
保证 `web_search` 仍然可用：

- `fallbackProviders` 默认 `deepseek-official,deepseek-search-api`，按顺序尝试；
- 只使用**已注册、`available()` 为 true、`ready()` 为 true** 的 provider，不可用的跳过；
- 调用方取消（`WEB_ABORTED`）**不会**兜底，避免为已取消的搜索花另一家的额度；
- 如果 DeepSeek 也失败，错误 message 会同时列出 Z.ai 和每个 fallback 的原因；
- provider id 仍然是 `zai`，不会改 `web.searchProvider`，也不会触发 `WEB_PROVIDER_AMBIGUOUS`；
- `ready()` 在 Z.ai key 缺失但 fallback 可用时仍返回 true，所以 `web_search` 不会从模型上下文消失。

> **计费提醒**：兜底会使用 DeepSeek 的凭据和额度。`deepseek-official` 是一次 DeepSeek 模型调用，
> `deepseek-search-api` 是 DeepSeek 原生搜索（按次）；都会在 Z.ai 失败后产生 DeepSeek 侧费用。
> 只想用 Z.ai 就把 `fallbackEnabled` 设为 `false`，失败时直接报错。
>
> **超时预算**：如果 Z.ai 是超时失败，`auto` 先花 `25s + 15s`，60s 工具预算只剩约 20s 给 fallback。
> `deepseek-official` 若更慢可能来不及；可以把 `timeoutMs` 调小，或把 `fallbackProviders` 改成
> `deepseek-search-api,deepseek-official`，让快速的原生搜索先试。
>
> 这两个字段默认值已经够用，属于高级配置；客户端表单目前只覆盖 API Key。

## 安装

### 推荐：插件管理器

发布到 npm 后：

```text
plugin_manager install_bundle -> @hexiaowu/dsh-web-search-zai
```

本地开发也可以直接装目录：

```text
plugin_manager install_bundle -> $(pwd)
```

或在 **侧边栏 → 插件（Plugins 面板）** 里点 **添加插件**。安装器会把本包挂到当前 profile，
并把 `@hexiaowu/dsh-web-search-zai` 追加到 `dsh.profile.bundles`。

安装后 `cordis.patch.yml` 会做两件事：

1. `insert` 本插件的 provider 行（`id: web-search-zai`，`config.apiKeyEnv/mode/region`）；
2. 覆盖 `- id: web`，把 `searchProvider` 设为 `zai`，同时**重申** `fetchProvider: http`
   （patch 的 `config` 是整体替换，不重申就会把 `web_fetch` 一起弄挂）。

### 手动（仅当插件管理器不可用时）

在 profile 的 `package.json` 里加依赖并追加 bundle，然后重装：

```sh
PROFILE=~/.dsh/profiles/desktop
cp "$PROFILE/package.json" "$PROFILE/package.json.bak-$(date +%Y%m%d-%H%M%S)"
# dependencies: "@hexiaowu/dsh-web-search-zai": "link:/absolute/path/to/dsh-web-search-zai"
# dsh.profile.bundles 末尾追加 "@hexiaowu/dsh-web-search-zai"
~/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node \
  ~/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.cjs install --dir "$PROFILE"
```

> Desktop 的 profile 由应用托管，`dsh --profile desktop` 会被硬编码拒绝，不要用它验证。

## Key 配置

四种方式，按优先级从高到低是：字面 `apiKey` > 凭据库 `refs` > 启动环境。日常使用推荐前两种。

1. **设置页输入（推荐，给别人用也只需要这一步）**：打开 **设置（齿轮）→ Z.ai 搜索**（和
   `dsh-mcp-link` 的「MCP 联动」并列，order 19），页面里就是 API Key、回退开关和测试按钮。
   粘贴 key 后点保存。插件页只负责安装/启停，不再提供第二份配置表单。它通过 DSH 凭据服务写到
   `~/.dsh/.credentials.yaml` 的 `refs.ZAI_CODING_CN_API_KEY`，**不会**写进 profile 配置。
   输入框会从本机 loopback 端点读取并**默认明文显示当前 key**，方便核对；输入框内右侧的眼睛图标
   可以切换明文/掩码；保存后下一次搜索立即生效。

   > 客户端表单是插件包的一部分。首次安装或更新插件后需要重启一次 Harness（让客户端半进入
   > 浏览器 roster），之后打开 **设置 → Z.ai 搜索** 就能看到表单。Host 半的搜索不需要等这次重启。

2. **凭据库文件**：手动在 `~/.dsh/.credentials.yaml` 的 `refs:` 段加一行，然后 `chmod 600`：

   ```yaml
   refs:
     ZAI_CODING_CN_API_KEY: <你的 Z.ai / 智谱 key>
   ```

   插件每次搜索前通过 `ctx.credentials` 解析，轮换 key 不需要重启。

3. **启动环境变量**：`ZAI_CODING_CN_API_KEY=...` 放在启动 Harness 的环境里（`.env` 也可以）。
4. **插件配置里的字面 `apiKey`**：优先级最高，只建议临时排查时用；它会以 secret 字段的形式
   出现在 Config 里。设置页的表单不写这个字段，所以正常使用不会把 key 落进 profile 配置。

`apiKeyEnv` 默认 `ZAI_CODING_CN_API_KEY`，可以改成任意合法环境变量名。设置页会从本机
loopback 端点读取当前 key 并以明文显示在输入框；`apiKeyEnv` 本身仍然只是引用名。

> **显示 key 的端点**：`GET /dsh-web-search-zai/key`，仅接受 loopback 的 GET，`no-store`，
> 不写日志。它只用于本机设置页核对；默认明文显示，点输入框内的眼睛图标可切回掩码。
> 共享屏幕或录屏时建议先隐藏。

### 设置页里的两个控制

**设置 → Z.ai 搜索** 里还有：

- **回退开关**「Z.ai 不可用时回退到 DeepSeek」：写 `fallbackEnabled`，保存后立即生效
  （volatile）。关掉后 Z.ai 全失败就直接报错，不转 DeepSeek。
- **测试搜索**按钮：调用本机 Host 的 `/dsh-web-search-zai/test` 端点，用同一套 `ctx.web`
  搜索跑一次固定 query（最多 3 条结果），显示「搜索可用 · N 条结果 · 首条标题」或完整错误。
  它**会真实消耗一次 Z.ai 套餐调用**（Z.ai 失败时可能走 DeepSeek）；端点只接受本机 loopback
  的 GET 请求，45s 超时。

> 这两个控件也在客户端半里，首次安装/更新后同样需要重启一次 Harness 才会出现。

### region 与端点

| region | planBaseURL | apiBaseURL |
|---|---|---|
| `cn`（默认） | `https://open.bigmodel.cn/api/anthropic/v1` | `https://open.bigmodel.cn/api/paas/v4` |
| `global` | `https://api.z.ai/api/anthropic/v1` | `https://api.z.ai/api/paas/v4` |

显式填了 `planBaseURL` / `apiBaseURL` 时以显式值为准。国内 key 走 `cn`，海外 key 走 `global`。

## 设置项

全部字段都是 `volatile`，改完下一次搜索就生效，不需要重启。

| 字段 | 默认 | 说明 |
|---|---|---|
| `mode` | `auto` | `auto` / `plan` / `api` |
| `region` | `cn` | `cn` / `global`，决定端点默认值 |
| `planBaseURL` | 空（按 region） | 套餐通道的 API 前缀，插件追加 `/messages` |
| `apiBaseURL` | 空（按 region） | 原生搜索的 API 前缀，插件追加 `/web_search` |
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

## 验证

```sh
# 解析器 / HTTP 层 / provider 注册 / probe 集成测试，共 72 个 .test.mjs 用例，零网络
# （node --test test/ 会额外把 probe.mjs 当空跑，共 73 个条目）
node --test test/              # 节点 20：按目录发现
node --test                    # 节点 24：目录参数已不被接受，用默认发现
node --test test/*.test.mjs    # 两个版本都可用（不含 probe 自身的空跑）
npm test                       # 同上，走 package.json 的 test 脚本

# 真实端点冒烟（需要 key；会把脱敏后的原始响应写到 docs/raw-plan.json、docs/raw-api.json）
node test/probe.mjs
node test/probe.mjs '另一个查询'
ZAI_REGION=global node test/probe.mjs
```

`node --test test/` 会顺带发现 `test/probe.mjs`；它检测到测试运行器时不会执行网络请求。

正确的安装结果：

1. **设置（齿轮）→ Z.ai 搜索** 出现在设置导航里（`mcp-link` 的「MCP 联动」下面）；点进去能看到
   **API Key** 表单、**回退开关**和**测试搜索**按钮（首次安装/更新后可能需要重启一次 Harness
   加载客户端半）；插件页只用于安装/启停，不提供配置表单；
2. **侧边栏 → 插件 → 官方插件 → Web search** 里 provider 为 `zai`；
3. `grep -r "skipping profile bundle" ~/.dsh/logs/` 不含 `@hexiaowu/dsh-web-search-zai`；
4. 新会话里 `web_search` 能返回 sources，`web_fetch` 仍可用。

## 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `web_search` 工具从模型上下文消失 | `ready()` 为 false：Z.ai key 没配置，且没有可用的 DeepSeek fallback。把 key 放进 `refs:`/启动环境，或确认 `deepseek-official`/`deepseek-search-api` 的凭据可用。 |
| Z.ai 全挂了但 `web_search` 还能用 | 正常：`fallbackEnabled=true` 时自动转 DeepSeek。错误/日志里会看到 Z.ai 的失败原因；不想兜底就把 `fallbackEnabled` 设为 `false`。 |
| Z.ai 和 DeepSeek 都失败 | 抛 `WEB_PROVIDER_ERROR`，message 会逐条列出 `zai:` 和每个 fallback provider 的原因。 |
| `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` | `planBaseURL` / `apiBaseURL` 不是合法绝对 URL，或 `timeoutMs` 非正整数；如果 fallback 可用，provider 仍会被选中并转 DeepSeek。 |
| `WEB_PROVIDER_CREDENTIAL_MISSING` | 没解析到 Z.ai key，且 fallback 不可用/被禁用；错误 message 里会直接写去哪个文件加什么引用。 |
| HTTP 401 / 403 | key 与 region 不匹配，或 key 没有对应套餐 / 搜索权限。 |
| HTTP 402 / 429 | 套餐额度或频率限制；可先把 `mode` 改 `api`，或检查套餐。 |
| HTTP 429 / code `1113` | 账号**余额不足或没有可用资源包**（上游原文：`余额不足或无可用资源包,请充值。`）。如果是 `api` 通道，需要单独开通 web-search 资源包；如果 `plan` 通道正常，保持 `auto` 就不会走 api。换端点不能绕过；`fallbackEnabled=true` 时会转 DeepSeek。 |
| HTTP 401 / code `1000`（模型端点） | key 被模型/套餐端点拒绝：确认 key 是 coding plan 的有效 key、账号没有欠费/风控，必要时重新生成 key。 |
| 免费模型（`glm-4-flash` 等）能调通但搜不出结果 | 免费模型不执行服务端 `web_search`（`usage.server_tool_use.web_search_requests = 0`，没有 `tool_result` 块）。plan 通道要用支持该工具的付费模型（默认 `glm-4.6`）。 |
| plan 通道 400 且提示不支持 `web_search` | 该套餐端点不支持 server-side web_search；`auto` 会继续试 api/DeepSeek；想强制 api 就设 `mode=api`（会产生按次计费）。 |
| plan 通道超时 | 套餐通道是一次完整模型调用，可能较慢；调大 `timeoutMs`，或改用 `api`。 |
| 中文标题乱码 | 智谱的 repr 会用 `\uXXXX` 转义；本插件的 Python-literal 解析器会解码。若仍乱码请附 `docs/raw-plan.json` 的结构提 issue。 |

## 回滚

在 **侧边栏 → 插件 → 已安装插件** 里找到 **Z.ai 网页搜索**，卸载它（或 `plugin_manager remove_bundle`），重启 Harness。
`- id: web` 会回到 base bundle 的 `searchProvider: deepseek-official` / `fetchProvider: http`，
搜索重新走 DeepSeek（会重新扣 DeepSeek 余额）。凭据库里的 Z.ai key 不参与回滚后的行为，可保留。

手动安装的情况下：从 profile `package.json` 的 `dependencies` 与 `dsh.profile.bundles` 两处删除本包，
再执行上面的 pnpm install 并重启。

## 开发说明

运行时只声明 `peerDependencies`，由宿主安装域解析 `@deepseek-ai/dsh-web` 等包；**不要**把它们写成
`dependencies`，否则 profile 里会出现第二份 schemastery，Config schema 与宿主不是同一份实例。
`devDependencies` 只用于本地/CI 测试，不会被装进用户的 profile。

```sh
npm install
npm test          # 72 个 .test.mjs 用例
npm run check     # 语法检查 + 全部测试（prepublishOnly 也跑这个）
npm run probe     # 真实端点冒烟；需要 ZAI_CODING_CN_API_KEY
```

`lib/parse.js` 和 `lib/util.js` 没有任何宿主 import，可以脱离 Harness 直接跑 fixture。
`lib/search.js` 需要宿主真实的 `WebError` 类，`lib/index.js` 还需要 `schemastery`、凭据与启动环境服务；
本地测试用 `npm install` 安装的 devDependencies，真实宿主安装时仍由安装域解析 peers。

## 发布（GitHub + npm Trusted Publishing）

- CI：`.github/workflows/ci.yml`，Node 22/24 跑 `npm ci`、`npm run check`、`npm pack --dry-run`。
- 发布：`.github/workflows/publish.yml`，GitHub Release / `workflow_dispatch` 触发，使用
  **npm Trusted Publishing (OIDC)** + provenance，不需要 `NPM_TOKEN`。
- **首次发布 0.1.0**：包还不存在，先在本机 `npm login` 后执行一次
  `npm publish --access public`；然后在 npm 包的 **Settings → Trusted Publisher → GitHub Actions**
  配置 `owner: hexiaowu`、`repository: dsh-web-search-zai`、`workflow filename: publish.yml`、
  environment 留空。之后每次创建 GitHub Release（tag `vX.Y.Z`）即可自动发布并带 provenance。
- 版本号在 `package.json`；发布前先 `npm pack --dry-run` 检查文件清单。

## License

MIT
