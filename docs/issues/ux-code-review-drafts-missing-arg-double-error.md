---
severity: high
impact: usability
comment: "Keep as canonical for the code-review double-error skin: clearest transcript showing the raw Commander line and the design-system panel both firing for one mistake, plus the npm run dev recovery. Absorbs ux-code-review-drafts-missing-prurl-double-error-npm-run-dev.md and ux-code-review-double-error-skin.md. Two independent fixes underneath: stop Commander printing before the error is mapped (same root as ux-agent-spawn-missing-args-raw-commander.md) and use displayBinaryName instead of npm run dev (CLI-wide identity cluster)."
reproduced: y
recommendation: fix
evidence: "npm run dev -- code-review drafts prints raw 'error: missing required argument prUrl' then design-system panel repeating it; suppressCommanderOutput is opt-in only (src/cli/program.ts:986, container.ts:48). npm run dev hint is correct in dev mode (src/utils/execution-context.ts:39), so only the double-error half is confirmed."
---

# UX: code-review drafts missing prUrl double-errors

## Summary

Missing prUrl shows raw error: missing required argument then design-system error with same text and npm run dev help — double skin + wrong binary.

## Evidence

```bash
$ poe-code code-review drafts
error: missing required argument 'prUrl'
■  error: missing required argument 'prUrl'
│  Run npm run dev -- code-review drafts --help
```

## Why it matters

Reconfirm double-error + npm run dev identity on code-review.

## Suggested direction

Single ValidationError; displayBinaryName.

## Severity

**High**

## Area

Code-review / errors
