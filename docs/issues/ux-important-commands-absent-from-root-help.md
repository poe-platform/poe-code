---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/program.ts:81-101 ROOT_HELP_COMMAND_SPECS curates 19 commands, omitting skill/memory/provider/runtime registered at program.ts:882-899; footer at program.ts:267 only says 'Run <command> --help for command options', no show-all escape hatch"
comment: "Contentless duplicate of ux-root-help-hides-skill-memory-runtime-eval-and-more.md, which has the full list; retire into it. Its one contribution is the escape-hatch idea - a 'more commands' footer - a good cheap answer to the curation-versus-completeness tension that should survive in the canonical."
---

# UX: Important commands absent root help no escape hatch

## Summary

skill/memory/provider missing no show-all.

## Evidence

root help curated.

## Why it matters

Dead end.

## Suggested direction

more commands footer.

## Severity

Medium

## Area

Help / IA
