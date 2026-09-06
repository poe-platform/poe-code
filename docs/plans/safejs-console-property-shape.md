# Consistent console function property shape

Journal-backed console functions expose an empty frozen property record, while
non-journaled console functions previously had no property record. This mismatch
was reproduced during independent restoration of closures captured by `run()`.

Give non-journaled `console.log` and `console.error` the same empty, frozen property
record. Preserve their existing call implementations, sinks and read-only status.
Verify descriptor equality and non-extensibility across both creation paths,
existing console behavior, realm console overrides and retained-value accounting.

This atomic change does not deliver the larger in-progress guest snapshot format
or claim full closure/generator restoration support.
