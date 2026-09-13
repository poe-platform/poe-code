
### qualify-language-semantics — new.target spelling, 2026-09-13

**Acceptance remains incomplete.** [Atomic audit and receipts](qualify-language-semantics/new-target/audit.md)
record six independent failures before repair. `new.target` now requires the literal
identifier terminal; escaped spellings and the independently discovered `new.#target`
misparse reject early. Ordinary escaped constructor/property names remain valid.
Final affected checks: **87 passed / zero failed or skipped**; scoped lint and
maintained workspace build pass. Original upstream contexts and neighboring controls:
**10/10 variants on each of six Node runtimes**, complete, exit0, independently
reconciled to the unchanged V4 fixture hashes/modes. No complete suite was repeated.

Candidate parent `a43f01b8b549e02ffd4cff78a637e6e41561600b`, preserved working changes,
fingerprint `52adcef3e986f6ea0e77b1462117640313807f33a955c1c9935e93bc0c180a5f`;
Node **22.23.2 / ICU78.2**. Node18 minimum and available Node18/20/24/26 cells retain
exact runtime receipts. Bun SDK/native/replay controls pass; Bun mapped upstream,
Workerd and the two missing exact N20/N24 patch-version cells remain unverified.

Checks cover syntax/lint, bound constructors, arrow/eval new.target, Function early
errors before side effects, finally/error identity, saved function source, repeated
pending/completed replay, host-escape denial and enforced step budgets. CLI screenshot
was inspected; CLI/SDK location and diagnostics agree. Initial lint-probe and public
error-class expectation mistakes are recorded failed attempts, with the existing
public DisallowedSyntaxError contract independently verified before correcting the
probe. No production error policy, authority, budget, timeout or assertion was weakened.

**Remaining:** 171 historical primary nonpasses before edition/extension dispositions,
126 secondary resource nonpasses, category/other-owner reconciliation and full
runtime/artifact/task gates. Local class-modifier commit is `a43f01b8b`; this repair
receives its own atomic commit. No task push, verified remote-main delivery or
release/publication is claimed. Unrelated working/staged changes remain preserved.
