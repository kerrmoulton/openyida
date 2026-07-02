---
name: openyida_publish
description: Guide OpenYida release publishing from the current branch or release branch through version confirmation, changelog preparation, validation, tag creation, tag push, GitHub Actions monitoring, npm verification, and GitHub Release asset checks. Use when the user asks to publish OpenYida, release the current branch, create a beta/latest release, push a release tag, run the OpenYida publishing flow, or explicitly mentions openyida_publish or openyida-publish.
---

# OpenYida Publish

## Core Behavior

Use this skill to run the OpenYida release workflow conversationally. Treat publishing as a production-changing operation: gather context, verify the intended release target, update the changelog when needed, run release checks, and only push the release tag after explicit user confirmation.

Always read `references/release-flow.md` before performing an actual release or preparing release commands.

## Release Decision Tree

1. Determine what the user means by "publish":
   - If they ask to publish the current branch, inspect the current branch and use it as the candidate release source.
   - If they name a branch, use that branch as the candidate release source.
   - If they simply say publish OpenYida, assume the repository's release branch, usually `main`, but verify locally.

2. Inspect repository state:
   - Run `git status --short --branch`.
   - Check recent tags with `git tag --sort=-creatordate`.
   - Inspect release workflow if needed: `.github/workflows/publish.yml`.
   - Check `CHANGELOG.md` for `[Unreleased]` and recent version entries.

3. Confirm release intent before irreversible steps:
   - Ask for confirmation before pushing a `v*` tag.
   - Do not push a tag if release checks fail.
   - Do not delete or overwrite remote tags without explicit user instruction and a clear risk note.

## Version Guidance

OpenYida uses date-based versions:

- Stable release tag: `vYYYY.M.D`, for example `v2026.7.2`.
- Prerelease tag: `vYYYY.M.D-beta.0`, `vYYYY.M.D-rc.0`, or similar.
- npm version is derived by removing the `v` prefix.
- Tags containing `-beta`, `-alpha`, or `-rc` publish to npm `beta`.
- Other `v*` tags publish to npm `latest`.

If today's tag already exists, inspect existing same-day tags and propose the next safe version, such as `vYYYY.M.D-1` for another stable release or incrementing the prerelease suffix.

## Changelog Guidance

Before releasing, make sure `CHANGELOG.md` reflects the release:

- Use git history since the previous tag to draft release notes when the user has not provided them.
- Convert implementation details into user-facing behavior.
- Include command, skill, packaging, login, API, or compatibility impacts when relevant.
- Keep `[Unreleased]` for future work if creating a dated release section.

Do not invent changes. If the diff/history is unclear, summarize only what can be verified and ask the user for missing release-note context.

## Validation

Prefer `npm run check:release` for a full local preflight. If the user wants a faster check, explain the reduced confidence and run narrower commands that match the change.

If a command fails because dependencies are missing or network access is restricted, follow the runtime approval policy before retrying.

## Release Execution

For actual releases, follow `references/release-flow.md` as the authoritative checklist. In summary:

1. Verify branch and working tree.
2. Confirm version/tag.
3. Update and commit `CHANGELOG.md` if needed.
4. Run `npm run check:release`.
5. Create the tag locally.
6. Ask the user to confirm pushing the tag.
7. Push the tag.
8. Monitor/inspect GitHub Actions if available.
9. Verify npm and GitHub Release assets.

## User-Facing Style

Be direct and operational. When the user asks "发布当前分支", give the next concrete action and proceed through the checklist. Keep the user aware of gates: branch choice, version choice, changelog content, validation result, and final tag push confirmation.
