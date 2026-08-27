# Independent release-inventory review — August 27, 2026

## Decision

**Accept the original20 classifications and preserved input/provenance bytes.**
**Do not accept the claimed current runtime coverage as complete:** one
self-contained consumer is incorrectly grouped as service-only, and removing a
declared canonical runtime can silently pass the consumer runner. These are
release-harness coverage findings, not reproduced FS/product defects. No product,
configuration, author fixture, root export or private repository was changed.

Reviewed configuration02704bd/847dfd7; exact frozen executable candidate
`847dfd766eddbc8f0438f5f999f27ba6a20b8ca7`. Author evidence4b4b4d5c is distinct
from this independent replay. Current source-owner changes are not included.

## Every original input and census

`evidence/audit.json` independently enumerates all20 original paths, compares
their raw hashes with the preserved6ffe4f4 observation, checks literal expected
classifications, and binds each frozen source/package/archive identity to its
hashed evidence. All12 frozen inputs also have their own input hash present in
the authenticated evidence. All declared source commits exist. No original
input changed, including the first WebDAV example's old TS7006 failures.

- Six current inputs: public/leaf positive time-env fixtures plus four WebDAV
  atomic consumer/example/HTTPS inputs. All are strictly compiled.
- Two negative fixtures: paired public/leaf positives pass first, followed by
  exactly2+5 diagnostics, including source positions/message continuation. No
  arbitrary nonzero compiler exit counts as acceptance.
- Twelve historical inputs: three preintegration65/absent-export time-env
  captures and nine first/second/final provider captures. Their source/package
  and unchanged evidence remain authenticated, not rerun as current passes.
- One later canonical `independent.test.mts` is current and actually executes
  **20 controls plus3 mutant kills**, not23 successful server operations.

The exact tracked census is177:29 current,2 negative,4 declaration,141 frozen
evidence,1 frozen oracle. Scanning all tracked paths finds no omitted existing
.mts at this freeze. The retained independent-stream-five prefix exclusion
currently contains **zero .mts**, but a synthetic new .test.mts there disappears
before the census guard; new paths outside that prefix correctly fail closed.

The twelve frozen routes are substantively justified by their original inputs,
not merely their names. In particular the frozen missing-time-env-export input
cannot be treated as a current negative after deliberate public integration.

## Independent unchanged qualified replay

The exact author command returned0 with authenticated existing GNU9.7/Darwin
coreutils and GNU tar1.35, no installs or external services. It ran from
2026-08-27T10:16:04.233Z to10:16:54.868Z. `evidence/qualified.json` preserves
full source/test/harness/tooling manifests, prerequisite identities, commands,
raw output/status and source/dist/index preservation results.

| Phase | Independent observation |
|---|---|
| Current consumers |17 strict groups,29 unique inputs;15 emitted programs|
| Original WebDAV loopback |13/13, unchanged assertions|
| Canonical timestamp .test.mts |20 controls+3 killed mutants, zero skips|
| S3 constructor |6/6, not actual service behavior|
| Intentional negative types |exact2+5 diagnostics; paired positives pass|
| Metadata/table |318/318 and22/22 native rows|
| Archive |11/11|
| Current stream |18/18;124/164 strict,164 strengthened-profile outcomes|
| Current registry |34/34,68 defaults|
| Moved packed program |21/21; positive/negative types and source-denial controls|

There are no skipped/cancelled/TODO node:test cases in these phases. The two
packs match SHA256 `025357bc0528c25a140f04db3bdc1559bd8b61ee6e342df3cd9577831c31bd5f`.
Source-tree hash is `d5aeebc0082000e490323d71b624621a168e78ce5b7fcb58df8cc15a684cfeec`;
harness hash is `afc26febbe6fa0f18e276e9e9d1092d64aaeef78804417b6b6e7a004fd81c5be`.
Build and public declarations pass with Node-only ES2023, strict/noUnchecked/
exactOptional and skipLibCheck:false. Compiler input checks exclude source/shared
build fallback. This is not whole-product npm test, universal native parity,
deployed-server certification, or the current moving worktree's acceptance.

## Concrete routing findings

### R1: service-free atomic consumer omitted

`tests/fs/webdav/atomic-extension-independent/consumer.mts` uses an injected
in-memory fetch and binding. It needs no external service, certificate or host
backing directory. The configured webdav-atomic group nevertheless has no
runtime entries and calls every companion service-only.

The **unchanged compiled program passes independently** when its existing
consumer identity package.json requirement is supplied beside emitted code.
It checks root/subpath identity, configured strong empty removal, absence of
snapshot/atomic-rename inflation, stock ENOTSUP, namespace state and module
resolution. The injected remove hook is called once; all three observed HTTP
method calls are PROPFIND against the injected fetch, not network traffic.
See `evidence/runtime/self-contained-atomic-consumer.json`. The real TLS author
consumer/example should remain explicitly service-qualified, not automatically
run or counted as service passes.

### R2: canonical runtime removal is not guarded

The unchanged checked-in configuration really runs the23 timestamp assertions.
For a hidden negative experiment, the exact currentConsumers implementation is
bounded to that one group, with a throwing top-level sentinel inserted only in
an owned regular-file scratch fixture. All other positive/negative groups are
already exercised by the unchanged17-group replay; the experiment is not a
full release run and never masquerades as an unchanged candidate.

- Runtime declared: strict compilation passes; execution observes the sentinel
  and qualification rejects.
- Same fixture, only runtime list empty: strict compilation passes, zero tests
  execute, and currentConsumers returns successfully despite nodeTests:23.

Exact outputs are `evidence/runtime/declared-runtime.json` and
`evidence/runtime/omitted-runtime.json`. Runtime inputs were changed only in
process memory; product source/config/author fixture bytes stayed untouched.
The inventory guard sees the same file list and cannot detect this omission.

### Other guard limits, not invented current failures

Independent audit mutations: **23 rejected,4 survive**. The surviving cases are:
coupled current→frozen relabel plus route/count removal; an invented claimed
freeze source/package identity with unchanged evidence; a new path beneath the
existing excluded prefix; and the canonical runtime-list omission above.
The actual20 routes have correct provenance, so these survivors do not prove
that today's12 historical classifications conceal failures. Metadata authoring
is trusted code/config, not a hostile-host sandbox; nevertheless the current
guards do not justify a broad claim that misclassification cannot pass.

## Minimal follow-up for root/release owner

1. Give the self-contained atomic independent consumer its own emitted runtime
   route and original consumer identity setup. Keep actual TLS inputs separate.
2. Validate required .test.mts/runtime and nodeTests declarations before work;
   an empty runtime must not turn a mandatory executable into compile-only.
3. Replace the broad census-prefix escape with exact authenticated historical
   exclusions if any are required (none of its current files are .mts).
4. Keep classification/provenance changes separately reviewed. Optional stronger
   freeze metadata validation should bind claims to designated evidence fields,
   not merely accept a40-character token. Do not relabel all unknowns as frozen.

This review does not implement those changes or self-approve a future fix.
Tree/file integration can use the separately accepted source handoff, but the
whole-product candidate must be coordinated with root after its wiring and the
latest byte-ownership/rmdir fixes. Olde36 full-gate counts remain historical.

## Reproduction, harness corrections and cleanup

`node tests/integration/qualified-current-release-inventory-independent/audit.mjs`
reads the exact847dfd7 Git objects, imports regular-file copies of the three
frozen guards, independently checks20 routes and executes the27 bounded mutations.
It does not import the later moving release configuration. No private source.

The unchanged qualified command is the author's README command pinned847dfd7;
its runner bytes must match that revision. `runtime-review.mjs` accepts the
retained exact qualified run directory and a new output directory, then uses
its emitted package and frozen implementation for the two bounded experiments.
On rerun use a fresh exact-revision run/snapshot, not changed live runner bytes.

Two own harness corrections are retained: the initial extra assertion wrongly
expected final method count1 (the original fixture asserts1 before its later
stock-refusal probe; final read-only observations are3). The second attempt
used Darwin's noncanonical temporary path and failed the existing strict type
resolution check; realpath canonicalization restores the intended isolation.
Neither is a product/config fix or an altered original oracle. Failure reports
are in `evidence/runtime-attempts.json`.

All scratch mutation source/tool trees and the exact owned qualified directory
are removed after evidence capture. Source/config inputs, root dist and foreign
staging are preserved; no active owned children or servers remain. No whole
gate has been run while root's candidate cohort is still being coordinated.
