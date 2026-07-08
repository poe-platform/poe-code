# UX: utils config show dumps large nested JSON

## Summary

utils config show prints full global config JSON including configured_services detail — useful but noisy; no --json flag separation and no summary mode.

## Evidence

```bash
$ poe-code utils config show
●  ── Global config (…) ──
│  { "configured_services": { … large … } }
```

## Why it matters

Hard to scan; secrets risk if keys ever appear in config.

## Suggested direction

Summary table of services + --json full dump; redact secrets.

## Severity

Medium

## Area

Utils / config
