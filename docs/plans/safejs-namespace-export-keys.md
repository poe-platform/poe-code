# Namespace export-name enumeration experiment

The original namespace graph profile identifies module-namespace ownKeys work
inside repeated data measurement. The current proxy enumerates and sorts export
names for every ownKeys call. Export properties are non-configurable and the
target is non-extensible after construction, so their names cannot change.
Symbol properties are different: a construction callback can add a configurable
symbol that is deleted later. Do not cache the full key list.

TDD session 10535 reproduced two repeated name enumerations. Its construction
and symbol-deletion control passed. The candidate caches only the sorted string
names after construction is complete, keeps symbol enumeration live, and uses
the existing dynamic path while construction callbacks execute. Returned key
arrays remain independent. Session 89322 passed all 21 tests across the new
regressions and existing namespace-exotics cases.

Four-run original-graph measurements use current main source, including its
pending weak-reference integration, not the isolated full-suite candidate.
Every run checks all expected result fields and host calls; the 100,000-step
budget is unchanged. These are source-process observations, not Vitest or CI
qualification. CPU milliseconds, in order:

- Baseline 24730: 1296.275, 1217.752, 1235.015, 965.101.
- Candidate 39561: 1254.694, 1110.578, 1003.369, 962.780.

Baseline wall time varied from 1526 to 3976 ms; candidate wall time from 1051
to 1362 ms. This large scheduling variation is not an optimization claim.
The owned three-line runtime change is temporarily removed for an interleaved
baseline (69807); no unrelated changes were reverted. The new regression test
is expected to fail while the baseline is restored. Decide whether to keep the
candidate only after comparison, broader namespace/accounting/replay tests,
lint and type/build validation. No push or release is authorized.

Interleaved baseline 69807 preserved every assertion; CPU milliseconds were
1389.419, 1144.563, 1096.483, 1024.727. The candidate is restored for a second
four-run measurement (70297), before broader verification.

Second candidate 70297 preserved all assertions; CPU milliseconds were
1483.393, 1227.015, 1130.408, 1087.531. Every sample was slower than the
corresponding interleaved baseline. The first candidate's lower measurements
are not a reproducible benefit. Reject the experiment: the owned runtime
change and new two-case experimental test file are removed. No existing tests
or user changes were removed. The runtime matches its original version again;
no full gate, lint/build gate, commit or delivery of this optimization is claimed.
The controls covered lexical export ordering, independent returned arrays,
construction-time key visibility, configurable/permanent symbol deletion and
rejected new keys on the completed non-extensible namespace. Preserve those
requirements if future evidence justifies revisiting export-name enumeration.
