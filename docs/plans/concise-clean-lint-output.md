# Concise clean lint output

Successful default lint currently prints every receipt and directory identity,
producing megabytes of output in each commit and release. Keep a compact JSON
summary of complete clean stylish runs: status, findings, scope and authenticated
receipt/directory counts. Explicit `--format json` retains the complete audit.
Warnings, failures, incomplete runs and initialization diagnostics retain their
existing full output. No guard, admission, budget, selection or exit-code changes.

Two in-memory regression controls cover clean summary versus full JSON and full
warning/incomplete diagnostics. The clean-summary assertion fails before the
implementation. Run the complete guarded-lint unit suite and the normal commit
hook after the change. This is build-tool output, not the interactive product CLI.

All 255 lint unit tests pass, as does the root TypeScript check. The captured clean
root result shrinks from 2,327,782 bytes to a 222-byte summary while retaining
9,551 linted subjects, zero errors and zero warnings in the status.
