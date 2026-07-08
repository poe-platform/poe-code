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
