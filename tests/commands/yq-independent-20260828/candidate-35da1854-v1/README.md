# 35da1854 candidate data admission

August 28, 2026. **DATA BOUND; ACTUAL ADMISSION BLOCKED; NO PRODUCT EXECUTION.**

The recipe was committed as `7d235c03` before one data-only pass. Its raw preseal
SHA-256 is `96c629f4b48513b3d5b23f647932aac1233ab9b8306c49a2fcc6173c5bfeebc5`.
`PRESEAL.md` fixes the input revisions, allowed operations, serialization recipe,
and deferred independent compiler recipe. No retry or alternate workload ran.

## Authenticated composition

Source `35da18547ca82a67be9ca22b4adc21e3b8060780`, evidence
`ef6032b210feb5cf19e6f6f94c40413740bef335`, and handoff
`bcec1ead34aee37c8fe574b248a8242ad4f60cfa` are bound independently. HANDOFF.md
exists at the handoff commit, not the source/evidence commits. No mutable HEAD
inputs or unrelated feature bytes enter the selected trees.

- 264 baseline/accepted-length guard inputs plus exactly seven new YQ/query-adapter
  files give the exact 271-file source map.
- The full source archive has 273 files: the same map plus baseline
  `package-lock.json` and `scripts/typecheck.mjs`. Six separately selected test-data
  files make the 279-entry author manifest; none of those tests was executed.
- Full package equality checks all 846 accepted baseline entries, including exact
  baseline README, plus 24 emitted additions from six new TypeScript files: 870.
  Counts summarize verified maps; they are not a substitute for composition proof.
- `MAPS.json` contains complete byte/mode maps, entry order/header identities, Git
  source blobs/revisions, directories, README provenance and literal import edges.
  The accepted 194 records/eight overlays remain unchanged and unexecuted.

## Reproduction and copied data

Source USTAR was independently serialized from authenticated Git blobs and matched
`e4e6880a3622952b153a8261fec007908e1495584abf705ba2b150e95badcedc` exactly.
Package USTAR and the single gzip attempt independently serialized authenticated
**author-emitted** files and matched
`2942ba1f6982a2e217350bbbad420e93d43e9336324b6db8a3d1d88b5a7aee4d` exactly.
The package result is **BOUND_AUTHOR_BUILD**, not independent compilation.

Artifacts and regular source/package copies are under:
`/private/tmp/yq-candidate-admission-35da1854-BAdsoU`.
`artifacts/` holds original and independently serialized archive bytes.
`source-archive-273/` holds the complete source archive. Future selected roots are
`source-271-moved/` and `package-870-moved/`; both have separately retained original
copies. Physical staging-directory renames preserve recorded inode/device identity.
`MATERIALIZATION.json` records complete-map before/after hashes, directory modes,
membership and vanished staging paths. Snapshots detect additions at observation
time; they are not transactional or change-and-restore protection. No AGENTS,
symlink, hardlink or nonregular archive entry was copied. These are data movement
facts, not consumer-enrolled import capabilities. Temporary artifacts intentionally
remain available for root; no candidate process remains active.

## Genuine admission blockers

1. Frozen consumers `409449136ae1adc252ff6e205a6bb5785d113d0f` enumerate the whole
   candidate commit. That tree has **301 files**, with **30 extra paths and eight
   changed files** relative to the authorized 271-file composition. Both exact
   source/full receipts pass schema/package-map checks but actually reject with
   `SOURCE_BINDING`. The full delta is preserved in `RESULT.json`. No synthetic
   Git candidate, guard modification, changed candidateCommit, or fallback was used.
2. Frozen runtime `ee9d0c1fd24b33aa918154eb379a92c02cfe5925` excludes
   `node:timers/promises`, which the bound module closure imports. Its other observed
   builtins are `node:path`, `node:stream/web` and `node:util`. No fence change or
   candidate import was attempted.

Root must resolve these interface contradictions before any actual review route.
`SOURCE-RECEIPT.json` and `FULL-RECEIPT.json` are immutable schema-valid **rejected
admission inputs**, not accepted capabilities. `BOUND-AUTHOR-BUILD.json` explicitly
denies independent compilation and root-trusted status. `EXPECTED-HASHES.json`
provides raw hashes for independent root routing; a receipt's own digest is not
authorization. Root must authenticate those hashes from this worker's committed
seal. Do not invoke actual candidate consumers on the strength of this packet.

`RUNTIME-BINDINGS.PENDING.json` binds exact future source/compiled tree hashes,
YQ/contracts `.js` and `.d.ts` entries, source additions and tool pins. It deliberately
sets `rootAcceptedComposition: false` and is not an executor authorization. Root
and package exports remain baseline/absent for YQ; this is direct materialized
module/declaration preparation, not public integration.

## Checks and pending work

The one pass exited zero with **16 bounded synthetic data checks** and two actual
expected source-admission refusals. Pinned consumers seal verification ran before
and after. Both raw Git artifacts and every retained source/package tree were
rechecked after materialization, including newly added entries. Script syntax
checking is not compilation of product TypeScript.

A separate supplemental static audit exited 1 on an overbroad no-wildcards
assertion: baseline `./contracts/*` is legitimate and does not export YQ.
`POSTPASS-AUDIT-FAILURE.md` preserves its exact program and failure. It was not
rerun or counted among the sealed 16 checks; its intended extra artifact was not
written. This packet therefore does not claim every auxiliary check passed.

Product imports/runs, compiler/build, npm, native YAML, author code execution,
private imports and semantic passes are all **zero**. Author 26+19 tests and its
15 controls are not our passes. Original B04 and earlier captures remain intact.
The reported global typecheck remains blocked before build by foreign unclassified
`.mts`; no global check was attempted here.

Independent pinned scoped compilation and declared source-map relocation remain
pending, followed only after root authorization by loaded-code controls, actual
declarations, CARRY/source instrumentation and the bounded different-agent YAML
review. The separately owned 18-family framework review is not claimed here.

Authenticate `verify-seal.mjs` from this commit before running it with the final
seal's independently routed raw SHA-256. It checks this packet only, without
importing product code or treating a successful seal check as candidate admission:

```text
node tests/commands/yq-independent-20260828/candidate-35da1854-v1/verify-seal.mjs ROOT_ROUTED_FINAL_SEAL_SHA256
```
