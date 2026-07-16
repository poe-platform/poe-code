---
severity: critical
impact: correctness
reproduced: y
recommendation: fix
evidence: "src/cli/commands/plan.ts:329-331 returns plans[0] when assumeYes and no path; flags.assumeYes then skips confirm at :464; probe 'npm run dev -- plan archive --yes --dry-run' printed 'Would archive docs/plans/safejs-optional-filesystem.md'"
comment: "One of the most important files in the audit and correctly Critical: --yes with no path caused plan archive and plan delete to each act on a plan the user never named, and the file records the actual casualties by name (toolcraft-human-in-loop-opt-in-exports.md archived, tiny-http-mcp-server-production-hardening.md deleted), both restored via git. Not hypothetical - the audit destroyed real files with two commands. The precise finding: --yes is conflated with target selection, since ux-plan-archive-requires-yes-non-tty-good.md shows the guard works when a path is given, so no-path plus --yes autopicks instead of refusing. Fix: never allow archive/delete without an explicit path. The same rule closes the pipeline and gaslight autopick issues."
---

# UX: plan archive|delete --yes without path mutates an arbitrary plan

## Summary

With --yes and no path, plan archive and plan delete select some plan automatically and perform destructive action without confirming target.

## Evidence

```bash
$ poe-code plan archive --yes
Archived docs/plans/….md
$ poe-code plan delete --yes
Deleted docs/plans/….md
```

## Why it matters

Data loss; --yes means accept defaults not pick random destructive target.

## Suggested direction

Never allow archive/delete without explicit path even with --yes.

## Reconfirmed

```bash
$ poe-code plan archive --yes
Archived docs/plans/toolcraft-human-in-loop-opt-in-exports.md
```
(Restored via git after audit probe.)

## Reconfirmed (delete)

```bash
$ poe-code plan delete --yes
Deleted docs/plans/tiny-http-mcp-server-production-hardening.md
```
(Restored via git after audit probe.)

## Severity

**Critical**

## Area

Plan / destructive
