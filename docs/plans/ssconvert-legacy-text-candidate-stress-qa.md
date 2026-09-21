# Legacy text importer independent candidate stress QA

Execute this Markdown procedure against the current candidate, with primary source confined to `out/ssconvert-lifecycle/gnumeric-1.12.61`. Native utilities are separate manual QA oracles; unit tests use original in-memory byte fixtures and never invoke native code.

1. Audit `plugins/sc/sc.c` label validation and `plugins/applix/applix-read.c` shared-expression lookup together with `src/cell.c` NULL-expression guards.
2. Run `npx vitest run packages/ssconvert/src/codecs/legacy-text-candidate-stress.test.ts packages/ssconvert/src/codecs/legacy-text.test.ts packages/ssconvert/src/codecs/legacy-text-independent.test.ts`.
3. Run the maintained workspace `npm run lint --workspace=@poe-code/ssconvert` route. Root owns maintained uncached workspace build/test checks and virtual-command integration.
4. Independently compare SC malformed labels at `ZZ65536` and `A16777216`, including a later fatal `let ??? = 1`. Invalid labels must neither resize the workbook nor contribute maximum-sheet warnings.
5. Compare Applix unknown shared ID `missing` with an existing value 7 and with a new target. The unsupported ID must preserve 7 or the new blank value, respectively; it must not assign supplied cache 3. Capture stderr separately from status and CSV bytes.
6. Check original SC shell-shaped `system` and `exec` directives remain data, reference/function formulas produce a workbook expression, quoted Oleo semicolons remain string data, unsupported Oleo fields stop subsequent record fields, distinct-cell budgets reject excess cells, replacements remain permitted, and cancellation interrupts the cooperative record-reader yield.

## Recorded deterministic results

- Initial SC stress: four concrete failures, covering three malformed label commands resizing the sheet and one extra out-of-bounds warning. Source confirms labels are validated before native cell fetch. Repair moved validation before fetch.
- Initial Applix expectation of rejecting an unknown shared ID was investigated and corrected against the primary source: native assignment is a guarded no-op, not an import failure. The corrected prior-value case then failed (3 instead of 7). Repair retains previous cell assignment while applying the newly supplied formatting; a new target remains blank. A static assertion diagnostic is emitted for each unknown shared ID.
- Final focused suite: 54 tests passed in three files, including 12 independent candidate stress cases. No skips or incomplete focused runs. Fixtures are deterministic and original; no generated seed is involved.
- Maintained workspace lint passed on the final candidate after the static-diagnostic addition: provider generation, ESLint, source typecheck and test typecheck all returned status 0.
- Root independently confirmed native unknown-shared cases return status 0 with CSV `\n` for a new target and `7\n` for an existing value.

## Explicit remaining differences and unverified cells

- Native GLib critical stderr includes dynamic process/PID/time formatting. Product emits the stable assertion message through injected diagnostics; exact native wrapper bytes are not matched.
- Native process shutdown reports `Leaking N values.` because the invalid native assignment leaks the allocated cache. Product does not reproduce that leak or shutdown diagnostic. Consequently complete stderr byte equality and shutdown ordering for this unsupported shared-ID case remain mismatches.
- The stress agent did not measure performance, exhaust the expression grammar, qualify host/realm isolation, run checkpoint/replay, inspect screenshots, or complete the full compatibility runtime matrix. These are unverified here; root owns separate integration/build/oracle evidence. No native runtime is a product dependency or fallback.
- No README, export, integration, Git, push, or release changes were made by this agent.
