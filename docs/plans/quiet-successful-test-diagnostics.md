# Quiet successful test diagnostics

## Problem and change

The concise Node reporter buffered passing stdout and stderr but printed every
file-attributed diagnostic, including large successful source and fixture dumps.
Buffer diagnostics through the same path. Retain the original ordered diagnostics
for failing and unfinished files, and retain unattributed warnings, global
summaries, and periodic progress immediately.

## Validation

Three new regressions fail before the change. All 12 reporter tests pass after
the change. A real Node passing memory-adapter test confirms file attribution;
real failure and late-async-warning probes preserve error details. No changes to
selection, concurrency, pass/skip counts, or production behavior.
