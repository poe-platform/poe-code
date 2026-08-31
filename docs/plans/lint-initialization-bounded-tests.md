# Bounded lint initialization tests

- Scope: `scripts/lint-eslint.test.ts` and `scripts/lint-input-guard.mjs`.
- Release 33415613420 timed out while exhausting eight million real metadata
  operations and traversing 16,384 deeply nested fixture entries.
- Forward the guard's existing lower-only limits through configuration
  initialization; retain the eight-million default and maximum without CLI changes.
- Exercise real inventory-phase exhaustion at 10,000 operations, retaining exact
  diagnostics, 50 receipt checks, balanced descriptors and fresh-context recovery.
- Retain 19 directory levels and mixed branches with 64 memfs entries; assert
  exactly 9 linted, 65 unconfigured and 15,131 metadata operations. This is a bounded
  unit regression, not a claim to rerun the historical 16,384-entry scale scenario.
- RED: initialization ignored a one-operation limit and resolved instead of
  rejecting. The new regression also rejects limits above the unchanged maximum.
- Remove the two extended timeouts; use the configured default without skips.
- GREEN: the complete `scripts/lint-eslint.test.ts` suite passes 249/249 with zero
  skips, 3.40 seconds of tests and 4.13 seconds total on Node 22.
