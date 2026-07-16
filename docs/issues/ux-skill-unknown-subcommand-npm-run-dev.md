---
severity: medium
impact: polish
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- skill foobar prints 'Unknown command: foobar' + 'Run npm run dev -- skill --help for available commands.'; src/cli/commands/skill.ts:76-82 passes helpArgs [skill, --help] to throwCommandNotFound (src/cli/command-not-found.ts:20), which builds the hint via formatCliHelpCommand -> formatCliUsageCommand returning 'npm run dev --' for mode development (src/utils/execution-context.ts:197-201). Dev-mode-only string; published binary renders poe-code. Duplicate of root-cause ux-development-mode-usage-intentional-but-leaks.md; typo-suggestion ask belongs to the did-you-mean cluster."
comment: "Per-command npm run dev filing; retire into ux-development-mode-usage-intentional-but-leaks.md. Its typo-suggestions ask belongs to the did-you-mean cluster."
---

# UX: skill unknown subcommand uses npm run dev recovery

## Summary

skill foobar: Unknown command: foobar + Run npm run dev -- skill --help — identity leak on skill group.

## Evidence

Unknown command: foobar
Run npm run dev -- skill --help for available commands.

## Why it matters

Reconfirm displayBinaryName on nested groups.

## Suggested direction

poe-code skill --help; typo suggestions.

## Severity

Medium

## Area

Help / identity
