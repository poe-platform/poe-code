---
severity: low-medium
impact: usability
comment: "Positive-with-a-gap that duplicates the real point of ux-log-file-name-no-path-feedback.md: logging works and never says where it wrote. Consolidate the two into one 'print the log path' issue. The relative-path confirmation here is useful evidence, not a defect."
reproduced: y
recommendation: no-fix
evidence: "packages/agent-spawn/src/acp/middlewares/spawn-log.ts:61 joins ctx.logDir (relative ok) and mkdirs at :155; src/sdk/types.ts:174 exposes result.logFile but rg 'logFile' over src/cli shows no command prints it (spawn.ts only prints resume hint at :451) - duplicate of ux-log-file-name-no-path-feedback.md"
---

# UX: --log-dir relative path works but still no path printed

## Summary

spawn --log-dir ./tmp-ux-logs creates timestamped jsonl under relative dir successfully — works; still no printed path (related log-file-name feedback).

## Evidence

--log-dir ./tmp-ux-logs creates …/tmp-ux-logs/2026….jsonl; spawn output omits path.

## Why it matters

Relative log-dir works; users still need path echo.

## Suggested direction

Print log path on complete.

## Severity

Low–Medium

## Area

Spawn / logging
