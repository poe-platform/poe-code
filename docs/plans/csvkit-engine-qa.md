# CSV engine and safe-bash qualification procedure

This procedure supplements the existing ordered csvkit plan. It authorizes no
commits, pushes, publication or README additions. Full acceptance requires the
remaining operations/profiles in docs/csvkit/implementation-status.md.

1. Inspect root/index state and preserve unrelated edits/staging. Run the
   maintained selected csvkit build, package tests and package lint uncached.
   Canonical cases use only in-memory inputs and mock capabilities; native
   captures are research under out, not runtime unit dependencies.
2. Build the maintained safe-bash dependency closure. Run maintained safe-bash
   test:unit gate, including independent stress tests. SAFE_BASH_TEST_RG does not narrow this maintained runner; targeted Node test runs are supplementary evidence only.
   Register exact new integration test paths in integration-inputs.test.mjs.
3. Execute compiled public SDK and plugin imports through Shell/MemoryFileSystem.
   Verify fourteen original names, SDK settings/argv equivalence, exact pipe
   bytes, cwd/literal paths, redirection, status/partial stderr and collision
   preflight. Test cancellation/downstream closure without host subprocess tools.
4. Render actual shell help, error CSV, NDJSON, JSON/CSV round trips, raw DDL and raw look/sort/join results with terminal-png
   under out. Visually inspect them for clipping, wrapping and readable output.
   Screenshots are ad hoc evidence, not snapshot tests. Run the maintained
   screenshot-poe-code route for the containing CLI as appropriate.
5. Expand shared integration validation to the normal npm run build, npm test
   and repository lint routes. Disclose actual runner membership; a targeted Node test run cannot certify all safe-bash tools. Repair missing local
   workspace links/build prerequisites before interpreting unrelated failures.
   Never waive unavailable cases or change failing assertions to broad counts.
6. Reference remeasurement uses the authenticated csvkit source and hash-locked
   CPython 3.14.2 environment/profile. Keep original observations, failures and
   blockers with exact source/profiles. No subprocess appears in product code.
7. Qualify each missing Agate type, regex, format, dialect/driver, persistence,
   interpreter and compression dependency before enabling corresponding paths.
   Real-service/interactive QA uses explicitly owned disposable capabilities.
   Raw JSON QA must distinguish ordered maps from JavaScript integer-key order,
   preserve lexical integer/Decimal text, exercise native nonfinite spellings,
   and keep unpaired-surrogate/nesting refusals explicit. Raw SQL QA must cover
   duplicate UNIQUE selectors, percent escaping, dialect nullable clauses and
   MySQL unconstrained VARCHAR failure. Verify supplied VFS effects separately
   from upstream file-opening/seek precedence; injected readFile cannot qualify
   native eager open behavior.
8. Reduce check outcomes and visual findings to maintained docs; purge only
   owned temporary evidence. Review concrete usage-draft.md before requesting
   the required README permission as a final delivery gate.
