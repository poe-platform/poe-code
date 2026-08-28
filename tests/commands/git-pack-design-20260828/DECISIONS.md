# Exact proposed ROOT decisions and implementation handoff

All are proposals. No M1B product code or root exports are authorized by this packet.

| Decision | Recommendation | Observable cost/limit |
| --- | --- | --- |
| D1 admission depth | Verify every discovered pack entry/delta/OID before ANY success, even metadata-only/loose selection | Stricter eager work under existing32M steps. A large otherwise valid repository can refuse128; no lazy-fsck guarantee or cap increase. Unselected loose bodies remain M1A-lazy. |
| D2 inert sidecars | Permit regular same-stem .rev/.bitmap/.keep/.mtimes only when the complete pack/idx pair exists; permit regular objects/pack/multi-pack-index and objects/info/{packs,commit-graph} | Bodies unused, not a semantic source. lstat size<=16MiB and bounded directory-entry accounting; never follow links. Incremental index/graph directories and unknown names still refuse. Promisor NEVER ignored. This is an explicit storage-admission delta from M1A, not a config/layout relaxation. |
| D3 cache policy | Pin verified object bodies per invocation, release compressed pack after full admission, no eviction | Finite resident failure instead of premature view release. Existing private GitObject callers remain valid; do not build a new public lease/cache API. |

Alternative to D1 (NOT selected silently): envelope/CRC/index checks globally with
lazy object inflation/hash. It is faster but would let metadata-only commands
succeed with an unselected malformed zlib/delta payload. If ROOT prefers it, that
must be an explicit weaker storage-qualification profile, not a hidden optimization.

## Exact private interfaces proposed

These names are provisional design seams, not available exports:

```ts
interface PackCatalogue {
  readonly names: ReadonlySet<string>;
  getVerified(oid: string): GitObject | undefined;
  assertUnchanged(): Promise<void>;
  close(): Promise<void>;
}
admitPacks(session: Session, gitdir: string): Promise<PackCatalogue>;

interface PackedFrame {
  readonly encodedType: 1 | 2 | 3 | 4 | 6 | 7;
  readonly declaredBytes: number;
  readonly start: number;
  readonly compressedStart: number;
  readonly end: number;
  readonly base: { kind: 'offset'; start: number } | { kind: 'oid'; oid: string } | undefined;
}
inflatePackedFrame(session: Session, compressed: Uint8Array,
  declaredBytes: number): Promise<OwnedInflation>;
interface OwnedInflation { readonly bytes: Buffer; readonly consumed: number; }
applyDelta(session: Session, base: GitObject, program: Uint8Array,
  expectedOid: string): Promise<GitObject>;
```

OwnedInflation's body has one Session reservation; compressed input is a view into
a still-pinned pack owner. The caller MUST release the program after reconstruction
or transfer a direct-body owner into the catalogue. The frame cannot retain views
after the parent pack release. Delta base type never comes from a guessed code6/7.

Repository.object first uses already-admitted packed/loose cache, then existing
verified loose reader if no pack entry exists. Known corrupt packed storage cannot
be bypassed by a loose copy. The catalogue already verified all pack locations;
an OID cache hit is not permission to omit verifying a second physical location.
Abbreviation uses union membership, not an assumed per-pack unique prefix.

## Proposed narrow future write set

| Future path | Needed change / source proof obligation |
| --- | --- |
| src/commands/git/pack.ts (new) | idx/pack census, exact layout/checksums/CRC, location graph, eager verification, pinned catalogue and observations |
| src/commands/git/delta.ts (new) | Checked size/OFS integers and standalone bounded replay, type/hash validation, depth metadata |
| src/commands/git/crc.ts (new) | IEEE CRC32; small fixed table, chunked charging/checks; not a package dependency |
| src/commands/git/codec.ts | Add private packed-frame mode; preserve loose framing/hash facade and all unchanged M1A regressions. No Node private internals. |
| src/commands/git/io.ts | Private exact-sized streaming fill and bounded hash observation so pack loading does not duplicate full buffers; no new shared FS contract |
| src/commands/git/repository.ts | Replace only pack admission refusal with admitted catalogue; merge census/cache and close owners without stale views; retain other refusals |
| src/commands/git/README.md | Explicit supported pack profile/unchanged limitations and new evidence |
| tests/commands/git-pack-author-20260828/** (future) | Presealed actual implementation tests, no native grant inferred |

No planned root index/package/default edits; no changes to config.ts/arguments.ts/
queries.ts/diff.ts/ignore.ts command behavior, limits.ts24 values, shared contracts,
FS source or M1A historical fixtures. If independent M1A review changes these seams,
rebase this DESIGN explicitly against its accepted source before implementation.

## Source-backed ownership hazards to review

- io.ts158–204 presently retains pieces plus final concatenation. A32MiB pack
  cannot blindly reuse that path under a64MiB resident ceiling plus other owners.
- codec.ts7–104 understands loose ASCII headers. Pack direct and delta frames are
  headerless after inflation; using the loose reader would misparse real bytes.
- repository.ts21–24 holds object/commit caches. headers returns a body subarray
  and commit stores it; cache eviction cannot release that underlying body early.
- repository.ts143 returns cached GitObject, not a refcounted lease. Invocation
  pinning is the compatible minimum; reference count remains one cache owner plus
  explicitly scoped views, not fabricated untracked independent owners.
- io.ts207 unchanged() currently rereads with maxIndexBytes. Pack observations
  need their own maxPackBytes/streamed digest path; do not silently raise limits or
  reread an unbounded file through a metadata helper.
- Limits count simultaneous owners and cumulative work separately. Releasing a
  buffer permits resident reuse, NEVER refunds read/inflate/work or delta depth.

### Required ownership/preallocation proof table

| Owner | Reservation and aliases | Earliest permitted release |
| --- | --- | --- |
| Compressed pack | One allocation of admitted stat.size; exact incremental fill. Entry/compressed spans are borrowed views into this owner, not separately releasable bytes. | All entry codecs have closed and all spans are dead; sequential packs may then reuse resident capacity. |
| Raw idx | Exact admitted size before read; fanout/layout arithmetic checked before decoded tables. | OIDs/offsets/CRCs/observations retained for later use have their own charged representation, and no lookup view still borrows idx. |
| Decoded location tables | Allocate explicitly sized numeric buffers after count admission; charge their actual byteLength. OID text charges2*length, matching Session.text's logical string convention. No growable uncharged row-by-row object array. | Pack admission graph and dependent lookup/observation consumers have finished. JS Map/Set overhead is count/work-bounded, not claimed exact RSS. |
| Inflated direct body/program | Packed declared size known before inflation, reserve exact output and fill it while counting every produced byte. Provider/zlib transient chunk is consumed before advancement; retaining it requires an owned copy/reservation. | Program after delta replay and codec closure; direct body only after all cache/query views are done. Do not concatenate a hidden second full body. |
| Delta result | Decode and validate result size, reserve BEFORE allocation. Base+program+result coexist; result publication waits for inherited type and OID verification. | Failure after owned work closes; otherwise the invocation cache lifetime. |
| Cache body / duplicate | One retained owner per verified representation until safe dedup; cached lookup/message/header views do not mint new owners or permit early release. Compare duplicate bytes with charged work before discarding the extra body. | All query/commit/message views complete, then catalogue closure releases each retained owner exactly once. |
| Reader / codec handle | Register cleanup before acquisition, track acquisition/close completion independently of data ownership. Await late-created handles and observed rejections. | Handle is actually closed; promise rejection or consumer closure alone is not release evidence. |

D3 has **no eviction operation** and therefore no synthetic eviction-success
claim. B10's original cache-eviction wording remains historical; its applicable
M1B obligation is correct shared-base/pinned-view lifetime and explicit resident
refusal. If ROOT requires eviction, that needs an additional private lease design
and real release/reacquisition controls before implementation, not a waived test.
Numerical external refcounts are not introduced: one cache owner remains pinned
while query views are live. Future source proof must show every reservation,
ownership transfer, failed allocation unwind and release site, including thrown
falsy errors. Counts alone or final GC/RSS samples do not establish these lifetimes.

## Release path

1. Review these three decisions + neutral data; M1A remains frozen under Dirac.
2. Only after ROOT/M1A window: preseal exact source/test/tool/capture bounds and
   implement this narrow read-only pack reader. No new command names.
3. Author M1A+M1B source/build/installed/moved, counter/cleanup/mutant proof; different
   verifier then actual packed-repository workflows. Native recipes need fresh GO.
4. Public/default Git readiness is a separate integration decision; defaults78 and
   root APIs remain unchanged now. Full Git/packed-everywhere claims stay prohibited.
