# Static preparation history

No harness functions, deferred controls or product code were executed.

One static Git data lookup incorrectly assumed FS-05 shared CMD-22's capture
directory. `git show` exited 128 for the nonexistent historical path ending in
`run-2026-08-28T10-19-29.600Z-b6244431-0a29-4dcb-b399-2579eab26b61/FS-05--whole/receipt.json`.
That attempt had already written the new adaptation metadata and diff; those
artifacts were not overwritten or changed by the corrected lookup.

Enumerating the same immutable Git tree located the actual FS-05 receipt under
`run-2026-08-28T10-22-03.879Z-e11933d3-f115-43a8-803c-2449a3820e8f/FS-05--whole/`.
`HISTORICAL-BINDINGS.json` records that exact source. This was a corrected data
address, not a fixture mutation, runtime retry, control result or product fix.

The first specification check exited 1 after static data/hash and four syntax
checks completed. Its exact diagnostic was:

```text
ERROR: missing required section: Test and Validation Matrix
FAILED: 1 error(s), 0 warning(s)
```

The heading `Static Audit and Future Validation Matrix` was changed to the
checker's required `Test and Validation Matrix`. No normative content, predicate
or control was changed. The first attempt did not write `STATIC-CHECKS.json`.
The subsequent specification result is recorded there separately. Neither
attempt imported or invoked an authored module or proposed test.
