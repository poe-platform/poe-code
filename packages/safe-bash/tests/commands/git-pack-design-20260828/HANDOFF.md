# M1B design/data handoff — 2026-08-28

**Review-ready design, NOT implementation or packed-repository acceptance.**
Scope only `tests/commands/git-pack-design-20260828/**`. M1A candidate
`9885390fb11454fa194a3e60fdbef198dbfdf633` remains frozen under Dirac review;
all11 module files were byte/mode/hash matched after this work. No product,
root export, default, dependency, original fixture or private checkout changes.

## Seals and actual execution

- Proposed specification/24 limits/B01–B12/future-native/data recipe preseal:
  development commit `7447166d`. Tiny DATA tools preseal: `bacf99cb`.
- `NEUTRAL-PACKS.json`:370847 bytes, SHA256
  **eda294f89c61d09319701c50c76e1004d2b4de27fc5d025473a4058fc75a7080**.
- Generator ran once; separate same-author byte parser ran once. **13 valid-format
  sets /106 object entries**, including depth33 as valid-format but outside the
  proposed depth32 profile; **18 specified malformed-data rejections** (3 encoded
  delta-program sets +15 in-memory structural mutations). No failed data case.
- Six original workflow mappings are byte-identical DATA, **not six executed
  commands**. P01/P02 genuinely contain the original11 object bodies with pack2/3
  and idx2; future VFS recipe removes exactly the11 loose files.
- `GENERATION-v1.json` / `CHECK-v1.json` record exact runtime/tool/data hashes;
  v22.22.2 Node SHA2565c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011.
  Both status files0 and stderr empty. Direct finite library processing, no children.
- Metadata seal v1 failed because the repo-root URL traversed one directory too
  far; original empty `BINDING.json` and `SEAL-v1-FAILURE.txt` preserve that fact.
  Corrected metadata-only `BINDING-v2.json` is authoritative, exit0; generation and
  data validation were NOT rerun or rescored. It verifies11 source hashes/modes,
  original neutral SHA, all24 literal limits and the named evidence/tool inputs.
- Static write-spec checker: OK,0 warnings. No source/compiler/build/installed/
  moved/native Git/oracle/private engine or product resource-stress execution.

## Exact ROOT decisions before implementation

| ID | Recommended rule | Cost / qualification requiring review |
| --- | --- | --- |
| D1 | Eagerly verify every pack/index envelope, CRC, frame, delta and final OID BEFORE successful output, even for metadata/loose selection | Existing32M work and64MiB read can refuse valid packs smaller than independent32MiB size max. Not full fsck of unselected loose bodies. No silent weaker lazy policy. |
| D2 | Bypass only regular same-stem .rev/.bitmap/.keep/.mtimes with a complete pair; regular objects/pack/multi-pack-index and objects/info/{packs,commit-graph}; bounded lstat/entry accounting, size<=16MiB | Bodies are not used as authority. Links, promisor, unknown names and incremental directories refuse. This is an explicit finite M1A storage-admission delta, not a layout/config expansion. |
| D3 | Invocation-pinned verified bodies; sequential compressed pack release; no eviction | Compatible with existing unleased GitObject/commit-message views. Every view lives through query completion; resident exhaustion refuses. Original eviction-specific obligation is not falsely credited; eviction would need another private lease design. |

No public cap knobs:24 fixed values unchanged (read64MiB, inflated128MiB,
resident64MiB, work32000000, object/program/result8MiB, idx16MiB, packs8,
pack32MiB, delta depth32). All apply cumulatively/simultaneously. No hard RSS,
opaque-host preemption, atomic repository snapshot, filters/hooks/network or native fallback.

## Interface and implementation write set — PROPOSED ONLY

Private `admitPacks(session,gitdir):Promise<PackCatalogue>` exposing names,
getVerified,assertUnchanged,close; `inflatePackedFrame(session,compressed,declaredBytes)`
and `applyDelta(session,base,program,expectedOid)` (DECISIONS.md signatures).
Future new `src/commands/git/{pack,delta,crc}.ts`; narrowly modify existing
`codec.ts`, `io.ts`, `repository.ts`, module README; future pack-author tests.
No command grammar/config/index parser/diff/limit/root/shared-contract changes.

Critical source proofs: do not reuse piece-array+concat for pack-sized reads;
pack streams have no loose ASCII header; actual consumed zlib input must equal
the admitted entry span; copy borrowed chunks before advancement; reserve each
owner before allocation; base/program/result coexistence charged; preserve view
lifetimes, intrinsic cached delta depth, caller/error/cleanup precedence and
cleanup-before-acquisition. Ownership table in DECISIONS.md is review material,
not a claimed existing implementation. Node bytesWritten alone is not a general
production consumption/cleanup proof.

## Validation boundary and next action

MATRIX.md preserves exactly B01–B12. Deferred product cases include cycles,
unselected-corruption admission, all type inheritance, multipack duplicate owners,
8/9 packs and exact cap edges, borrowed/cancel/sink/late-close observers and actual
Node22 streaming behavior. Do not infer their success from small DATA arithmetic.
Primary Git tagged/manual and Node API references are in SOURCES.md. Data is
hand-encoded, independently inspectable, but generator/checker share Node crypto/
zlib and the same author: different design/native/product verification remains.

Request ROOT decisions D1–D3 plus different design review; M1B module GO requires
M1A acceptance or an explicit new source window. Six native workflow recipes
remain **UNRUN**, and need fresh native/tool/resource authorization. Defaults78
and root APIs unchanged; Git/apply_patch remain module candidates, not accepted
defaults. Node runtime/provider qualification is unaffected. No old gate rescore.
