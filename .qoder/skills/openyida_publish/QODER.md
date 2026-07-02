# openyida_publish

This package provides an OpenYida release workflow for Qoder-compatible agents.

Primary instruction file:

```text
SKILL.md
```

Detailed release checklist:

```text
references/release-flow.md
```

Trigger examples:

- 使用 openyida_publish 发布当前分支
- 发布 OpenYida beta 版本
- 给当前分支打 release tag

Important rule: before pushing any `v*` tag, ask the user for explicit confirmation because that push triggers the publish workflow.
