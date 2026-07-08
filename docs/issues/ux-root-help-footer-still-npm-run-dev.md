# UX: root help footer still says npm run dev for command options (reconfirmed)

## Summary

Root help ends with Run npm run dev -- <command> --help for command options — reconfirm development-mode identity leak on published help path when run via tsx.

## Evidence

```text
Run npm run dev -- <command> --help for command options.
```

## Why it matters

Reconfirm displayBinaryName issue.

## Suggested direction

Always poe-code in help footers.

## Severity

**High**

## Area

Help / identity
