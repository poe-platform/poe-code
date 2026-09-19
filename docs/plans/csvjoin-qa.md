# csvjoin QA procedure

1. Reproduce original failing typed singleton and numeric/Boolean-key cases
   using in-memory `csvjoin.test.ts`, before implementing the typed engine.
2. Install the frozen CPython 3.14.2 hash-locked reference only under an owned
   `out` directory. Verify installed csvjoin source against the source manifest.
   Capture exact stdout, stderr and status in `docs/csvkit/csvjoin-reference.json`.
   Canonical tests read observations and use injected in-memory capabilities.
3. Compare all baseline join observations, typed equality, NaN, warning repeats,
   multi-input full/right ordering, outer precedence and the zero-index quirk.
   Check SDK parity, output backpressure, cancellation/cleanup and bounded
   Cartesian result expansion without output or input writes.
4. Have a separate agent stress the actual safe-bash tool, following
   `csvjoin-stress-qa.md`, retaining root integration/export/Git ownership.
5. Run maintained csvkit workspace test/lint, selected safe-bash build closure,
   focused actual shell tests, exact integration-discovery registration tests,
   scoped ESLint and maintained safe-bash type checking. Record actual outcomes
   and unqualified skips/TODOs in the validation report.
6. Render actual built Shell examples via maintained `npm run screenshot`,
   inspect their layout and CSV bytes, then purge only owned temporary evidence.
   Do not commit, push, publish or add README content.
