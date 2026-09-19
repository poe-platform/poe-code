# csvcut implementation and QA

Implement the literal csvkit 2.2.0 utility in the domain command descriptor,
using the existing shared injected engine and safe-bash registration. Preserve
all original executable names and the command's declared parser actions.

1. Authenticate the source archive against SHA-256
   `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
2. Compare `csvcut.py` and the inherited raw reader/selector helpers. Reproduce
   singleton generated-header error punctuation with a failing in-memory test.
3. Implement selection, exclusion and deletion in `src/commands/csvcut.ts`.
4. Compare exact stdout, stderr and status against frozen raw observations;
   check CLI/SDK parity, flag collisions and raw string preservation.
5. Have a different agent stress safe-bash command invocation, names-only early
   return, selectors and cleanup. Root owns integration and domain corrections.
6. Run the csvkit maintained unit/lint checks and selected workspace build
   closure, then safe-bash focused integration checks. Inspect CLI output where
   screenshot tooling can reach this injected shell command.

Non-string input quoting modes 2, 4 and 5 remain shared-reader blockers.
Verbose Python tracebacks require a qualified frozen deployment identity and
frames; errors otherwise report unsupported status 78. These cases must remain
explicit skips/blockers, never compatibility passes. No commits or delivery.
