# Unified76 author handoff — no full launch

This is a new, externally versioned driver proposal. It does not amend or rescore
8670, its unqualified whole run, its separate package cohorts, or the seven
unexecuted bindings in the earlier infrastructure review. Root release and the
separate public74/75/76 and driver reviews remain required. Capture timestamps use
actual UTC; `20260827` in this directory is the established cohort identifier.

## Product and fixture identity

- Root-selected base: `44f00bf84278e3361b52106478d59c707ab7b2bc`.
- Four-fixture source: `925bbd9c172866e580c7d4ff6ac2891664deef98`.
- Assembled product: `07047e8f7bd577f60350246b1380732712305f58`.
- Tree: `f2b9afdbaafee930e188fa4d216e6779a2fbed75`.
- Unchanged source tree: `5876c6bf4ad9bc07f22cc46f8dbee99461981862`.
- Rebuilt tarball SHA256:
  `c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`.

`CANDIDATE.json` contains the exact raw commit body, its SHA256, sole parent,
four reachable fixture blobs and literal before/after transformations.
`RECONSTRUCTION-v1.json` preserves the first two fresh object-database proofs.
`reconstruct.mjs` additionally authenticates each imported fixture body. The
minimal reconstruction pack contains tree skeletons and four fixture blobs, not
the entire product. The separately reachable full base supplies all other bodies.
No branch or new reference is required. If the synthetic object has been pruned,
run `node …/unified76-driver/restore.mjs --restore-exact-objects` from a checkout
containing the recorded reachable base and fixture source. It writes exact Git
objects and an isolated temporary index, never the shared index or a new ref.

The product excludes later `373437cf` helper work, `which`, and moving checkout
changes. All four selected fixture paths and all other product inputs are bound
to the fixed tree, not copied from live working files.

## Bounded fixture result and unresolved migration

Four separate original file runs total **58 pass / 10 fail / 0 skip**. The same
four revised files total **67 pass / 1 fail / 0 skip**. The revised stream-five
consumer was a separate follow-up after the first script stopped at inspection;
the failed initial report remains preserved. This is not a whole-product score.

| File | Original | Exact authorized delta |
| --- | --- | --- |
| `tests/commands/split/integration.test.ts` | 6/7 | 7/7 |
| `tests/commands/stream-format-author-stress/contracts.test.ts` | 18/19 | 19/19 |
| `tests/integration/stream-inspection-public-author/public.test.ts` | 19/21 | 20/21 |
| `tests/plugins/stream-five-public/consumer.mjs` | 15/21 | 21/21 |

The last file is an explicitly maintained runtime consumer, not a default
`.test.ts` discovery file. No claim of four new canonical discoveries is made.

**Root decision still needed:** the inspection file's first case contains two
additional `73` assertions at lines31–32 and an exact trailing-name array at
line34. The authorized proposal changed only its two custom-registry `74→77`
assertions. Actual replay fails at line31 (`76 !== 73`). The next two assertions
are not reached. A precise further fixture proposal is: change both default
counts to76, append `html-to-markdown`, `du`, `expr` to that literal trailing
array, and update the case's descriptive title. Keep the four inspection names,
slice offsets, all inputs, outputs, limits and runtime assertions unchanged.
**Those additional changes have not been made.** The current candidate remains
reviewable but retains this one measured stale fixture failure.

## Profile and closure

`PROFILE.json.gz.base64` is a compact manifest, not a source archive.
`PROFILE-RECEIPT.json` authenticates its compressed and decoded bytes. The profile
binds632 canonical paths,192 individually classified `.mts` paths,256 cleanup
inputs,249 source files, and49 existing native assets plus explicit expr/du
profiles. `cleanup` inside the profile is the actual070 revision/tree envelope;
the launcher writes that exact object to a new external file and supplies both
required cleanup environment variables. No220/244 envelope or mutable HEAD is
reused. `CLEANUP.json` is its readable evidence copy.

### Current-consumer hash qualification (F01)

Dirac's first static validation remains exit1:191/192 inventory SHA fields match
selected bodies, not192/192. The differing path is the **current**
`tests/fs/webdav/consumer/provider.mts`. Inventory `288d17dc…` describes its old
6,603-byte body; `456a0738` changed it to the10,948-byte timestamp-retaining helper.
Both selected44 and070 contain Git blob
`21f5fe464f028b4e056d2aae40b26612f560bd95`, SHA256
`af9ffdb0f991696818512c5f50dab94fdb76387d3b66a2abca80fb799d6d30b6`.

This is not a historical-capture classification. The selected
`inventory-check.mjs:15` intentionally enforces the inventory SHA field only for
non-current entries; this rule already exists at02704bd1. Current membership and
compile/runtime routing remain mandatory. The selected Git/archive body is the
runtime authority. `MTS-AUTHORITY.json` records all192 actual body hashes alongside
their inventory fields and the provider's lineage. It does not change the
candidate, consumer, inventory, driver or old failing validator. Minimal proposed
review qualification: retain F01 as stale informational metadata, use the actual
candidate body hash for current entries, and retain every non-current frozen hash
check and current route. The driver's existing Git-blob/archive binding already
requires the new provider body. No fifth fixture change is requested or made.

For runtime, the closure is conservatively **all37,397 committed entries,
2,382,440,287 bytes**, plus isolated ancestor Git objects, authenticated native
assets, copied cached dependencies and an actual current SafeJS regular-file copy.
This is intentionally not presented as a proved compact runtime selection.
Typing-only selection cannot establish historical audit/helper/data closure.
Execution streams Git archive→tar and Git pack→index-pack directly into owned
temporary storage; it does not create or buffer a multi-GB archive. File/tree
authentication also streams64KiB chunks. Temporary disk/history cost remains;
root/reviewer should accept that explicit cost before release. No product or
source payload archive is committed in this handoff.

Native identity uses the recovered rg hash `4298efd4…`, not the changed installed
same-version asset. The readable native observation is in author evidence.
All51 were authenticated by hash/mode; this task did not execute their full
behavioral suites. Node24.11.1 is the explicit external gate profile, not a latest
claim or a product engine-minimum change. Node22.22.2 still receives78 from this
guarded launcher; ordinary library Node22 support is a separate boundary.

## Driver boundaries and ordering

`run.mjs` requires exact product, profile and driver seals. `--inspect` performs
admission only. `--execute` additionally requires a root release receipt matching
the `requireRelease` schema and explicit `--committed-archive`. There is no release
receipt in this handoff. It is a trusted coordination receipt, not a cryptographic
attestation of root identity. Earlier strict-live drivers remain unchanged.

1. Exact tree/native/runtime admission, fresh archive authentication, isolated
   history and cached dependency staging; native prerequisites precede suites.
2. Actual copied SafeJS availability; pinned guarded TS/CJS and direct/PATH child
   probe; real permission positive and exact source-read denial. No unknown-flag
   exit is accepted as denial. Prerequisite failures refuse before suites.
3. Plain cold typing78, then `typecheck:all` with one source/type build; benchmark
   typing and exact env-source load probe. Cold78 is neither type pass nor failure.
4. All632 explicit canonical paths, `--test-reporter=tap` and concurrency2 before
   positional files. Existing regex budgets and test assertions are unchanged.
   Raw TAP accounting, missing resolved canonical paths and failures are retained.
5. Unchanged fixed-candidate current-consumer runner:23 strict groups,20 runtime
   groups and3 negatives. It performs its **own separately reported cold build**;
   this is not a claim of one build across the entire release workflow.
6. Exact tarball identity; moved-package literal76-name/root/subpath workflows,
   strict and negative public types, missing-root/contracts fallback controls,
   and final immutable package/source/tool/private-state sweeps.

The current-consumer runner's own explicit environments do not universally
inherit the outer import hook; its existing resolution bindings and permission
fences remain mandatory. The public smoke uses a read-only moved-package fence,
not an impossible outside-consumer preload allowance. Outer source resolution
logs are not claimed to be a complete worker-thread trace. An availability probe
is not broad SafeJS acceptance; no private checkout is modified or executed.

The new streamed inventory rejects added/removed/changed files, empty directories,
types, modes and links. Build transition accepts only newly generated `dist`
entries, then freezes the whole staged tree. It cannot certify absence of an
identical-byte write or a transient mutation restored between checks. Historical
writer repairs and canonical no-capture policy remain distinct evidence. A guard
failure stops subsequent phases and preserves raw results; it is not a product
failure waiver. Temporary captures are retained, and phase supervisors record
natural/forced cleanup rather than silently discarding failures.

## Author controls, not independent acceptance

- Source-stable infrastructure controls: final report in `AUTHOR-EVIDENCE.json`.
- Streamed archive/inventory/setup-transition controls:13/13.
- Moved full-package/strict-negative/fallback/loader controls:7/7.
- Earlier package control6/7 is retained: an author `/var` versus `/private`
  permission-path harness error, fixed by physical-root canonicalization. No
  permission flag or expected product output was relaxed.
- Actual packed bytes match the original c109 tarball. No full source type/test
  or service gate ran in this task. No private SafeJS copy was needed for these
  bounded author controls.

Root relayed separate TAP fixture acceptance `c812e818` for `e422ad06`: actual
Node22/24 targeted controls, original7/8 retained. That acceptance does not
execute this new unified driver. Dirac's disjoint review and public74/75/76/root
release are still required. No overall release or superiority claim is made.
