---
severity: high
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/gaslight.ts:143-144 autopicks plans[0] under --yes (no prompt), then packages/agent-gaslight/src/run.ts:200 awaits a real agent spawn per prompt; the 45s probe timeout is a long-running agent run, not a hang. Duplicate of ux-gaslight-no-plan-autopicks-and-hits-stale-model.md."
comment: "Apparent contradiction with ux-gaslight-no-plan-autopicks-and-hits-stale-model.md, which reports that --yes without a plan autopicks and runs rather than stalling - same invocation shape, different outcome, with the model as the only obvious difference. Resolve before scheduling: a 45s stall with no output is either the autopick path being slow or a genuine hang, and the two files disagree about which. Either way both propose the same sound fix: require an explicit plan non-TTY and fail fast."
---

# UX: gaslight --yes without plan path stalls non-TTY

## Summary

gaslight --mode read --yes --model haiku without plan path stalled past 45s — non-TTY should require plan path or fail-fast.

## Evidence

```bash
$ poe-code gaslight --mode read --yes --model anthropic/claude-haiku-4.5
# hangs / stalls (probe timed out 45s)
```

## Why it matters

Non-TTY gaslight without plan is unusable.

## Suggested direction

Require plan path or --plans non-TTY; fail-fast ValidationError.

## Severity

**High**

## Area

Gaslight / non-TTY
