---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "Probe: 'npm run dev -- configure cursor --model anthropic/claude-opus-4.7 --yes --dry-run' and the same command without --model both print only 'Dry run: would configure Cursor.' + '# no filesystem changes'. Root cause: src/providers/cursor.ts:31 sets manifest.configure to [] so no mutations are reported, and src/cli/commands/configure.ts:192-212 gates saveConfiguredService (which persists metadata.model) behind '!flags.dryRun', so the resolved model is never surfaced in dry-run. Real runs do persist the model, so this is dry-run fidelity, not a dropped flag."
comment: "Sharpest of the cursor dry-run set and not a pure duplicate: an explicit --model produces byte-identical output to no --model, so either the flag is ignored for cursor or the dry-run hides it - the same unresolved ambiguity as the --base-url pair. Keep as the concrete probe: configure cursor for real and check whether the model lands. That answer decides correctness versus dry-run fidelity."
---

# UX: configure cursor --model is silent no-op in dry-run

## Summary

configure cursor --model anthropic/claude-opus-4.7 --yes --dry-run still only says would configure / no filesystem changes — explicit --model not reflected in dry-run output (extends cursor dry-run too quiet).

## Evidence

```bash
$ poe-code configure cursor --model anthropic/claude-opus-4.7 --yes --dry-run
●  Dry run: would configure Cursor.
●  # no filesystem changes
```

## Why it matters

Cannot verify model application for Cursor.

## Suggested direction

Print resolved model/provider/files even when no-op.

## Severity

Medium

## Area

Configure
