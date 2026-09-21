# ssconvert calculation-core QA

1. Verify the official Gnumeric 1.12.61 archive SHA-256
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`
   before source inspection. Acquire/extract primary source only under `out`.
   Identify the retained dependency/plugin/C-locale/UTC profiles separately from
   current native execution availability. Never put a native oracle in the engine.
2. Before repairs, run original in-memory regressions for lazy IF, absent/omitted
   branches, implicit intersection, coercion, comparisons and numeric domains.
   Preserve failing observations; do not derive expectations from the evaluator.
3. Review `src/func-builtin.c` registration, `expr.c` coercion/intersection/error
   precedence, `dependent.c` iteration, `rangefunc.c` product, and the captured
   GOffice accumulator source. Cover every normally registered builtin. Record
   conditional test-suite descriptors and unsupported plugins separately.
4. Exercise named/cell dependency chains, dirty/clean/manual/forced caches,
   shared and array groups, TABLE input/header dependencies and temporary values.
   Exercise exact error caches, source-order retention and borrowed input ownership.
5. Inject time/random sources and authorized external-reference capabilities.
   Check missing capabilities, result admission and cancellation. Never allow
   formula text to perform ambient filesystem/network/process access. Document
   native randomness, clock/date-zone behavior and recalculation-order uncertainty.
6. Have a different agent stress/fix the implemented evaluator using additional
   original fixtures and TDD. Root retains exports/integration/Git ownership.
   Tests remain in-memory; unit file effects use memfs and no native utilities.
7. Run fresh ssconvert package test/lint, the maintained uncached selected
   ssconvert/safe-bash build closures, focused virtual-command tests/lint and
   the maintained safe-bash typecheck. Record failed prerequisites/guards as
   failures, without weakening assertions or changing unrelated metadata.
8. Invoke the actual built Shell/ssconvert command through the repository
   screenshot route. Inspect formula output, error diagnostics, exit statuses
   and unchanged destinations. Store screenshots/drivers only in `out`; purge
   task-owned artifacts after reducing evidence.
9. If the exact native oracle is available, run independently generated small
   workbook fixtures under its authenticated dependency/plugin/locale profile.
   Compare bytes, statuses, diagnostics and namespace effects exactly. Numeric
   tolerances require a per-function error analysis and apply only to numeric
   values; they cannot conceal any text/CSV mismatch. Unavailable native cases,
   unsupported functions/formats and host-resource refusals are not parity passes.
   Reduce verified coverage and all remaining mismatches into
   `docs/ssconvert/calculation-core-verification.md`.
