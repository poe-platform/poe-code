# Deferred handoff interface

Preparation is not authorization. **Do not run `recipe/execute.mjs` against any
current source/dist/HEAD.** Its entry fence rejects absent authorization before
candidate imports or evidence creation. These paths and hashes must come from
the future root-routed accepted candidate, never inferred from a dirty tree.

The later host invocation takes four explicit arguments:

```text
node recipe/execute.mjs AUTHORIZATION.json TRUSTED_AUTHORIZATION_SHA256 RECIPE-SEAL.json TRUSTED_SEAL_SHA256
```

Root must supply the trusted SHA-256 values out of band. The command is shown
for interface documentation, not permission to execute now. Run the host using
the exact authorized Node executable. No build or typecheck is hidden inside
this command. Candidate source and compiled output must already be materialized
in separate canonical regular directory trees with no symlinks. The recipe
requires POSIX process groups and hashes the executable too.

Receipts use exactly the child emitter's canonical `JSON.stringify` bytes plus
one LF; duplicate JSON keys, extra whitespace/lines and malformed/missing fields
refuse. Raw bytes are retained even on receipt rejection. Diagnostic assertions
validate category/code framing, literal source and coordinate grammar rather
than accepting arbitrary text after a matching diagnostic code.

## Authorization fields

`schemaVersion: 1`, `purpose: "YQ_CANDIDATE_EXECUTION_EXPLICIT_HANDOFF"`,
`rootApproval` (nonempty root handoff reference), `candidateCommit` (full Git
SHA), `baselineCommit: "5137a74ec855a32d8a8860eb66b62eb44d11e290"`,
`acceptedLengthCommit: "74361026502d76b8c2b696f9c60e410ac9b78d95"`,
`contractCommit: "bd471ef682d768692a682d40009a874f51e3ad68"`, and
`independentReviewCommit: "de89e478d8ddce62eac955708f1b87d7be1bd137"`.

- `recipe: { root, sealSha256, treeSha256 }`: canonical path to this exact
  `recipe/` directory and the separately sealed recipe hashes. No live fallback.
- `source: { root, treeSha256, provenance: { path, sha256 } }`: immutable
  materialized source and root-accepted composition receipt. Receipt fields are
  `candidateCommit`, `baselineCommit`, `acceptedLengthCommit`,
  `sourceTreeSha256`, `compiledTreeSha256`, `rootAcceptedComposition: true`,
  `buildReceiptSha256`, `newPaths`. New paths may only be new files below
  `src/commands/yq/` or `src/commands/structured/query-core.ts`. This checks
  binding to a trusted source/build attestation; it does **not** independently
  reperform MOV-01/03's Git diff or prove compilation matches source. The root
  must accept that attestation separately. A hash alone is not source proof.
- `compiled: { root, treeSha256, entry: { path, sha256, exportName:
  "createYqCommand", proofRole:
  "direct-compiled-factory-handler-not-public-package" } }`: relative compiled
  `.js`/`.mjs` entry only. This calls the declared factory and `execute(context)`,
  never a private adapter. The module-resolution fence requires every file
  import to remain within this compiled tree. Only the declared path/util/
  buffer/stream Node builtins are currently admitted. A different necessary
  builtin is an explicit recipe gap, not runtime discovery or silent fallback.
- `node: { path, sha256, mode }`: exact executable, SHA-256 and POSIX mode bits.
- `frozenRepository`: explicit canonical location of the unchanged frozen data
  referenced in `source-bindings.json`. These selected scopes are also guarded
  for complete membership, file hashes and modes, including added entries.
- `selection: { ids, jobsSha256 }`: nonempty, unique prepared original IDs.
  `materializeJobs(loadData(recipeRoot, frozenRepository), ids)` gives data-only
  jobs; `jsonHash(jobs)` binds every variant and current expected-data overlay.
  Selecting a missing adapter is an error, never an unsupported-as-pass skip.
- `bounds: { deadlineMs, termGraceMs, reapMs, captureBytes, maximumJobs }`:
  bounded integer ranges are enforced in `host.mjs`. Command byte capture is
  separately capped at 2 MiB and events at 20,000. For this prepared selection,
  allow enough child capture bytes for the hex-expanded raw envelope; overflow
  fails explicitly. These are harness resource limits, not YQ public limits.
- `evidenceParent`: existing canonical directory outside every guarded root and
  input file. The host creates unique no-overwrite evidence beneath it.

Authorization, recipe-seal and provenance files currently require mode 0644.
Do not place credentials in these files or environment. Source/build provenance
is trusted host input. The import fence and no-network fixture context are not
a JavaScript security sandbox or proof against a malicious host program using
ambient globals, transient modify-and-restore, or escaped process descendants.

## Proof selection and pending binding

The inventory contains 194 IDs with eight referenced overlays, not 194 runtime
jobs. Primary roles: semantic 111; admission/error 34; source/static 23;
lifecycle 11; materialized/package/infrastructure 4; type 5; negative controls 6.
All 194 have a secondary fixture-data role, not another denominator.

Prepared byte/context projections cover 132 IDs, including all 111 semantic
IDs. Seventeen semantic records retain private/source assertions; 94 semantic
IDs are eligible for their complete **explicit frozen per-record projection**
only after every selected fragmentation variant passes. No individual command
run proves the inherited global CARRY/guard, ownership, private source or full
contract obligations. Eighty records have explicit missing bindings; 62 have
no prepared runtime job and 18 have only a partial projection. No count is a
product pass count; product executions and semantic passes remain zero.

In particular ENC-08/09/10, QUE-09/10/11, private WRK counters and WRK-22/26
must retain source/designated-counterproof roles. The fixed P1 mechanism is not
public DI. No private hook is invented to turn them into executable commands.
FS-02/03/04 require authentic typed FsError bindings; FS-06 needs explicitly
configured real adapter/provider evidence. Lifecycle race/Shell/dispose and
plugin registration jobs require their own exact host/consumer adapters.

Public export, strict type, moved package, full README and package-guard proof
are owned by the parallel consumer packet. **No consumer code is imported or
bound here yet.** Root must route its sealed interface before a later bounded
integration recipe. A direct compiled factory receipt is not that proof.
