# Input quoting string-record validation and remaining blockers

Runtime previously refused quoting 2 (QUOTE_NONNUMERIC), 4 (QUOTE_STRINGS) and
5 (QUOTE_NOTNULL) before the existing typed CSV parser could run. The sealed
raw-operation-reference csvcut case 37 therefore returned status 78 instead of
the original status 1 and `ValueError: could not convert string to float: 'a'`.
Activating that original case reproduced the failure before source changes.

Runtime now parses first. It propagates numeric conversion errors and admits
records only if every cell is a string. Eighteen new in-memory tests cover
quoted string headers/data across csvcut/csvformat/csvclean/csvsort, original
conversion errors, unsupported first float/null records after string headers,
awaited header output and input-iterator finalization. This preserves the
current string-only operation/inference contracts without silent coercion.

For `"a","b"\n1,2\n` with input mode 2, the product writes `a,b\n`, then
returns status 78 and
`csvkit: unsupported or unqualified: input quoting mode 2 numeric/null operation cells`.
The native reference instead succeeds with `a,b\n1.0,2.0\n`, empty stderr,
status 0. Mode 4 `"a","b"\n1,\n` similarly retains only the product header
before blocking, while native succeeds with `a,b\n1.0,\n`. Mode 5
`"a","b"\nx,\n` retains the product header before blocking, while native
succeeds with `a,b\nx,\n`. These comparisons are explicit failures of complete
mode compatibility, not passes. No file/database effects are requested by these
stdin/stdout cases.

Development-only cached CPython 3.14.2/csvkit 2.2.0 probes with StringIO inputs
corroborated all twelve successful string-only command results and the three
native complete typed results above. They did not reauthenticate the full
frozen installed-file hash profile and are source corroboration, not passing
authenticated differential gates. The sealed original csvcut regression is
unchanged; only its skip was removed.

Complete typed-cell operation support still requires retaining numeric/null
types through Runtime.records, typed table rawRows/castValue/inferTable, raw
selectors and headers, csvclean normalization/merging/errors, csvgrep predicates,
csvstack dictionaries and streaming JSON/GeoJSON. Float serialization must use
Python float text (`1.0`, precise rounding, signed zero and scientific thresholds),
not current generic JavaScript `String(number)`. Numeric/null headers must
preserve original validation and diagnostics. These unresolved contracts remain
blockers; this change does not claim complete modes 2/4/5 support.

Final uncached maintained domain checks succeeded: `npm test
--workspace=@poe-code/csvkit` passed 98 files and 4,395 tests, with no skipped
tests and five explicit TODOs; `npm run lint --workspace=@poe-code/csvkit`
passed ESLint and both source/test TypeScript checks. Five TODOs remain blockers,
not passes. Root owns the sequential build and actual safe-bash integration/
terminal screenshot verification after these runtime changes.
