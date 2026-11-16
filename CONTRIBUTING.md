# 参与开发

## 目录结构

```
lib/index.js      provider 注册、key 解析、DeepSeek 兜底、本机测试/key 接口
lib/search.js     plan/api 两条通道、超时、WebError 映射
lib/parse.js      Anthropic / 智谱 / 原生搜索结果解析、URL 去重、摘要提取
lib/util.js       nonBlank、URL 规范化、去重、文本预览
client.js         设置 → Z.ai 搜索（客户端模块表 + React）
cordis.patch.yml  bundle patch：插入插件行，并把 web.searchProvider 固定为 zai
test/             解析、HTTP、provider、客户端和 probe 测试
```

Host 端是普通 ESM，前端是手写的 `window.__ModuleLoader__` bundle，没有构建步骤。

## 本地开发

```sh
npm install
npm test          # 72 个 .test.mjs 用例
npm run check     # 语法检查 + 全部测试（prepublishOnly 也会跑）
npm run probe     # 真实 Z.ai 接口；需要 ZAI_CODING_CN_API_KEY
```

`devDependencies` 只用于本地和 CI 测试。**不要**把 `@deepseek-ai/*` 这些宿主包写进 `dependencies`：
profile 会解析宿主自己的那一份，重复的 schemastery 会让 Config schema 不再是同一个实例。

## 测试

- `test/parse.test.mjs` / `test/util.test.mjs`：只用测试样例，不依赖宿主模块；覆盖 link 在 key 之前、
  title 缺失、`\uXXXX`、`encrypted_content`、去重、括号边界等情况。
- `test/search.test.mjs`：两条通道的请求形状、超时、取消、HTTP 错误，以及不触发兜底时的行为；
  用注入的 `fetchImpl`，不连网。
- `test/index.test.mjs`：provider 注册、凭据优先级、兜底、本机 test/key 接口。
- `test/client.test.mjs`：伪造的 `window.__ModuleLoader__` + React + ctx；检查插槽（slot）注册、key 输入框、
  眼睛图标、兜底开关、测试按钮。
- `test/probe.test.mjs`：在本地起一个服务，跑 `test/probe.mjs`，检查脱敏。
- `test/probe.mjs` 是脚本，不是测试；测试运行器看到 `NODE_TEST_CONTEXT` 时会直接退出。

用 `npm test`（Node 22/24）。`node --test test/` 在 Node 20 上会额外把 `probe.mjs` 当测试文件；
Node 24 不接受目录参数，所以优先用 `npm test` 或 `node --test test/*.test.mjs`。

## 本地安装

```text
plugin_manager install_bundle -> $(pwd)
```

或者在侧边栏 **插件 → 添加插件** 里填绝对路径。第一次安装或更新后重启一次 Harness，让前端模块
加载进来。配置在 **设置 → Z.ai 搜索**（`settings.section`，id `web-search-zai`）；插件页只负责
安装、启停和卸载。

## 加通道或解析格式

- 通道逻辑放在 `lib/search.js`：构造请求、调用 `dispatchJson`、返回 `{ sources, truncated }`。
  错误码保持 `WEB_PROVIDER_ERROR`（任何非取消失败）和 `WEB_ABORTED`（调用方取消）。
- 新的响应格式放在 `lib/parse.js`：扩展 `collectRecords` / `toSource`，并在 `test/parse.test.mjs`
  加一条测试样例。不要用正则切分记录，按括号层级走。
- provider 的 `available()` 要保持同步、只看本地状态；`ready()` 不要发网络请求。搜索工具在筛选和
  挂载时会调用它们。

## 调试

- `cordis_inspect_query` 的 host `Config.listConfigs`，`name` 用 `"@hexiaowu/dsh-web-search-zai"`，
  可以看当前配置项和生成的 schema。
- `Client Slots.listSubTree` 的 `settings.section` 里应该能看到 `web-search-zai`（order 19）。
- `GET /dsh-web-search-zai/key` 和 `/dsh-web-search-zai/test` 只监听本机；直接 curl 也可能被应用的
  路由/鉴权层挡住。
- 用 link 方式安装时，改 Host 端 JS 需要重启插件行（disable/enable）或重启 Harness；改 `client.js`
  可能会热更新，没生效就刷新页面。

## 约定

- ESM，不上 TypeScript、不上打包器，不写 `postinstall`。
- 宿主包放 `peerDependencies`，只给测试用的包放 `devDependencies`。
- 不要打印凭据、请求体或 key。错误信息可以带上游返回，但不能带 key。
- 保持 `files` / `exports` 和实际文件一致：`lib`、`client.js`、`cordis.patch.yml`、`locale/*.json`、
  `icon.svg`、`README.md`、`README.en.md`、`LICENSE`、`CHANGELOG.md`、`CONTRIBUTING.md`、`RELEASING.md`。
- 提 PR 前跑一遍 `npm run check`、`npm pack --dry-run`，确认没有把 `docs/findings.md`、原始响应、
  凭据或 `EXECUTION-PLAN.md` 加进暂存区。

## 安全

`/dsh-web-search-zai/key` 是故意把 key 返回给本机设置页的（你要求明文显示）。它只能监听本机，
必须带 `no-store`，不能写日志；不要把它开放给远程客户端，也不要加 CORS。测试接口会真实消耗额度，
同样只留给本机，并保持有上限。
