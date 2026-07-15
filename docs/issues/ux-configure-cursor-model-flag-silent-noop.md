---
severity: medium
impact: correctness
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
