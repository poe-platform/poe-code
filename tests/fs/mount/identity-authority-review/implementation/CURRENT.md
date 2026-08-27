# Independent implementation checkpoint — August 27, 2026

## Verdict and handoff

**RED: 77/79 on committed source `307938f17db2714db9debc451f935e3134e2660e`.**
Scoped TypeScript exits 0; zero skipped, cancelled or TODO tests. The pinned run
uses explicit strict unhandled-rejection handling. This is the final run for this
leaf checkpoint, not a request to wait for another moving source snapshot.

All three requested source checkpoints are present: Memory `307938f`, S3
`37edad8`, and WebDAV `a0e598b` plus explicit-comparison correction `7bce86a`.
The archive also includes the qualified Memory callback's complete source
dependencies and core `0bee8e7`. The actual core file equals that commit byte for
byte. The older `committed-wrapper-s3-47` capture remains immutable history;
**it is not current proof**. `REPORT.md` and `FINDINGS.md` describe the earlier
checkpoint and discoveries; this document supplies the current verdict without
rewriting those historical reports.

The previously reproduced WebDAV subclass source loss and all new changed-data
operation preservation cases pass. The unchanged S3 genuine-HEAD/Memory-IO
source-loss regression also passes. Two newly discovered errors remain:

| Operand | Late explicit `compareEntry` throws EACCES | Actual comparison | Actual mounted copy |
| --- | --- | --- | --- |
| Memory, qualified S3 peer | Called zero times | `distinct` | Succeeds and overwrites the target |
| S3, qualified Memory peer | Called zero times | `distinct` | Succeeds and overwrites the target |
| WebDAV, qualified Memory peer | Called once per operation | EACCES | EACCES, target unchanged |

These are **explicit authority/error bypasses, not newly observed source loss**:
source bytes survive both failing cases. The inherited registered callback hides
the current public operand method. The tests use mixed unscoped/qualified remote
observations, not complete native tuples that legitimately take precedence.
Source routing is otherwise unchanged. The EACCES failures must not become a
capability skip or a successful comparison. Root must route remediation to the
Memory/S3 owners; if runtime replacement policy is considered ambiguous, resolve
it through the authoritative contract owner rather than inventing a second API.
No production fix or contract edit is made by this leaf.

Exact repro: `adapter-binding.test.ts`, tests ending
`post-construction explicit comparison error is not hidden by cached authority`.
Decoded query counts and before/after bytes are in
`evidence/committed-qualified-79/observations.json`; raw failures are in its TAP.

## Frozen source and test identity

Capture: `evidence/committed-qualified-79`, August 27, 2026,
01:36:33.245 UTC. Source archive SHA256:
`38ac03c57e4bb3f6364c2ba3cd78b07429cef08f99010e4f8b09873cf1033120`.

| Actual source | SHA256 |
| --- | --- |
| `src/commands/filesystem.ts` | `393ea36b78c2cc142633c0eb631bf4d316767b3992c0d5f0724135ca4f01403a` |
| `src/fs/memory/index.ts` | `d1b0a082ece95555f740419b276d5565757fe3c3c3ba1555b927e9640dbcc62d` |
| `src/fs/mount/comparison.ts` | `cedfd2b4a586ddf85eaac30e1ce7797b290b712b744498e84df5036c89f64a2c` |
| `src/fs/s3/filesystem.ts` | `8c98a7738aed477a238084624b4e374d4cdf1575708684d0991869427288a120` |
| `src/fs/s3/authority.ts` | `0e12d26f2882f31cb2f33476c0bd18aed250404f8e3624d67aff1c3e5e7853a4` |
| `src/fs/webdav/webdav.ts` | `3c4c14ecf9f789794d44ea50ca3a1880a859745f7ccf69ee9caeefd96d310f6a` |
| `src/fs/webdav/resource-id.ts` | `869e5f4ea8210f9c088f32906f063a373da2e36392b9a1d95f4f5e2193c2d7fc` |
| Author-owned `tests/fs/webdav/mock.ts` | `e4f8a6806c1dd6f0622cce9f3b487f530011c39b7ca95cc2543002ce4da95266` |

All other source dependencies, tools, test snapshots and raw artifact hashes are
in the manifest. The new adapter test SHA256 is
`f90f1da067ec03ed467aeaa39d50114d9e03a4e13da8fb5548a2f49e1fdac712`;
the new core test SHA256 is
`9ef835a5691f051a8ec93005fc96dc72569c96b609d1e7f233a84e1d7adfb924`.
The existing 47-test inputs were not edited in this extension. Their hashes are
preserved alongside each new run, including the unchanged remote-test hash
`039cce5f0fc93b4e2e96a61448ac104e20aa5aaf767db4c33c53263598cb7660`.

## Independent additions and before/after effects

The final denominator is 20 public/wrapper tests + 27 existing remote/protocol
tests + 27 new adapter-binding tests + five current-core ordering tests.

The 16 changed-writer cases cover Memory and S3, buffered and streamed copies,
subclass-before-construction, base-prototype-before-construction, own-property
after construction, and base-prototype-after-construction. They use real mounted
adapters with independently observed actual bytes and directory names. The bad
destination writer redirects into the **actual source store**, changes its bytes,
and fails EIO; it is not merely a hypothetical callback returning a wrong label.
Memory buffered cases deliberately disable streaming capability to select the
buffered path. S3 prototype-after streaming changes the dynamically used private
`call` dependency: replacing the already-bound `streamWrite` alone would not
demonstrate a changed route. Seeding uses saved original operations or direct
actual MockS3 storage operations, before the tested copy.

Two additional content-acquisition overrides require unknown/ENOTSUP before the
changed reader is opened. Six positive controls cover harmless subclasses and
pre-construction explicit distinct/denial authorities, in both Memory/S3
directions through readonly and mounted views. Three late-authority cases produce
the current two failures and the passing WebDAV control. No class blacklist,
per-client token, content hash or fictional server guarantee supplies proof.

The focused pre-fix archive is committed source `781f272`, which already includes
core `0bee8e7`, not the obsolete `3cf` core snapshot. `adapter-routing-before`
records 14/29, including **ten actual source corruptions**: eight Memory operation
overrides and two S3 streaming prototype/dependency overrides. They return
distinct, call the misrouted writer, and end EIO with source bytes equal to
`wrong route damaged source`. Target bytes stay unchanged. The other five failed
assertions concern changed content acquisition or legitimate subclass/explicit
authority workflows; they are not five additional proven source losses.

Pre-fix Memory SHA256:
`98704037c57bae8bd5c3782c65aceb98e967837df375b33eda52a00ce762b1a0`.
Pre-fix S3 filesystem SHA256:
`7544d066ea75125279b6e29f82110c326d75fd04b44648a80a358603d2296f88`.
The pinned pre-fix source archive SHA256 is
`667e6d6abc870110f4f8d8ce539555f947223fbaf3e50f17102c741ab6344e3e`.

## Core requirements are part of this proof

The five bounded tests execute actual `filesystemCommands`, not proposal
scaffolding or a substituted copy algorithm:

- `cp -P` sees an unscoped source symlink through two aliases, fails without
  unlink or symlink creation, and preserves both its name and referent bytes.
- Forced EXDEV `mv` of a known hardlink alias returns status **1**, with a same-file
  diagnostic, no copy and no unlink; both names and bytes survive.
- Known-distinct successful EXDEV copy completes before source removal.
- Failed partial publication leaves the source in place and reports failure;
  partial target bytes are honestly retained, not silently rolled back.
- Unknown comparison prevents both copy and source removal.

The native status expectation is backed by the existing frozen GNU 9.7 evidence
from `0bee8e7`, copied unchanged into the capture; SHA256
`51d72f9595f65b2e12a03069bd8ce20467ad697b7125375f19983c5d1a8a50bb`.
No full native or core cohort was duplicated. These order checks do not establish
an incarnation-conditional generic `rm`: a source replacement after observation
or after copy can still be removed. Comparison is not a lease, transaction,
snapshot, universal pathname-race guard or ABA defense.

## Minimal seam and honest supported scope

The approved single public seam remains sufficient; no guarded-copy boolean or
additional public operation-authority API is proposed:

```ts
type EntryComparison = "same" | "distinct" | "unknown";
interface FileSystem {
  compareEntry?(path: string, peer: FileSystem, peerPath: string,
    options?: FsOptions): Promise<EntryComparison>;
}
```

Resolve both operands to actual followed backing views; honor complete known
identity before negotiating; otherwise query recognized operand authority without
recursive negotiation. Validate answers and conflicts, preserve metadata failures
and caller cancellation between observations, and never acquire content, truncate,
create lock-null entries or mutate/delete while comparing. The existing focused
tests retain missing/inaccessible metadata, ENOENT-shaped cancellation, conflicting
answers, known aliases, wrapper selection/copy-up, and exclusive insertion races.

Native tuple authority must be withheld when its operations no longer describe
the same private store. A fresh metadata response is not whole-operation mapping
authority. Registered remote descriptors must bind the current original methods,
transport, root/prefix and actual backing storage, including private dependencies.
The current Memory/S3 late-method bypass shows why registered inherited dispatch
must not silently substitute for the explicit operand method.

Useful supported workflows remain concrete: ordinary qualified MockS3 factory
views can compare shared backing across clients/prefixes and copy distinct keys;
WebDAV resource-ID support can compare endpoint/root aliases and distinct resources;
recognized private Memory and qualified closed mock stores can establish genuine
cross-backend disjointness. Normal unchanged subclasses remain usable. Protocol
resource IDs are not DAV hrefs or ETags. Private mock authority is not a promise
about every real server or every custom client.

An operation-local copy authority alone would solve only a provider's native copy
subset. Cross-backend comparison needs recognized shared authority or positively
known disjoint actual stores. Arbitrary unrelated/opaque providers may overlap;
without either proof their result stays unknown. Existing unknown destinations
must not be destructively opened. Missing-target workflows use actual exclusive
creation and preserve insertion races; this is not permission to trust a backend
that lies about exclusive creation. Source/target failure and cancellation after
qualified comparison remain independently exercised by the existing tests.

## Preserved captures and harness corrections

| New capture | Source | Result | Interpretation |
| --- | --- | --- | --- |
| `baseline-final-47` | `0c4709f` | 2/47 | Previously captured pre-implementation baseline, now committed unchanged |
| `committed-wrapper-s3-47` | `3cf57d3` | 32/47 | Previously captured partial source baseline, not current proof |
| `adapter-controls-initial` | worktree | 24/26 | Two overstrict error-object-reference assertions |
| `adapter-binding-before` | `781f272` | 15/27 | Initial probes instantiated subclasses even in base-prototype cases |
| `adapter-routing-before` | `781f272` | 14/29 | Corrected base-instance paths; ten actual source corruptions |
| `qualified-routing-current` | worktree | 76/76 | Corrected routing and core cases, before late-authority additions |
| `explicit-late-authority` | worktree | 76/79 | Two genuine bypasses plus WebDAV fixture base-path error |
| `explicit-late-confirmed` | worktree | 77/79 | Corrected fixture; two genuine bypasses remain |
| `committed-qualified-79` | `307938f` | 77/79 | Final strict pinned run, all three committed source checkpoints |

All these scoped typechecks exit 0, with no skipped/cancelled/TODO tests. Counts
from different test revisions must not be added together. The initial error
assertions incorrectly demanded object-reference identity across mount error
translation; they now require typed EACCES and exact query counts. The initial
base-prototype probes are not adequate S3 preconstruction coverage because a
subclass rejected by the old constructor class check masked that path. The final
tests instantiate the base class for those cases. The initial late WebDAV test
used `/` instead of the actual fixture's `/dav/` root and failed during setup;
only the corrected run establishes its passing control. All earlier raw artifacts
and tests remain intact. Generated TAP whitespace is preserved rather than cleaned.

Every capture verifies all 57 proposal-history files against `29fe1bf`. Before
the final pinned capture, an additional integrity check verified all 289 artifact
hashes in the then-existing 20 manifests and all 171 previously committed evidence
files against `a3f26e6`. No source-owner fixtures or old evidence were modified.
The final integrity pass verifies 306 artifacts in 21 manifests, confirms every
final executable test/runner hash still matches its frozen input, and confirms
the approved contract, current core, S3 and both WebDAV checkpoints are ancestors
of the pinned Memory integration commit.

## Reproduce and resume

```sh
node tests/fs/mount/identity-authority-review/implementation/capture.mjs 307938f new-pinned-label
node tests/fs/mount/identity-authority-review/implementation/capture.mjs REVISION new-focused-label adapter-binding.test.ts core-ordering.test.ts
```

Labels must be new. The runner archives Git revisions rather than relying on the
current working tree, freezes owned test inputs, checks the approved contract
against `5076b32`, records core `0bee8e7` hashes, and runs scoped tests/types only.

Root's next gate is remediation/review of the two late-authority failures followed
by one new pinned independent run. The original 38+5 compatibility cohort and 53
guards remain the other verifier's assignment. Their inputs were not qualified,
modified, replayed or waived here. No full-FS run, new backend breadth, API redesign,
live-provider guarantee, full product acceptance or superiority claim follows.
