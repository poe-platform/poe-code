---
severity: low
impact: none
comment: "Positive pattern; consolidate with ux-spawn-at-file-missing-validation-good.md. Its 'document in help Examples' suggestion is the actionable half: @file is a genuinely useful prompt form that nothing advertises, which makes it a discoverability gap rather than a positive - route it to the examples work."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/spawn.ts:546-567 resolvePromptInput reads @<path> into the prompt; spawn.ts:143-145 already documents \"'@path/to/file' to load from a file\" in the prompt argument help, so no defect and no discoverability gap."
---

# UX: spawn @file prompt works (positive reconfirm)

## Summary

spawn claude @/tmp/file with content succeeds — reconfirm @file prompt form works.

## Evidence

@file prompt → agent ok

## Why it matters

Positive prompt form.

## Suggested direction

Keep; document in help Examples.

## Severity

Low

## Area

Spawn / positive pattern
