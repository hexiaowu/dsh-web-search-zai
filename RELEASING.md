# Releasing

This package publishes through **GitHub Actions + npm Trusted Publishing (OIDC)**. No `NPM_TOKEN` is
stored in the repository or GitHub secrets.

## Current status

- `0.1.0` is live on npm (manual first publish; no provenance).
- `0.1.1` is prepared (README rewrite + docs split), tagged, and **not yet published**: the npm
  **Trusted Publisher** needs to be configured first.
- GitHub Release `v0.1.0` exists; its `publish.yml` run correctly skipped the publish step because
  0.1.0 was already on npm.

## 1. Configure the npm Trusted Publisher (once)

Open the package on npmjs.com → **Settings → Trusted Publisher → GitHub Actions** and fill:

| Field | Value |
|---|---|
| Organization or user | `hexiaowu` |
| Repository | `dsh-web-search-zai` |
| Workflow filename | `publish.yml` |
| Environment | leave blank |
| Allowed action | **Publish** (not “stage only”) |

Save with 2FA. This cannot be done with a granular access token that bypasses 2FA: npm rejects
`npm trust ...` with HTTP 403. Use the web UI (or `npm login --auth-type=web` and then
`npm trust github @hexiaowu/dsh-web-search-zai --file publish.yml --repo hexiaowu/dsh-web-search-zai
--allow-publish`).

Verify in `npm stage list`/the package settings page. For a brand-new package, the first publish is
manual; configure the Trusted Publisher immediately afterwards. (0.1.0 was that manual publish.)

## 2. Prepare a version

```sh
npm version patch --no-git-tag-version   # or minor/major
# update CHANGELOG.md
npm run check
npm pack --dry-run                       # 16 files expected
```

The package contains `lib/`, `client.js`, `cordis.patch.yml`, `locale/*.json`, `icon.svg`, `README.md`,
`LICENSE` and `CHANGELOG.md`. It must not contain tests, `docs/findings.md`, raw responses, credentials,
or `node_modules`.

## 3. Commit, tag, push

```sh
git add -A
git commit -m "release: vX.Y.Z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

The remote is SSH (`git@github.com:hexiaowu/dsh-web-search-zai.git`). The `gh` OAuth token lacks the
`workflow` scope, so HTTPS pushes that touch `.github/workflows/*` are rejected; SSH works. A tag push
alone does not publish.

Before the first publish, a tag may be moved (`git tag -f vX.Y.Z && git push -f origin vX.Y.Z`) if the
release content changes. Never move a tag after it has been published.

## 4. Create the GitHub Release

```sh
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <notes>
```

`publish.yml` triggers on `release: published` (and `workflow_dispatch` with a tag). It:

1. checks out the tag,
2. uses Node 22.19.0 and npm 11 (Trusted Publishing needs Node ≥22.14 and npm ≥11.5.1),
3. runs `npm ci`,
4. checks whether the version is already on npm and skips if so,
5. runs `npm publish --access public` with OIDC + provenance.

`prepublishOnly` runs `npm run check` (syntax + 72 tests) before upload.

## 5. Verify

```sh
npm view @hexiaowu/dsh-web-search-zai version dist-tags dist.attestations --json
gh run watch <run-id> --exit-status
```

Expected: `latest` points at the new version, `dist.attestations.provenance` is present, and the
workflow is green. Then verify from a clean profile (not a workspace link):

```sh
export DSH_HOME=/tmp/dsh-zai-release-check
dsh --profile zai-release-check --from-default-profile web --dump-config >/dev/null
dsh plugin --profile zai-release-check add @hexiaowu/dsh-web-search-zai@X.Y.Z
dsh --profile zai-release-check --dump-config | grep -A6 '^- id: web$'
```

The `web` row must show `searchProvider: zai` and `fetchProvider: http`.

## Notes

- `0.0.0-stage` may appear as a temporary package placeholder while npm processes a first/new publish;
  it is not `latest` and does not affect installs.
- CI (`.github/workflows/ci.yml`) runs on Node 22/24 with `npm ci`, `npm audit --omit=dev`,
  `npm run check`, and `npm pack --dry-run`.
- Do not add an `NPM_TOKEN` secret. If OIDC is unavailable, fall back to a manual
  `npm publish --access public` and document why; that release will lack provenance.
