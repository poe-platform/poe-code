# csvjoin selector whitespace stress validation

The released csvkit 2.2.0 source implements
`CSVJoin._parse_join_column_names` as
`list(map(str.strip, join_string.split(',')))`. The JavaScript command instead
used `String.trim`, which excludes Python whitespace U+001C–U+001F and removes
U+FEFF. This made valid selected column names fail with status 1 before output.

Six new in-memory regressions failed before the fix: argv and SDK paths for
U+001C/U+001F around `k`, a preserved trailing U+FEFF in the column name, and
mixed U+001D/U+001E around a name ending in U+FEFF. Both routes now reuse the
existing Python whitespace helper. Exact stdout is respectively
`k,a,b\nx,A,B\n` or `k\ufeff,a,b\nx,A,B\n`, stderr is empty, and status is 0.
The focused regression and existing csvjoin suite passed all 79 cases.

An explicit development-only native probe used cached CPython 3.14.2 and
csvkit 2.2.0. It corroborated the source helper and all three full command
outputs with `_open_input_file` explicitly injected as StringIO. No native
program or Python fallback is used in product code or canonical tests. This
probe did not reauthenticate every frozen installed-file hash, so it is source
corroboration rather than a passing authenticated frozen differential gate.

Maintained uncached verification succeeded: `npm test
--workspace=@poe-code/csvkit` (97 files, 4,376 passes, one explicit skip and five
explicit TODOs), `npm run lint --workspace=@poe-code/csvkit` (ESLint and both
source/test TypeScript checks), and `npm run build:workspaces --
--workspace=@poe-code/csvkit` (declared dependency build closure). The skip and
TODOs remain blockers, not passes. Root-owned actual safe-bash visual
verification is recorded with final integration results. This narrow fix makes
no claim of complete csvkit compatibility.
