# SQL schema user edge QA

1. Audit current SQL compiler and existing independent coverage against the frozen csvkit 2.2.0 / CPython 3.14.2 / Agate 1.14.2 / agate-sql 0.7.3 / SQLAlchemy 2.0.54 profile.
2. Probe zero, negative and large integer text-length options in connected CREATE compilation. Compare exact SQL bytes with the native reference; preserve schema-only option differences.
3. Reproduce each validated mismatch with a failing in-memory domain regression before editing product code. Verify exact output/status and ordered injected database effects after the fix.
4. Ask a different agent to exercise fresh edge cases through actual safe-bash Shell registration. Root owns integration inventory registration and domain fixes.
5. Run uncached maintained csvkit tests/lint, selected safe-bash workspace build closure, runner checks and focused shell tests. Inspect representative output through an ad hoc screenshot; keep temporary evidence in out and remove this run's artifacts after inspection.
6. Record measured results and remaining blockers in docs/csvkit. Preserve unrelated files/staging; no README edits, commits, pushes or publication.
