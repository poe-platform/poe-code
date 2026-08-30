# Direct-curl fixture writer isolation

The canonical `../direct-curl/direct-curl.test.ts` now performs no filesystem
writes. Its vectors and assertions are unchanged. Both normal execution and
failure leave the sealed historical artifacts and ambient finding marker alone.
Parallel runs therefore have no fixture-output paths to collide on.

## Explicit capture, never replay acceptance

From the repository root, run:

```sh
node --unhandled-rejections=strict tests/stress/byte-ownership-20260827/remaining-consumers/writer-isolation/capture.mjs
```

The driver accepts no output arguments. It creates a fresh, private OS-temp
directory, prints its exact path and exit code as JSON, and preserves that directory
for the caller to inspect. It refuses a temp root inside the repository;
realpath resolution prevents a symlink into the repository from bypassing this
check. All output files use exclusive creation. It never writes a supplied path,
reuses an existing capture directory, updates historical pins, or accepts results
as new expected output. Remove only the returned directory when finished.

`VIRTUAL_BASH_DIRECT_CURL_CAPTURE=1` enables structured stdout observations in the
canonical test, not file output. The driver collects these observations separately
from raw TAP/stderr and a manifest. Observations precede byte assertions so a byte
failure remains inspectable, and the driver preserves the failing exit status.
Missing observations, process failures, and source-integrity changes fail capture.
The manifest hashes actual source files, the canonical test, this driver, package
configuration, immutable historical inputs, and the unchanged expected vectors at
both boundaries. It does not falsely reuse the historical source pin as the
current-source identity. Capture is not a historical replay or a full-product gate.

## Focused controls

```sh
node --unhandled-rejections=strict --import tsx --test tests/stress/byte-ownership-20260827/remaining-consumers/writer-isolation/capture.test.ts
```

The three controls use owned disposable source copies: parallel default execution,
successful capture, and a deliberately corrupted replay implementation in the copy
that must still fail its original Buffer assertion. Both capture controls exercise
unsafe-root and output-argument refusals. Child processes use strict unhandled
rejections, bounded output/watchdogs, and clear inherited `NODE_TEST_CONTEXT` so
Node does not suppress nested test execution. Finally blocks remove exact owned
test/capture directories; no product source is changed in the working tree.

## Historical boundary

The original direct-curl report remains **1 pass / 1 failure**. Its `run.mjs`, pins,
vectors, and artifacts remain immutable; that driver is historical, not repinned.
The later isolated **2/2** and gate-mutated bytes remain separate evidence. In the
gate's stored `evidence/focused-v2/artifact-before.json.data` and
`artifact-after.json.data`, the Buffer artifact changes from
`de63affa918da53853a7f8bc9ad1d863802c46c524e74af6b48359826139bc17` to
`ba6e0313257d6cf9a5164eec03ab7b2e23a885b10cbc84f5078c4dace0ccb0fd`.
The authoritative snapshot directory is
`tests/integration/full-gate-20260827/combined-b494675c/`; these stored bytes survive
the gate's temporary-checkout cleanup. New author evidence references and hashes
these blobs rather than rewriting them.

The unqualified gate remains **16,520 pass / 307 fail / 13 skip**. This change fixes
the fixture writer/integrity defect only. Attribution of other gate failures and
independent concurrency/sentinel controls belongs to the sibling verifier.
