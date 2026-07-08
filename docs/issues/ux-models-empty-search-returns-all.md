# UX: models --search "" and --provider "" return all 341 models

## Summary

Empty string filters are treated as no filter (341/341) rather than validation error — easy footgun in scripts that pass empty env vars.

## Evidence

```bash
$ poe-code models --search ""
●  341/341 models
$ poe-code models --provider ""
●  341/341 models
```

## Why it matters

Empty explicit flags should error or no-op with warning.

## Suggested direction

Reject empty --search/--provider when flag present.

## Severity

Medium

## Area

Models
