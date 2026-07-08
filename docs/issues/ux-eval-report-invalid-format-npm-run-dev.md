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
