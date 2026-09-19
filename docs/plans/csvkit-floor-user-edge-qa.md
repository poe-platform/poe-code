# SQLite floor user edge QA

1. Execute native SQLAlchemy/csvkit floor queries under the explicitly bound
   CPython reference in owned `out/csvkit-floor-user-edge` scratch. Authenticate
   interpreter and capture actual distribution versions; preserve frozen-profile
   drift as a blocker. Check INTEGER identity, negative rounding, NULL/text/blob,
   infinities, signed 64-bit limits, wrong arity and rollback after callback errors.
2. Add original failing in-memory regressions before changing the provider.
   Compare exact command stdout/stderr/status and typed database rows, then verify
   transaction effects and recovery. Native programs are observers only.
3. Run maintained uncached domain tests/lint/build and focused actual safe-bash
   SQL tests. Inspect a screenshot if visible diagnostics change. Record measured
   outcomes and limits in docs/csvkit; purge only owned scratch after reduction.
