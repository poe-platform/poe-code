---
severity: low-medium
impact: none
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/plan.ts:375-392 renderPlanList writes bare JSON.stringify for json format; plan.ts:598 calls intro() only when format is terminal; traces.ts:86 and tasks.ts:66 use --json instead of --output json"
comment: "Answers itself: raw JSON on stdout is correct for scripting and the file concedes it. The genuinely useful half is the consistency question it raises - plan list uses --output json while traces and tasks use --json, so the machine-output convention differs across commands. Route that to ux-json-flag-inconsistent-across-commands.md, which should own the CLI-wide decision."
---

# UX: plan list --output json dumps raw JSON array without framing

## Summary

plan list --output json prints a raw JSON array to stdout with no design-system intro; --output md prints a markdown table. Useful for scripting but inconsistent with --output terminal panel and with --json conventions elsewhere.

## Evidence

```bash
$ poe-code plan list --output json
[ { "kind": "plan", ... }, ... ]
$ poe-code plan list --output md
| Kind | Type | Name | ...
```

## Why it matters

Three output modes; json mode is good for scripts if documented as pure stdout.

## Suggested direction

Document --output; prefer --json alias for consistency with traces/tasks.

## Severity

Low–Medium

## Area

Plan list
