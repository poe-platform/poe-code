---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/runtime/jobs/index.ts:18-23 registers only ls/attach/logs/stop/sync/sandbox - no show/get; `npm run dev -- runtime jobs show` prints: error: unknown command 'show' (Did you mean stop?)"
comment: "Two findings, both fair: there is no show/get for job detail (a real gap, since ls is the only view and it is unusable), and Commander suggests 'stop' for 'show' - a semantically dangerous suggestion, since accepting it would act rather than inspect. That is a sharper version of the point ux-eval-unknown-command-suggests-lint-for-list.md makes: edit-distance suggestions can be actively harmful when the near-match is destructive. Carry it into the did-you-mean work as a constraint."
---

# UX: runtime jobs show is unknown; suggests stop (odd)

## Summary

runtime jobs show is not a command; Commander Did you mean: stop? — users expect show/get for job details.

## Evidence

```bash
$ poe-code runtime jobs show
error: unknown command 'show'
(Did you mean stop?)
```
Commands: ls, attach, logs, stop, sync, sandbox.

## Why it matters

Missing show/get detail command; wrong suggestion.

## Suggested direction

Add jobs show <id> or make ls default detail; better suggestions.

## Severity

Medium

## Area

Runtime jobs
