---
severity: medium
impact: usability
comment: "Keep of this pair as the substantive half: the full nested dump is hard to scan, and its secrets note is the important one - ux-utils-config-show-logged-out-clean-no-secrets.md only proves it is clean when logged out, so the redaction question is unanswered for the logged-in case. Given the dry-run cluster proves secrets do leak elsewhere, verify this path with credentials present. Its summary-plus---json fix is right."
---

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
