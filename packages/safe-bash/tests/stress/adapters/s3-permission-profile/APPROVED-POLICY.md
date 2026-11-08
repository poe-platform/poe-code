# Approved expectation delta

Contract `5076b32` explicitly permits the S3 profile characterized in `d0948bb`.
This revision intentionally changes only the S3 branch of the active generic
metadata row: mode0600 creation succeeds with exact bytes/advisory stat metadata;
regular-file X_OK fails EACCES; mode0000 directory traversal succeeds. Chmod
remains typed ENOTSUP. Other adapters' expectations and timestamp checks remain.
This is not a product source fix, POSIX permission enforcement, or a privacy claim.

`revised-policy.test.ts` separately accepts the approved profile and preserves
invalid-mode, exact-byte, exclusive-creation, missing-path, read-only, provider
denial and cancellation assertions. Existing backend race tests and independent
policy86 remain unchanged and are validated with the authority checkpoint.

The complete old generic fixture is frozen in
`unchanged-core-fixture.source.txt` (SHA256
`230ddbe6aaa62c0ead5ed186087540d360ce9c7b103b174782e4de27f6b21326`).
`REPORT.md`, `01-observed`, `02-characterized` and their seals remain immutable:
their RED statements describe their historical runs before the ruling, not the
current approved expectation. Historical 98/99 is neither erased nor rewritten.

Modes 0000/0600 remain advisory and readable by an authorized provider client.
Best-effort R_OK/W_OK does not prove later GET/PUT authorization. The established
unsupported-chmod/pre-abort observation remains separate from supported-operation
cancellation; this test delta does not alter unsupported-operation precedence.
