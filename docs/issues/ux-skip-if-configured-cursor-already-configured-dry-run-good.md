# UX: configure cursor --skip-if-configured dry-run says already configured (positive)

## Summary

configure cursor --model haiku --skip-if-configured --yes --dry-run: Dry run: Cursor is already configured; no filesystem changes — skip works for cursor when already configured (contrast claude still full rewrite).

## Evidence

```bash
$ poe-code configure cursor --model anthropic/claude-haiku-4.5 --skip-if-configured --yes --dry-run
●  Dry run: Cursor is already configured.
●  # no filesystem changes
```

## Why it matters

Positive truthful skip path exists for some agents; claude path still lies.

## Suggested direction

Apply same short-circuit to claude-code configure.

## Severity

Low

## Area

Configure / positive pattern
