# SQLite failure and command edge QA

1. Reproduce connection admission immediately after disposal, revoked VFS read/lock authority, and commit-time sync denial with failing in-memory tests before changing product code.
2. Preserve named capability denials, close partially initialized connections, and verify rollback and subsequent writes after a failed commit. Qualify only the supplied memfs adapter; make no disk durability claim.
3. Have another agent replay frozen command observations through actual Shell using one-byte reusable stdin buffers and empty chunks, then test revoked SQLite reads through the public provider. Compare exact channels/status, file effects and resource closure.
4. Run maintained uncached domain tests/lint and selected domain/safe-bash workspace build closures. Run focused actual-Shell tests and the maintained integration-input inventory regression.
5. Render and inspect actual Shell SQL result/refusal output in an ad hoc screenshot. Store temporary evidence under out and remove owned artifacts after recording findings under docs/csvkit.
6. Report passes separately from skipped/TODO cases and named parity blockers. Preserve unrelated edits/staging and perform no Git delivery or README additions.
