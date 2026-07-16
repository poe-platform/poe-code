---
severity: high
impact: usability
comment: "One of three filings of the non-TTY plan browse dump; consolidate. Keep this framing as canonical because 'arbitrary' is the accurate word - the plan shown is not chosen by the user, the same autopick problem as the archive/delete Critical, only read-only here so the consequence is confusion rather than loss. Its fix is right: require a path or print the list."
reproduced: y
recommendation: fix
evidence: "packages/plan-browser/src/browser.ts:49-52 autopicks plans[0] and dumps renderMarkdown body when process.stdin.isTTY !== true; probe 'npm run dev -- plan browse </dev/null' printed full body of safejs-optional-filesystem.md with no path or picker"
---

# UX: plan browse non-TTY dumps arbitrary plan body without selection

## Summary

plan browse without TTY dumps full body of some plan (toolcraft human-in-loop…) without path or picker — non-interactive dump of arbitrary content.

## Evidence

```bash
$ poe-code plan browse
# dumps full markdown of some plan in cwd docs
```

## Why it matters

Non-TTY should require path or list; dumping arbitrary plan is surprising.

## Suggested direction

Non-TTY: require path or print plan list only; never dump full body without path.

## Severity

**High**

## Area

Plan / non-TTY
