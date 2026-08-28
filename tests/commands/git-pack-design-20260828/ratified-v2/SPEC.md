# M1B ratified design amendment v2

Status: Author DESIGN CORRECTIONS ONLY; different review pending
Implemented Through: Not applicable
Date: 2026-08-28

## Authority and interpretation

ROOT record `5f02757081bb1c1477365a922442d17804f872e8`,
`tests/commands/git-pack-independent-20260828/ROOT-DECISIONS.md`, selects
D1/D2/D3 and adopts F01/F02/R01/R02. This additive amendment overrides only the
listed clauses of author `63d811bf1a809b467f47f309f41b1445486e71db`.
Its original SPEC/DECISIONS/LIMITS/MATRIX/checker/data/captures remain historical,
byte-unchanged inputs. Unmentioned command, layout, error and interface contracts
remain as originally proposed. MUST/MUST NOT identify implementation obligations,
not executed proof or implementation authorization.

## C01: selected eager admission

D1 is **selected eager verification before any successful output**: every
discovered pack/idx envelope, CRC, frame, delta and final object ID is verified,
including for metadata-only queries and queries selecting loose objects.
Corrupt unselected packs cannot be bypassed. The lazy/selected-object alternative
is **unselected**. This is a stricter bounded pack-integrity profile, not ordinary
packed-repository readiness, performance parity, or fsck of unselected loose bodies.

All 24 caps below remain fixed. The per-pack 32 MiB ceiling is NOT a promise of
usable packs of that size. Under separately charged owned fill, pack hash, entry
CRC and pre-publication hash, the static necessary condition is
`W >= P+(P-20)+(P-32)+P = 4P-52`. At `P=8,000,014`, this is **32,000,004**
byte-work units, beyond **32,000,000 before index, inflation or query work**.
This is source arithmetic, not timing, an at-cap test, or permission to reset caps.

## C02: selected observation-only sidecars

D2 admits only these inert regular-file names, without following links:

- Same-stem `.rev`, `.bitmap`, `.keep`, `.mtimes`, only with a complete pack/idx pair.
- `objects/pack/multi-pack-index` and `objects/info/packs`, `objects/info/commit-graph`.

Each admitted sidecar has lstat size <=16,777,216 bytes, subject to bounded
directory-entry accounting. Unknown names, incremental index/graph directories,
symlinks and promisor storage still refuse. No configuration/provider/network,
hook, linked-worktree or alternative object-routing admission is added.

Admission and pre-publication checks bind **membership, type, size and available
stat fields only**. Sidecar bodies are unused and unverified. "Changed sidecar"
in B11 means a change visible to these observations, NOT arbitrary byte mutation.
No unavailable field may be fabricated; same-stat changes/ABA and atomic snapshot
consistency are not established. There is no sidecar hashing requirement or
uncharged read allowance. At eight pairs, 35 allowed names is a census bound,
not permission to read 560 MiB of bodies. Actual object authority is complete
pack/idx enumeration, not the ignored acceleration contents.

## C03: selected pinned ownership and location graph

D3 is invocation pinning **without eviction**. Verified body owners remain until
their actual consumers and admitted cooperative work finish. Every body/header/
message view shares its backing owner's lifetime; returning a cached object is
not a lease transfer. Caches and counters are not shared mutably across invocations.

The location state machine remains unseen -> visiting -> verified, with failure
unwind. Each physical location MUST verify its own frame, CRC, reconstructed OID
and intrinsic depth even if an equal OID is already cached. Direct depth is zero;
delta depth is base-location depth plus one, including cache hits. REF bases stay
same-pack; forward references are permitted, cycles and external bases refuse.
OID deduplication cannot skip a representation or turn its depth into zero.

| Owner | Reservation and consumers | Earliest valid release |
| --- | --- | --- |
| Exact-sized pack buffer | Reserve before fill; codec input and frame views borrow it | Every dependent codec/borrowed view has actually finished; no callback-settlement shortcut |
| Raw idx and decoded tables | Reserve both while coexisting; charge exact typed-array backing bytes and retained text | Last parser/graph/observation consumer finishes; retained scalar metadata independently accounted |
| Inflated direct body | One owned allocation, then ownership transferred to pinned catalogue | Invocation consumers and cooperative work finish |
| Delta program | Own reservation, distinct from base and result | Replay and all program views finish |
| Base and result | Base remains pinned; reserve result before allocation while base/program coexist | Result transferred to catalogue, or failure/discard after consumers finish |
| Duplicate candidate | Reserve and verify before comparing type, length and bytes with cached owner | Equality and absence of dependent views established; retained owner remains pinned |

Use one admitted-size incremental pack fill, not pieces plus a second full concat.
Provider-supplied fallback bytes still require an owned copy; their provider
allocation is not secretly an owned-resident charge. Cleanup is registered before
acquisition, blocks new work after closing and awaits owned completion before
settlement. Allocation failure unwinds actual owners once. Caller/sink/cleanup
reason precedence, falsy identities and sibling isolation remain unchanged;
there is no opaque-work preemption or native-allocation bound.

Original B10 eviction language remains **unfulfilled/out-of-profile**, not passed.
No public or private lease/eviction optimization is introduced by this amendment.

## C04: exact dimensions and count sites

This table replaces blanket "all accounting is cumulative" wording. All caps
apply simultaneously; no new options, Budget, numerical change or counter injection.

| Name | Fixed value | Dimension / charge site |
| --- | ---: | --- |
| maxArgumentBytes | 65536 | Aggregate argv bytes at invocation admission |
| maxPathBytes | 4096 | UTF-8 bytes per component and resolved path |
| maxReadBytes | 67108864 | Cumulative VFS bytes, including rereads and query reads |
| maxInflatedBytes | 134217728 | Cumulative codec output plus reconstructed delta bytes, including discarded duplicates |
| maxObjectBytes | 8388608 | Each direct body, delta program and reconstructed body independently |
| maxWorkingFileBytes | 8388608 | Each working-file body |
| maxIndexBytes | 16777216 | Each working index/pack idx; D2 uses the same number for sidecar stat only |
| maxMetadataBytes | 1048576 | Each admitted metadata region/file/header at existing callers |
| maxResidentBytes | 67108864 | Live reserved logical ownership, not cumulative allocation or RSS |
| maxEntries | 20000 | Shared cumulative directory/table/traversal admission units, specified below |
| maxObjects | 32768 | Invocation union of distinct loose and packed OIDs, not physical locations |
| maxCommits | 2000 | Shared parsed-commit count and existing query/traversal limits; cache hits are not reparses |
| maxDepth | 128 | Directory/tree/discovery traversal depth, not a sum across trees |
| maxRefDepth | 16 | Each symbolic-ref or tag-resolution chain |
| maxDeltaDepth | 32 | Intrinsic representation/location delta edges, including cached bases |
| maxSteps | 32000000 | Cumulative scan/header/hash/CRC/copy/comparison/replay work, charged before work |
| maxDiffCells | 1000000 | Cumulative diff cells across files |
| maxLines | 200000 | Cumulative parsed text lines |
| maxOutputBytes | 16777216 | Cumulative stdout publication |
| maxDiagnosticBytes | 65536 | Per diagnostic publication under the existing single-diagnostic path |
| maxChunkBytes | 65536 | Each yielded VFS/codec chunk and output partition |
| maxChunks | 32768 | Cumulative yielded VFS source rows in Session; no new codec-row extension |
| maxPacks | 8 | Complete-pair invocation census, not recharged by observation of the same pair |
| maxPackBytes | 33554432 | Each pack stat and exact-read extent |

Exact entry sites: each actual directory listing charges every yielded name,
including repeated pre-publication listings; each initial idx table admission
charges every physical object row (duplicates across packs still spend entries).
A second actual table admission charges rows again. Scanning an already admitted
table for graph verification or OID lookup charges work, not a fictitious fresh
table admission. Existing M1A working-index/tree/traversal sites keep their charges.
An OID's first insertion into the shared loose+packed census spends one object;
repeated OID hits do not, but all physical locations still require verification.
Repeated VFS rows, including empty chunks, keep the existing maxChunks charge.

Reserve before each owner/table/text allocation, including transient coexistence.
Logical resident = pack + retained raw idx + decoded tables + cached owners +
current program/result + wrapper buffers + other invocation owners; count a
shared cached base once, a not-yet-deduplicated body separately, and retained text
at the existing two-bytes-per-code-unit rule. Failed reservations do not allocate.
Only actual ownership release refunds live occupancy; read/inflate/work/count
usage is not refunded or reset. Intrinsic depth is not a refundable counter.
Explicit cooperative work checkpoints remain at most4096 units apart, not a
guarantee about native zlib/crypto scheduling or arbitrary host CPU work.

Resource masks remain visible: two maximum packs plus two minimal1072-byte indexes
already exceed64 MiB read accounting before rereads; the nonempty idx extent with
20000 admitted rows is at most721064 bytes, below16 MiB; charged copied output
can hit the32M work cap before128 MiB inflated accounting. Independent maxima
cannot all coexist inside64 MiB resident. None is a manufactured at-cap pass.

## C05: pinned-reader delta minimum

Before reading size varints or replaying, a delta program MUST have at least
**four bytes**. Lengths0/1/2/3 refuse. This adopts Git2.54.0 `DELTA_SIZE_MIN`, not
a general ban on empty direct objects or zero reconstructed results.

Preserve the component counterexample base `41`, program `0100` (two bytes,
declared result zero): refused by the selected minimum. Preserve separately base
`41`, program `81008000` (four bytes): it passes this minimum, and its extended
varints describe base size1/result size0. That is a source-path neighbor, not
executed whole-pack/native acceptance. No new canonical-varint restriction.
All existing base-size, checked arithmetic, opcode, copy/literal range, exact
result-length, type inheritance and final OID rules still apply.

## C06: pinned-reader SHA1 idx2 extent

For object count N, checked arithmetic yields `B(N)=1072+28N` and
`S=B(N)+8L`, integral nonnegative L. **N=0 requires L=0 and S=1072. For N>0,
0<=L<=N-1.** Check the extent before row/slot allocation or unsafe conversion.
The SHA1 trailer/pack-reference/fanout/OID order/CRC rules are unchanged.
Every indirect slot remains in range and used exactly once, with no unused slots;
decoded offsets remain safe, unique, in-pack and at exact entry boundaries.

N1/L1 is1108 bytes and exceeds the1100-byte maximum: refuse independently of
otherwise valid small offset12. N0 with a trailing slot also refuses. Existing
P11 N2/L1 at1136 bytes is within extent; small indirect offsets remain permitted
when all other checks hold. This is pinned reader compatibility, not a claim
that the wider layout is universally invalid across every Git implementation.

## C07: implementation boundary

The original private reader interface/write-set remains proposed, not implemented:
PackCatalogue/getVerified/assertUnchanged/close; admitPacks; PackedFrame;
inflatePackedFrame returning owned bytes plus actual consumed count; applyDelta.
No root/export/default or command grammar changes. Node codec consumption,
pending writes/close, ownership and loaded-package controls still require actual
implementation proof. Source/API documentation and tiny synchronous DATA checks
do not establish those properties. M1A remains frozen under independent review.
