---
severity: medium-high
impact: usability
comment: "Thinner twin of ux-github-cwd-clone-errors-still-raw-git.md; retire into it. Its one useful contribution is the argument that raises severity: this is a featured README capability, so a raw-git first impression matters more here than the same defect would elsewhere. Rated Medium-High against the twin's High for identical behavior; normalise."
reproduced: y
recommendation: no-fix
evidence: "packages/workspace-resolver/src/github/clone.ts:91 throws new Error(detail) with raw git stderr; src/workspace/resolve-spawn-workspace.ts propagates it unmapped. Duplicate of ux-github-cwd-clone-errors-still-raw-git.md, which is the canonical filing."
---

# UX: github:// clone errors unframed

## Summary

Bad locator raw git stderr.

## Evidence

github://not/a/real/repo.

## Why it matters

Featured README feature.

## Suggested direction

Map to user error.

## Severity

Medium–High

## Area

Spawn / workspaces
