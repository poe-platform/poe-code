# Independent repaired-body DATA recipe, frozen before execution

August 28, 2026. Assigned independent repair leaf; only additive files here.
The eight original files in preparation commit
7d7e322b7e11fdc2ded4b5a4708da2e0aedad65b are immutable. All 206 expected outcomes
remain unchanged. The author repair is exactly
d8cbb7d76459e14d20f57e19f7c01ce04fa08702, never incidental HEAD.

## Admission and child recipe

1. `freeze-review.mjs` reads development Git metadata for the exact repair and
   preparation commits (four serial children, each 10 seconds). It hashes actual
   live bytes against committed blob OIDs and modes, author seals, original
   preparation seals, historical 31 inputs, actual old captures and tool closure.
   It freezes the concrete runner, reference, launcher and this source review
   into additive `RUNNER-SEAL.json` using apply_patch. No candidate import occurs.
2. Atomically commit those seven new files, including the seal, before launch.
3. Run `node --unhandled-rejections=strict launch-review.mjs COMMIT review-01`
   with the exact new runner preseal commit. Launcher reauthenticates all inputs
   and tools; one 10-second metadata child binds committed runner bytes. Then one
   serial 30-second DATA Node child imports actual `path-bytes.mjs` and
   `capture-io.mjs`, whose static dependencies are supervisor and deadline.
   Controller, data-controls, freeze-inventory, loader, bootstrap and worker are
   NOT imported. Permission mode grants repository reads and writes only to the
   unique owned synthetic directory, no subprocess/network/worker permission.
4. The DATA child consumes frozen cases, returning one distinct observation per
   case. No fail-fast suppression of later cases. Launcher waits for exact child
   completion, checks all sealed inputs/tools and directory listings again,
   removes only its unique synthetic work, then adds the receipt via apply_patch.
   Evidence is committed separately from runner preseal. No old captures are
   rewritten and no source/plaintext snapshot or actual ROOT-GO is created.

Metadata and DATA execution is bounded to 15 minutes total; each Git child to
10 seconds and the DATA child to 30 seconds. Capture admission is 128 MiB and
working-file admission is 512 MiB. The DATA heap flag is not an RSS cap. Synchronous
child receipts establish exact child retirement on successful completion, not
an invented peak across the surrounding CLI orchestration. apply_patch is serial
artifact tooling after the DATA child closes, not a product command or control.

## Fixed case mapping

- H001-H098: actual `readCapture -> parseTree -> treeHash`, exact independent
  entry identities and every frozen expected subtree; then byte-exact lookup in
  the whole candidate census and actual `verifyProjection`. No path body is read.
- Other raw/profile cases: actual parser and tree encoder; frozen path/mode/OID,
  canonical root and independent directory payload expectations. The local
  reference is the preinspection bottom-up algorithm, not the author's comparator.
  The actual encoder exports hashes, not payload bytes; matching hashes bind its
  encoding, while reference root payload is directly compared with stored bytes.
- C01-C21: fixture packaging only maps recordIndex to named fragment files and
  supplies ordinary successful synthetic receipt lifecycle fields. Exact fragment
  order/bytes/hash/offset/totals remain unchanged. Duplicate references remain
  duplicates; missing records remain missing. C18's unreferenced record is an
  extra file, not silently discarded or an invented receipt-schema property.
- B01-B11: actual OID-only batch parser with original binary bodies and requests.
  B13 tests two distinct inventory path/mode bindings sharing an OID; this does not
  expand the selected-source 100644-only materialization domain.
- D01: authenticate synthetic leaves, then actual derived hash without any Git
  object lookup. D03: actual full capture, all 50002 records, 98 identity census,
  stored commit/tree bodies and direct independent root payload equality.
  D04: actual historical 276-object capture into actual batch parser, all 274
  selected length/SHA256/blob bindings, unchanged manifests, actual projection,
  all base leaves, five overrides and independent 8437/combined reconstruction.
  No product blob bytes are persisted or interpreted as instructions.
- M01 rejects old display inventory as raw input. M02 mutates actual fixture body
  with unchanged receipt digest. M04-M08 call actual source projection with fixed
  wrong mode/OID/missing/duplicate source/duplicate override corruptions.

P28 is dynamically attempted but expected raw-byte acceptance is unsupported by
the explicitly declared strict UTF8 profile: never a pass or changed expectation.
P30 is unreachable nonrecursive metadata, NOT_RUN. B12, D02, M03, M09, M10 and M11
have no safe exported equivalent to their complete controller-level recipe;
they are NOT_RUN/SOURCEONLY, never a copied controller assertion or fake helper
pass. Thus planned dynamic denominator is 199, with seven NOT_RUN controls.
Actual counts and all failures must be reported from the receipt, not predicted.

This runner does not replay the author's claimed 65 DATA controls. Original
25 DATA / 68 NOT_RUN stays historical. Independent 206 prepared controls and
12-source/19-data/21-site preparation are not execution counts. Module-loader,
read-route, package/build, app and future child-seal observations are static.

## Known source qualifications before dynamic work

The repaired path domain is strict UTF8, not arbitrary Git bytes (P28). readCapture
does not enumerate its directory, so C18 is expected to expose a helper-local
extra-file gap; the actual sealed inventory has a separate append guard in
checkHarness. That guard is source-reviewed only. These findings must not be
misrepresented as product failures or unguarded controller acceptance. Any
additional genuine blocker is reported before optional expansion; no optional
generic framework, author suite rerun or product exercise is planned.
