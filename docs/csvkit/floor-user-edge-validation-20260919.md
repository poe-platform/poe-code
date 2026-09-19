# SQLite floor user validation, September 19, 2026

Fresh native SQLAlchemy and original `sql2csv` queries validated a current gap:
the injected SQLite provider refused SQLAlchemy's registered `floor` function.
Twelve original in-memory regressions failed before the fix; two wrong-arity
cases already matched native errors. The procedure is
[the floor QA plan](../plans/csvkit-floor-user-edge-qa.md).

The provider now registers deterministic floor with native INTEGER identity,
negative rounding, signed zero and exact signed 64-bit values. NULL, numeric
text and blobs report the native callback OperationalError; infinities and
out-of-range integers report the native DataError and SQLAlchemy error link.
The callback explicitly publishes int64 results because the upstream convenience
converter can publish exactly representable BigInts as REAL. Its runtime supports
void callbacks after explicit result publication; its declaration omits that
return type, requiring a documented local assertion. No subprocess, implicit
filesystem/network, Python fallback or ambient interpreter was added.

[Reduced native evidence](floor-user-edge-reference-20260919.json) records all
thirteen fresh exact stdout/stderr/status comparisons through actual registered
safe-bash Shell commands, their literal original argv queries, injected WASM
hash, interpreter/script hashes, environment and current source/test hashes.
The CPython 3.14.2 binary matches frozen SHA-256
`3d6400b63b150164e89a690d9813af8b0eb420af9f336ef1f6c5102c6da60eae`;
the live reference reports csvkit 2.2.0, SQLAlchemy 2.0.54 and Agate 1.14.2.
This bounded replay does not requalify installed-file manifests or repeat source
archive authentication. The previous installed-file drift and missing frozen
pip remain blockers; version equality does not establish frozen source identity.

The fourteenth in-memory regression inserts an uncommitted row, encounters a
floor callback error, rolls back, then verifies original rows and INTEGER result
types. A genuine native SQLAlchemy connection independently repeats these
effects. The product memfs database exported after closure is byte-identical to
the native database, SHA-256
`7a56de889b497a7d67b44733752c1c902ec6bb933f9677f66a3243763a150c20`.
Independent `/usr/bin/sqlite3` reads the product file: integrity is `ok`, and only
the original committed row remains. The product VFS contains no journal.

The maintained uncached domain route passes **4,425 tests across 103 files**;
five TODOs remain excluded. Domain lint passes. The selected maintained build
closure passes with four declared workspace builds. Final focused floor and
original SQLite tests pass **53/53**. A separate agent's actual safe-bash SQL
provider/lifecycle/stream/binding checks pass **47/47**, with no skips or
cancellations. Earlier lint/build attempts failed on the new callback's upstream
return declaration and a test generator lint rule; those attempts are not passes.
The corrected final routes pass. The existing original native floor differential
is restored to the passing SQLite cohort rather than removed or weakened.

Actual Shell DataError output was captured with the maintained screenshot runner
and opened for visual inspection: diagnostic, query and link remain readable.
No screenshot test was added. An initial evidence-reduction invocation used an
incorrect Node eval mode; it was corrected before reducing the evidence.

[Independent user stress](independent-join-user-validation-20260919.md) adds
416 matching bounded join/sort/stack cases and found no validated discrepancy.
These observations do not establish all-edge-case or full-suite equivalence.
Bzip2/xz and Agate Table remain measured capability gaps; regexp remains refused.
Zstandard/IPython and unsupplied genuine server database services remain
unverified. Frozen installed-file qualification and performance remain blocked;
no repository-wide acceptance or release is claimed. Existing optional-profile
workbook, DBF and compression findings remain in their separate records.

All native inputs, databases, captures and temporary execution aids were owned
files below `out/csvkit-floor-user-edge`; only that scratch was purged after
reduction. Unrelated edits and staging were preserved. No README addition,
commit, push or publication was performed.
