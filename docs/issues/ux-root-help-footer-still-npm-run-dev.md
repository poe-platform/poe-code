---
severity: high
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/utils/execution-context.ts:196-210 formatCliUsageCommand returns 'npm run dev --' only for mode=development (detected via .ts/src path or npm_lifecycle_event=dev at :64-79); installed runs hit the global branch, asserted by src/cli/commands/misc-commands.test.ts:748 expecting 'Run poe-code <command> --help for command options.'"
comment: "Third duplicate within the root help footer trio; retire. Its one useful qualification is worth carrying to the root cause file: it notes this appears 'when run via tsx', which is the honest framing - the leak is a property of the dev invocation, so an installed user may never see it. That materially lowers the real severity of the whole identity cluster and is worth verifying against a published install before scheduling seven High issues."
---

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
