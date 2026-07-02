# openyida_publish

Use `SKILL.md` as the primary instruction file for OpenYida releases.

When the user asks to publish OpenYida, release the current branch, create a beta/latest release, or mentions `openyida_publish`, follow this workflow:

1. Read `SKILL.md`.
2. Read `references/release-flow.md` before preparing commands.
3. Verify branch, working tree, latest tags, and `CHANGELOG.md`.
4. Guide the user through version choice and changelog updates.
5. Run release validation before tagging.
6. Ask for explicit confirmation before `git push origin v...`.

Never push a release tag silently.
