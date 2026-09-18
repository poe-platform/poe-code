# wkhtmltopdf byte-stream boundary increment

Task `behavior-wkhtmltopdf` remains open. This increment changes resource chunk
admission only; it supplies neither a renderer nor Safe Bash integration.

## Reproduced failures and accepted controls

Three new tests failed against the incoming source before implementation:

- A foreign-realm two-byte subview was rejected by `instanceof Uint8Array`.
- A genuine array with shadowed `byteLength: 0` bypassed decoded admission.
- A proxy around a genuine array produced a raw accessor error rather than the
  resource boundary's `INVALID_VALUE` diagnostic.

Intrinsic typed-array tag and byte-length access now admit authentic views across
realms. Intrinsic copying ignores producer-owned iteration and copies only the
admitted view bytes. Tests also reject forged tags, clamped arrays and data views,
assert exactly-once lease cleanup, verify no decoded/retained allocation on
invalid chunks, exercise a one-byte negative budget and two-byte positive budget,
and verify producer mutation cannot change returned bytes. Existing Buffer reuse,
cancellation, acquisition denial and cleanup-failure controls remain in the suite.

## Manual QA

Executed with memory streams and mocked VFS capabilities:

1. Run the maintained private workspace unit route. Original result: 49 passes,
   three failures, no skips. Candidate result: 52 passes, no failures or skips.
2. Run the selected workspace build route. Passed; one workspace built.
3. Run the workspace lint route, including source and test typechecking. Passed.
4. Confirm package remains private with no external runtime dependencies and
   preserve incoming edits. No CLI appearance changed; screenshots are inapplicable.

Commands: `npm run test:unit --workspace=safe-bash-command-wkhtmltopdf`,
`npm run build:workspaces -- --workspace=safe-bash-command-wkhtmltopdf`,
`npm run lint --workspace=safe-bash-command-wkhtmltopdf`.

## Open acceptance cells

The existing resource matrix and all 122 switch dispositions remain in force.
Actual identity-aware VFS providers, authorized network transport, supplied-font
decoding/shaping, first-party HTML5/CSS/box/image/paged rendering and PDF writing
are unverified or absent. Ordered document geometry, anchors, bounded TOC
convergence, output-byte accounting/staging, CLI/SDK parity, canonical shared
command contracts and isolated packed Safe Bash consumers remain open.
Original/checkpoint/replay runtime cells and patched-Qt variants were not run.
No compatibility, full-repository gate, command completion, release or publication
is claimed. No ambient files, executables, network or fonts were used.
