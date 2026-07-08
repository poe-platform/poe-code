# UX: ralph init on existing plan says Ralph doc not found

## Summary

ralph init docs/plans/32-agent-goal.md --dry-run: Ralph doc not found — file exists; ralph requires prior ralph frontmatter or wrong kind message.

## Evidence

```bash
$ poe-code ralph init docs/plans/32-agent-goal.md --dry-run
■  Ralph doc not found: docs/plans/32-agent-goal.md
```

## Why it matters

init should bootstrap any markdown (platform fix) not require existing ralph doc.

## Suggested direction

Allow init on any markdown; write ralph frontmatter.

## Severity

**High**

## Area

Ralph
