---
severity: high
impact: discoverability
comment: "Per-command npm run dev filing; retire into ux-development-mode-usage-intentional-but-leaks.md. Note it rates the identity leak High while the near-identical ux-eval-run-missing-params-npm-run-dev.md rates it Medium - normalise across the cluster. Its incidental positive is worth keeping: the format validation itself lists valid values, matching the good pattern in ux-configure-unknown-api-shape-lists-exposed.md."
---

# UX: eval report invalid format uses toolcraft + npm run dev help

## Summary

Invalid --format bogus returns Expected one of: json, md, table with Run npm run dev -- eval report --help — good validation text, wrong binary identity.

## Evidence

```bash
$ poe-code eval report --format bogus
■  Invalid value for "format". Expected one of: json, md, table, got "bogus".
│  Run npm run dev -- eval report --help for usage.
```

## Why it matters

Reconfirm toolcraft identity leak on validation.

## Suggested direction

displayBinaryName=poe-code.

## Severity

**High**

## Area

Eval / identity
