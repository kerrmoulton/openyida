# OpenYida Release Flow

Use this checklist when performing or preparing an OpenYida release.

## 1. Identify the Release Source

Run:

```bash
git status --short --branch
```

Interpretation:

- The branch shown after `##` is the current candidate release branch.
- If the user asked for "current branch", use this branch.
- If the user expects a standard release, verify whether this branch is `main` or the repository's actual release branch.
- If there are uncommitted changes, stop and ask whether they must be included, committed, stashed, or ignored.

Do not switch branches if the user explicitly asked to publish the current branch unless they agree.

## 2. Inspect Existing Release Tags

Run:

```bash
git tag --sort=-creatordate
```

Look for the latest stable tag, latest prerelease tag, and whether today's intended tag already exists.

## 3. Choose the Version

Default stable format:

```text
vYYYY.M.D
```

Default beta format:

```text
vYYYY.M.D-beta.0
```

Rules:

- `v2026.7.2` publishes npm version `2026.7.2` with npm tag `latest`.
- `v2026.7.2-beta.0` publishes npm version `2026.7.2-beta.0` with npm tag `beta`.
- `-alpha`, `-beta`, and `-rc` are treated as prerelease tags by the workflow.
- If a tag/version already exists, do not reuse it.

## 4. Prepare the Changelog

Read:

```bash
sed -n '1,120p' CHANGELOG.md
```

If needed, inspect changes since the previous release:

```bash
git log --oneline <previous-tag>..HEAD
```

Draft release notes from verified commits/diffs. Good sections include:

- `Highlights`
- `Added`
- `Changed`
- `Fixed`
- `Tests`

Guidelines:

- Write for users and maintainers, not only for implementers.
- Mention CLI commands, skills, packaging, login, API, and compatibility impacts.
- Avoid vague entries such as "optimize several issues".
- Do not claim functionality that is not visible in the branch.

If editing `CHANGELOG.md`, commit it before tagging:

```bash
git add CHANGELOG.md
git commit -m "chore: update changelog for release"
git push origin <branch>
```

## 5. Run Release Checks

Preferred full preflight:

```bash
npm run check:release
```

This maps to `npm run check:ci`, which validates project structure, skills, command manifest, generated docs, Wukong skill package build, JS syntax, lint, Jest unit tests, package size, and npm package contents.

If it fails, stop and fix or report the failure. Do not push a release tag after failed checks unless the user explicitly overrides the risk.

## 6. Create the Local Tag

Before creating the tag, ensure `HEAD` is the intended release commit:

```bash
git log -1 --oneline
```

Stable:

```bash
git tag vYYYY.M.D
```

Prerelease:

```bash
git tag vYYYY.M.D-beta.0
```

## 7. Confirm and Push the Tag

Pushing the tag triggers `.github/workflows/publish.yml`, which can publish to npm and create a GitHub Release.

Before running this, ask the user for explicit confirmation:

```bash
git push origin vYYYY.M.D
```

Never push a release tag silently.

## 8. Verify GitHub Actions

The publish workflow is triggered by `v*` tag pushes. Expected behavior:

- Validate syntax, skills, Wukong build, and tests.
- Sync `package.json` version from the tag.
- Determine npm tag: prerelease -> `beta`, stable -> `latest`.
- Skip npm publish if the exact npm version already exists.
- Publish to npm when needed.
- Build `openyida-skills.zip`.
- Create GitHub Release and attach `openyida-skills.zip`.

If GitHub CLI is available, inspect workflow status with `gh`. Otherwise tell the user to check the GitHub Actions `Publish` workflow.

## 9. Verify npm

Stable:

```bash
npm view openyida version
```

Prerelease:

```bash
npm view openyida@beta version
```

Optional install verification:

```bash
npm install -g openyida
openyida --version
```

## 10. Verify GitHub Release

Check the GitHub Release for the tag:

- Release exists.
- Release title matches the tag.
- Stable release is not marked prerelease.
- Beta/alpha/rc release is marked prerelease.
- Assets include `openyida-skills.zip`.

## Troubleshooting

- Branch push is not a release. A `v*` tag push is required.
- PR/MR merge is not a release. Continue with tag-based release flow.
- npm published versions cannot be overwritten. Use a new version.
- If a local tag is wrong and not pushed, use `git tag -d <tag>` and recreate it.
- If a remote tag is wrong or a release already triggered, do not delete or overwrite automatically; ask the maintainer for a recovery plan.

