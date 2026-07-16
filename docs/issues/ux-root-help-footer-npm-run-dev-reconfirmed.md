---
severity: high
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/utils/execution-context.ts:201-205 returns 'npm run dev --' only for mode development; global/npx modes yield 'poe-code'/'npx poe-code' (execution-context.ts:47-58), and src/cli/commands/misc-commands.test.ts:748 asserts 'Run poe-code <command> --help for command options.'"
comment: "Reconfirm duplicate within the root help footer trio; retire. No new evidence."
---

# UX: root help footer still says Run npm run dev -- <command> --help

## Summary

Root help footer: Run npm run dev -- <command> --help for command options — reconfirm identity leak on footer.

## Evidence

Run npm run dev -- <command> --help for command options.

## Why it matters

Reconfirm displayBinaryName.

## Suggested direction

Run poe-code <command> --help.

## Severity

**High**

## Area

Help / identity
