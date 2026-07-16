---
severity: medium
impact: usability
reproduced: y
recommendation: fix
comment: "Real and well evidenced: --config and --workflow are documented identically ('Path to WORKFLOW.md') and are mutually exclusive at runtime, while root maestro rejects --config entirely - so one concept has two names on one subcommand and one name on its parent. Alias one to the other and use it consistently. Same flag-inconsistency family as ux-install-skill-flags-inconsistent-across-commands.md."
evidence: "src/cli/program.ts:640-647 tui defines --config and --workflow both 'Path to WORKFLOW.md' then throws 'Specify only one of --config or --workflow'; root maestro (program.ts:495-533) takes only positional [path] and -c is --max-concurrent, so --config is unknown there."
---

# UX: maestro tui has both --config and --workflow for same path

## Summary

maestro tui accepts --config and --workflow for WORKFLOW.md and errors if both set — duplicate flags for one concept; root maestro may not accept --config the same way.

## Evidence

```bash
$ poe-code maestro tui --config ./no.md --workflow ./no2.md
■  Specify only one of --config or --workflow for Maestro TUI.
$ poe-code maestro --config ./no.md
error: unknown option '--config'
```
tui help lists both --config and --workflow as Path to WORKFLOW.md.

## Why it matters

Duplicate flags confuse; root vs tui flag surface differs.

## Suggested direction

Single --config (or --workflow) everywhere; alias the other.

## Severity

Medium

## Area

Maestro
