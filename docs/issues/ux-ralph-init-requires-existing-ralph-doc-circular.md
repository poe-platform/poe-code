---
severity: high
impact: usability
comment: "Keep as canonical of this pair - 'chicken-and-egg' is exactly right, and it quotes the help that proves the intent ('Write Ralph config into an existing markdown doc frontmatter'), so the behavior contradicts its own documentation: it should accept any markdown and write the frontmatter, yet it rejects anything lacking the frontmatter it is supposed to write. A genuine functional defect rather than a message problem, and it makes ralph init unusable for its stated purpose. Distinct from the wrong-kind message cluster; fix the behavior, not the copy."
---

# UX: ralph init requires existing ralph doc (circular / not found)

## Summary

ralph init docs/plans/32-agent-goal.md says Ralph doc not found — init cannot bootstrap a plan into ralph kind; chicken-and-egg.

## Evidence

```bash
$ poe-code ralph init docs/plans/32-agent-goal.md --agent claude --iterations 3 --yes
■  Ralph doc not found: docs/plans/32-agent-goal.md
```
Help: Write Ralph config into an existing markdown doc frontmatter.

## Why it matters

Init should accept any markdown and write kind: ralph frontmatter, or say expected kind.

## Suggested direction

Allow init on any .md; set kind ralph; or clear wrong-kind error.

## Severity

**High**

## Area

Ralph
