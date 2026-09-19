# in2csv user-edge validation

The 25 additional original observations in `in2csv-user-edge-reference.json` use the frozen CPython 3.14.2 profile. The reference executable SHA-256 was checked as `3d6400b63b150164e89a690d9813af8b0eb420af9f336ef1f6c5102c6da60eae`; csvkit 2.2.0, Agate 1.14.2, agate-excel 0.4.2, agate-dbf 0.2.4, SQLAlchemy 2.0.54, Babel 2.18.0 and dbfread 2.0.7 match the profile. Reference processes are capture tooling only.

Initial canonical replay reproduced ten failures among sixteen observations: fixed schema errors were evaluated out of order; DBF integers lost precision, interior asterisks were discarded, and F values lost their float spelling; scalar JSON containers returned unsupported status. Follow-up cases reproduced invalid hexadecimal acceptance, float signed-zero/scientific spelling errors, and incorrect JSON non-finite type names. Every change followed an original failing regression.

Final canonical workspace test route: `VITEST_MAX_WORKERS=1 npm run test --workspace @poe-code/csvkit` passed 2,722 tests in 50 files. One skipped and six TODO cases remain blockers. `npm run lint --workspace @poe-code/csvkit` passed ESLint and both TypeScript configurations. The final DBF float-padding case separately reproduced an incorrect null conversion before its fix; float fields containing whitespace after stripping outer asterisks retain the reference error.

The independent agent's final replay passed 90 actual Shell/VFS tests: 62 previous observations, these 25 observations, and three workbook selector/collision/reopen effects cases. Its earlier 24-observation expansion reproduced 18 failures against the old build, then passed all 89 after rebuilding; the final padding case passed after the last importer rebuild. Ten existing shell stress/output-ownership tests and eleven selected maintained discovery/inventory tests also passed, with zero skips or TODOs.

`npm run build:workspaces -- --workspace=@poe-platform/safe-bash` passed its uncached declared build closure. The final importer-only padding correction then passed `npm run build:workspaces -- --workspace=@poe-code/csvkit`. `npm run typecheck --workspace @poe-platform/safe-bash` passed source/tests and 26 current consumer groups, including expected negative-type failures. Type checking does not establish runtime compatibility of historical integrations.

An actual built-shell screenshot was inspected: large DBF integer output retained every digit, and scalar JSON emitted the measured error with status 1. Two earlier screenshot attempts used incorrect import/capability bindings and failed; only the corrected execution is visual validation. Temporary capture inputs and screenshots are removed after inspection.

This review does not establish all possible input semantics. Existing blockers in `in2csv-validation.md` remain, including extended DBF fields, unusual workbook structures, synchronous workbook parser cancellation limits, shared inference/quoting gaps and non-Excel all-sheet decoding. Non-ASCII malformed DBF numeric diagnostics remain explicit blockers. Full repository tests were not rerun for these focused importer changes; the earlier unresolved repository acceptance result remains unchanged.

No staging, commit, push, publication or README addition was performed.

Final maintained repository ESLint route `npm run lint:eslint` passed with zero errors and two warnings in docx tests. This is ESLint validation; it is not a claim that the full repository `npm test` or complete root lint chain was rerun.
