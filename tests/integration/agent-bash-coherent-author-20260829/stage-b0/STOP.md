# B0 preparation locator admission STOP

August 29, 2026. No B0 executable preseal, installation, product import,
semantic call, RegexWorker, loader thread or PUBLIC engine execution occurred.
The39 B0 calls and all larger Stage B roles remain UNRUN.

## Exact failure

`inspect.mjs:9` passes the Stage A-r2 preseal identity (47291 bytes,
SHA2568acc5e35686a4fa20bf1f8a871b2c23edff4cb29b09a9b9f1848ffc1332006db)
to locator `../stage-b/inherited/PRESEAL.json`. That locator's lstat size is8922,
so inherited `read` rejects at its exact-size check BEFORE opening/reading its
contents. Raw stderr is652 bytes; raw stdout is81 bytes. The expected-size
descriptor belongs to Stage A-r2; the chosen inherited locator was the earlier
v4 source/fixture preseal. This is an author locator/identity mismatch, not
evidence that the underlying archive or selected product changed.

Do not replace the expected identity with the observed size/hash. The narrow
next correction is to recover the already-published exact Stage A-r2 preseal
locator from its accepted source receipt and bind that locator separately from
the v4 fixture preseal. Authenticate both role/size/hash before parsing. No
correction or second attempt is performed by this checkpoint.

## Observations and boundaries

- Outer capture files were opened before syntax checking/helper execution.
- New helper syntax check returned successfully; helper then exited1.
- Pinned Node and development Git binary stream-hash checks returned before the
  failure. Scoped NUL Git status and shared-index name census were captured;
  both development Git children returned status0/no signal.
- The preceding Stage A BINDINGS.json admission completed; no producer package
  was inflated/extracted and no retained workflow/helper was imported.
- The two Git metadata children were synchronous with closed capture descriptors.
  No independent PGID/descendant sweep was performed; do not infer one.
- Preserved `capture/inspect.stdout`, `capture/inspect.stderr`, scoped status,
  index census and helper source are the raw source of truth. No old capture,
  retained Stage A root or source/package identity was changed.

Known preparation/admin starts are conservatively bounded below48, peak at most3
for the explicit dispatch chain; this is not a measured all-descendant census.
Publication is separately captured in
`/private/tmp/coherent-stage-b0-stop-publication-20260829-v1.*`.
The namespace contains only small source/capture records, not runtime copies.
No harmless controller fixture was executed and no full B0 packet is claimed.
