
### qualify-language-semantics — escaped class modifiers, 2026-09-13

**Acceptance remains incomplete.** [Atomic repair and evidence](qualify-language-semantics/class-modifiers/audit.md)
reproduce **nine failed tests** before repair. Escaped `async`/`static` no longer
act as class grammar terminals; ordinary escaped names and newline-separated
instance fields retain their valid semantics. This closes six recorded primary
strict/sloppy failures. The V4 manifest, aggregate and inventory hashes were
independently reverified; edition and extension pins are unchanged.

Final focused checks: **96 passed / zero failed or skipped**; scoped lint and the
maintained selected workspace build pass. Original pinned upstream contexts:
**10/10 variants** on Node22, including all six recorded failures and their four
controls. Parent source SHA `7d645b4cb6261dba2d3cbf06208efd800fc8b989`, preserved
working changes, fingerprint
`a1eb3c4500fdcdc38e5ab4a3968da0af57a5c84e5096ec236760540ef64b424f`,
Node **22.23.2 / ICU 78.2**. Runtime-specific commands and terminal outcomes are
retained with exact versions; alternate patch versions do not certify missing cells.

Built CLI/SDK diagnostics agree; the actual screenshot was inspected. Independent
controls cover strict/sloppy/module syntax, lint, eval and dynamic Function,
errors/finally, private class source/state, three pending checkpoint/replay cycles,
completed replay, constructor-chain authority denial and enforced step budgets.
The Bun lazy-native-compilation probe and Node18 initial loader failure remain
recorded failed attempts, followed by separately justified successful checks.
No assertion, budget, deadline, runtime contract or snapshot format was weakened.

**Remaining:** 173 prior primary nonpasses before edition/extension disposition,
126 secondary resource nonpasses, other-owner reconciliation, Workerd, exact
missing runtime cells and installed-artifact/full-task gates. Counts are historical
residuals, not a fresh whole-selection pass. Unrelated local/staged changes remain
preserved. The repair receives its own local commit; verified remote-main delivery
and release/publication are **not performed** and are not inferred from other tasks.
