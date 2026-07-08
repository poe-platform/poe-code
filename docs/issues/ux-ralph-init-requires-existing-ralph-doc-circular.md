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
