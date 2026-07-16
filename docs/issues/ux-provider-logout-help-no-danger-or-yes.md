---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "`npm run dev -- provider logout --help` lists only `-h, --help`; global `-y, --yes` and `--dry-run` are defined at src/cli/program.ts:852-853 and honored by executeProviderLogout (src/cli/commands/provider.ts:365-388) but never rendered because showGlobalOptions is off (src/cli/program.ts:320); no danger note naming the deleted credential file."
comment: "Partly wrong and needs correcting before scheduling: it asserts there is no --dry-run, but ux-provider-logout-anthropic-dry-run-good.md shows --dry-run working. So the real defect is narrower than claimed - the flags exist and help does not document them, which is the global-flags rendering problem plus a missing danger note. Keep the danger-note ask, drop the missing-capability claim."
---

# UX: provider logout --help only shows -h — no --yes, --dry-run, or danger warning

## Summary

`provider logout --help` only documents `-h, --help`. Credential removal is destructive yet there is no `--yes` for non-TTY, no `--dry-run`, and no blast-radius description. Same class as logout/unconfigure help gaps (#102, #103, #228).

## Evidence

```
Options:
  -h, --help    Display help for command
```

## Why it matters

CI scripts that call `provider logout poe` cannot confirm intent with `--yes`; there is no safe preview via `--dry-run` to verify which credential file will be removed.

## Suggested direction

Document `--yes`, `--dry-run`; add a one-line danger note naming the credential file that will be deleted.

## Severity

High

## Area

Provider / help / destructive
