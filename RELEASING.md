# 发布流程

这个包通过 **GitHub Actions + npm Trusted Publishing（OIDC）** 发布，仓库和 GitHub Secrets 里都不放
`NPM_TOKEN`。

## 当前状态

- `0.1.0` 已经发到 npm（首次是手动发布，没有 provenance）。
- `0.1.1` 已经准备好（README 重写 + 文档拆分），tag 也打了，但**还没发布**：需要先在 npm 上配置
  **Trusted Publisher**。
- GitHub Release `v0.1.0` 已存在；它的 `publish.yml` 因为 0.1.0 已经在 npm 上，正确跳过了发布步骤。

## 1. 配置 npm Trusted Publisher（只需一次）

打开 npm 包页面 → **Settings → Trusted Publisher → GitHub Actions**，填：

| 字段 | 值 |
|---|---|
| Organization or user | `hexiaowu` |
| Repository | `dsh-web-search-zai` |
| Workflow filename | `publish.yml` |
| Environment | 留空 |
| Allowed action | **Publish**（不是只允许 stage） |

保存时需要 2FA。注意：当前这种“绕过 2FA 的 granular access token”不能做这个操作，`npm trust ...`
会返回 403；请用网页（或者先 `npm login --auth-type=web`，再运行
`npm trust github @hexiaowu/dsh-web-search-zai --file publish.yml --repo hexiaowu/dsh-web-search-zai
--allow-publish`）。

新包第一次发布必须手动；发完马上配置 Trusted Publisher。0.1.0 就是那次手动发布。

## 2. 准备版本

```sh
npm version patch --no-git-tag-version   # 或者 minor / major
# 更新 CHANGELOG.md
npm run check
npm pack --dry-run                       # 应该是 16 个文件
```

包里应该有 `lib/`、`client.js`、`cordis.patch.yml`、`locale/*.json`、`icon.svg`、`README.md`、
`README.en.md`、`LICENSE`、`CHANGELOG.md`、`CONTRIBUTING.md`、`RELEASING.md`。不能有测试、`docs/findings.md`、
原始响应、凭据或 `node_modules`。

## 3. 提交、打 tag、push

```sh
git add -A
git commit -m "release: vX.Y.Z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

remote 走 SSH（`git@github.com:hexiaowu/dsh-web-search-zai.git`）。`gh` 的 OAuth token 没有 `workflow`
scope，用 HTTPS 推送带 `.github/workflows/*` 的提交会被拒；SSH 没这个问题。只 push tag 不会触发发布。

第一次发布之前，如果发布内容有变，可以移动 tag：
`git tag -f vX.Y.Z && git push -f origin vX.Y.Z`。已经发布过的 tag 不要再移动。

## 4. 创建 GitHub Release

```sh
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <notes>
```

`publish.yml` 由 `release: published`（或带 tag 的 `workflow_dispatch`）触发，流程是：

1. checkout 这个 tag；
2. 用 Node 22.19.0 和 npm 11（Trusted Publishing 要求 Node ≥22.14、npm ≥11.5.1）；
3. `npm ci`；
4. 查这个版本是否已经在 npm 上，有就跳过；
5. `npm publish --access public`，通过 OIDC 发布并生成 provenance。

上传前会跑 `prepublishOnly`（`npm run check`，语法 + 72 个测试）。

## 5. 验证

```sh
npm view @hexiaowu/dsh-web-search-zai version dist-tags dist.attestations --json
gh run watch <run-id> --exit-status
```

应该看到：`latest` 指向新版本、`dist.attestations.provenance` 存在、workflow 是绿的。然后用一个干净的
profile（不是 workspace link）验证：

```sh
export DSH_HOME=/tmp/dsh-zai-release-check
dsh --profile zai-release-check --from-default-profile web --dump-config >/dev/null
dsh plugin --profile zai-release-check add @hexiaowu/dsh-web-search-zai@X.Y.Z
dsh --profile zai-release-check --dump-config | grep -A6 '^- id: web$'
```

`web` 行里应该是 `searchProvider: zai`、`fetchProvider: http`。

## 备注

- 首次发布或新包处理期间，npm 可能先放一个 `0.0.0-stage` 占位版本。它不是 `latest`，不影响安装。
- CI（`.github/workflows/ci.yml`）在 Node 22/24 上跑 `npm ci`、`npm audit --omit=dev`、`npm run check`
  和 `npm pack --dry-run`。
- 不要再加 `NPM_TOKEN` secret。如果 OIDC 不可用，退回手动 `npm publish --access public`，并在
  CHANGELOG 里说明——那种发布没有 provenance。
