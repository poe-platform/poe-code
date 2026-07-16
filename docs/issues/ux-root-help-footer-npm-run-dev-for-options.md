---
severity: high
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/utils/execution-context.ts:197-213 formatCliUsageCommand returns 'npm run dev --' only for mode 'development'; npx/global modes return 'npx poe-code'/'poe-code'. src/cli/program.ts:840-841 derives root help usage+footer from detected execution context, so published users never see the dev footer."
comment: "One of three filings of the root help footer npm run dev leak; consolidate, then retire the whole group into the root cause ux-development-mode-usage-intentional-but-leaks.md. The root help identity cluster now runs to roughly seven files (three footer, three usage line, plus variants) for one mechanism and one fix."
---

# UX: Root help footer npm run dev for options

## Summary

Footer: Run npm run dev -- <command> --help.

## Evidence

Root help end.

## Why it matters

Wrong for published users.

## Suggested direction

poe-code <command> --help.

## Severity

**High**

## Area

Help / identity
