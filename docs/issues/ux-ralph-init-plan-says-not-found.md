---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/ralph.ts:467 catch-all maps parseFrontmatter kind error to 'Ralph doc not found'; packages/ralph/src/frontmatter/frontmatter.ts throws on kind!=ralph; probe `npm run dev -- ralph init docs/plans/32-agent-goal.md --dry-run` printed 'Ralph doc not found: docs/plans/32-agent-goal.md' for an existing kind=plan doc. Duplicate of ux-ralph-init-requires-existing-ralph-doc-circular.md."
comment: "One of two filings of the ralph init bootstrap problem; consolidate with ux-ralph-init-requires-existing-ralph-doc-circular.md, which names the contradiction more sharply. The finding is real and worth High: init cannot initialise anything, since it requires the doc to already be a ralph doc."
---

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
