# UX: plan list invalid --output validates cleanly (positive)

## Summary

Invalid --output value "bad" returns Expected one of: terminal, md, json without raw Commander skin.

## Evidence

```bash
$ poe-code plan list --output bad
■  Invalid --output value "bad". Expected one of: terminal, md, json.
```

## Why it matters

Positive validation pattern.

## Suggested direction

Keep; use for all enum flags.

## Severity

Low

## Area

Plan / positive pattern
