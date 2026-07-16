---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/program.ts:852 registers '-y, --yes' on the root program only; formatSubcommandHelp gates the Global Options section behind helper.showGlobalOptions (src/cli/program.ts:320), which is never enabled, so 'npm run dev -- gaslight --help' prints Options without --yes."
comment: "Duplicate of ux-global-yes-not-listed-on-spawn-gaslight-help.md, which covers both spawn and gaslight and correctly frames this as a global-flag inheritance problem rather than a gaslight one; retire into it. Also overlaps ux-global-flags-hidden-on-subcommand-help.md, the general statement."
---

# UX: gaslight --yes flag not listed in Options section

## Summary

`gaslight --help` does not list `--yes` as a standalone option. Like `spawn`, it is referenced only indirectly. The Options section shows no `--yes` entry despite the command accepting it.

## Evidence

Options section shown in help contains `--mode`, `--task`, `--worktree`, `-h` but no `--yes`.

## Why it matters

CI pipelines and non-TTY invocations of `gaslight` cannot confirm intent via `--yes` without knowing it exists. The flag is invisible to help-first users.

## Suggested direction

Add `--yes` explicitly to the Options section matching the pattern of other commands that accept it.

## Severity

Medium

## Area

Gaslight / help / discoverability
