# Git M1B Pack Reader Specification

Status: Proposed v1 — ROOT/design review required; no implementation grant
Implemented Through: Not applicable
Purpose: Add genuine bounded pack-backed reads without broadening M1A command, layout or host capabilities.

Date: 2026-08-28. Observed M1A candidate is
`9885390fb11454fa194a3e60fdbef198dbfdf633`, under different-agent review, NOT accepted.
This proposal does not alter ratification70ba55ea or the original B01–B12 matrix.
Normative statements below describe the proposed M1B profile, not current behavior.

## Normative Language

MUST/MUST NOT identify proposed conformance requirements. SHOULD is a recommendation.
The three ROOT decisions in DECISIONS.md are not silently ratified by this document.

## Problem Statement

M1A understands loose objects/indexes but refuses any packed storage. Ordinary
repacking therefore makes its useful status/diff/log/show workflows unavailable.
M1B should enable small, self-contained SHA1 packed repositories under the SAME
fixed budgets, not introduce host Git, a new general-purpose filesystem API,
network fetches or a pretend full Git implementation.

## Goals and Non-Goals

Goals: directory .git and bare repositories; loose+pack coexistence; pack2/3 with
idx2; direct objects, OFS_DELTA and same-pack REF_DELTA including forward refs;
correct type/content/OID, complete abbreviation census, truthful failures and
cooperative cleanup. All six M1A neutral workflows must work after replacing the
11 loose objects with an admitted pack, with unchanged output bytes.

Non-goals: Git mutation, writing/repacking, native fallback, thin external bases,
promisor fetch, SHA256, idx1, gitfiles/commondir/linked worktrees, extensions,
alternates/shallow/replace/grafts, config/hook/filter execution, extra commands,
renames, binary patches, new options/default registration or new dependencies.
M1A's config, attributes, path, index, text/diff and exit policies remain intact.

## Domain and Authority

- **Pack identity**: SHA1 of header+entries, matching filename stem and trailer.
- **Index identity**: SHA1 of the entire idx except its final20-byte checksum.
- **Location**: admitted pack identity + exact entry-start offset; not merely OID.
- **Object identity**: SHA1 of reconstructed `type SP size NUL` plus final body.
- **Snapshot**: an invocation-owned copy of authenticated provider bytes; neither
  an atomic repository snapshot nor evidence of physical provider disjointness.
- **View**: an internal slice retaining an owner, never an independent allocation.

Input is untrusted byte data through the configured VFS. Host adapters are trusted
to obey their declared namespace/byte contract; this is not a hostile-host-JS
sandbox. No process.env, host filesystem, native process, private engine or network
is an admissible object source. Pack parsing MUST NOT cause hooks/config execution.

## Storage Admission Before Success

Recommended **strict eager pack admission** (ROOT decision D1): every discovered
pack is index/envelope/CRC/entry-framing/delta/OID verified before ANY successful
stdout, including rev-parse metadata queries and a selected loose object. This
avoids advertising packed readiness when a shadowed/unselected pack is malformed.
It is stricter and potentially more expensive than Git's ordinary lazy queries;
caps are ceilings, not a promise every32MiB pack or8MiB object fits all budgets.
It is not full repository fsck: unselected loose objects retain M1A's census policy.

The reader MUST enumerate the complete bounded object directory first. It admits
only matched regular `pack-<40lowerhex>.pack`/`.idx` pairs and the finite inert
sidecar proposal D2. Missing/orphan pairs, symlinks, unknown entries, any promisor
marker and every M1A unsupported route fail128 before success. Pack/index changes
observed during reads or pre-publication validation fail128; no fallback to a good
loose copy is allowed after known pack corruption. Empty valid packs are allowed.

Multiple packs may contain the same OID. Every physical representation is still
verified. After verification, equal type/length/bytes can share one cache owner;
conflicting reconstructed bytes MUST refuse. Same-pack REF lookup cannot borrow
an equal loose/other-pack object to disguise a missing local base. The global
abbreviation census is the deduplicated union of loose names and admitted idx OIDs;
entry/verification work counts physical occurrences, not just deduplicated names.

## Pack and Index Contract

The reader MUST validate checked arithmetic before allocation/conversion:

1. Pack minimum32 bytes; PACK signature; big-endian version2 or3; object count
   admitted against remaining entry/object budgets and index count. Verify outer
   SHA1 and expected filename/trailer; empty count means exactly header+trailer.
2. Idx magic ff744f63, version2,256 cumulative big-endian fanout words. Count must
   fit exact file layout and remaining counters BEFORE allocating row arrays.
   For SHA1, minimum size is `8+1024+28*N+40`; remaining bytes must be8*L.
3. OIDs strictly unsigned-byte sorted without duplicates in one pack; independently
   recompute all fanout buckets. CRC and offset arrays use the SAME OID order.
   Validate idx's pack checksum and own checksum, not just either one.
4. Resolve high-bit offsets via bounded8-byte entries using BigInt/checks before
   Number. Every slot must be referenced once; unused/duplicate slots refuse.
   In-bounds small values encoded through the large table are accepted, not
   rejected merely for being small. Actual >32MiB offsets necessarily refuse.
5. Sort offsets independently of OID order. First start12; unique starts all before
   trailer. Each entry occupies `[offset,nextOffset)` or `[offset,packSize-20)`.
   Parse its header/base prefix, verify CRC32 over the ENTIRE encoded entry,
   and decode exactly ONE complete zlib member consuming the remaining span.
   Gaps, overlapping/midstream starts, trailing bytes/members, truncation,
   dictionary requirements, invalid types0/5 and invalid framing refuse.
6. Entry size uses low4 bits then7-bit continuation groups; no unchecked JS bitwise
   size assembly. Direct type1/2/3/4 sizes are final raw body length; delta type6/7
   sizes are uncompressed DELTA PROGRAM length, NOT final object length.
   Both program and reconstructed body must separately fit maxObjectBytes8MiB.

Git format facts are sourced in SOURCES.md. Proposed extra restrictions (idx2,
slot bijection, eager verification, caps) are project policy, not universal Git
format-invalid claims. CRC32 means zlib/IEEE polynomial, not the POSIX cksum format.

## Delta Contract

OFS distance is decoded with the continuation recurrence
`distance=(distance+1)*128+nextLow7` after the first low7 byte. It is NOT the ordinary
little-seven-bit size varint. Check overflow at EACH step. Distance must be>0 and
land on an exact earlier admitted entry start, not header/trailer/interior bytes.

REF_DELTA consumes exactly20 base-OID bytes. The base MUST exist in the same pack's
index; forward order is valid. Resolve with an explicit iterative stack keyed by
LOCATION; VISITING detects cycles, VERIFIED permits DAG reuse. Root direct objects
have depth0; at most32 delta edges,33 refuses, including a cached deep base.
Depth is intrinsic stored representation depth, not the number of cache misses.

Inflate the exact delta program, then decode base size and result size as bounded
little-seven-bit varints. Base size must equal the actual resolved base length;
result size is admitted before allocating result bytes. A zero opcode refuses.
Literal opcodes1..127 copy exactly that many program bytes. Copy opcodes use their
individual offset/size presence bits and original little-endian positions; omitted
bytes do not shift later fields left. Effective size0 means65536. Validate both
base and destination ranges without overflow before copying. All program bytes
must be consumed and destination length exactly reached; no truncation/padding.

The final type is inherited from the fully resolved base. Hash the reconstructed
Git prefix+body and compare with that entry's idx OID. No unverified bytes may
be returned, emitted, or installed under an advertised OID. Type/size/hash checks
apply equally to blobs, trees, commits and tags. No delta command executes code.

## Fixed Budget and Ownership Contract

All24 values remain exactly M1A; no options or overrides. See LIMITS.json for the
full literal table. Core ceilings: read67108864; inflated134217728; resident
67108864; steps32000000; packs8; each pack33554432; index16777216;
object/program/result8388608; delta depth32; objects32768; entries20000.

Accounting MUST be cumulative for the invocation, including admission, all packs,
duplicates, rereads and queries. It MUST NOT reset per object, pack, delta or query.
ReadBytes counts bytes supplied by VFS. InflatedBytes counts every byte produced
by the codec AND every byte reconstructed by delta replay, including discarded
or deduplicated results. Steps count scanning/header/CRC/hash/copy/comparison and
delta op work before it happens; checkpoints within4096 explicit work units remain.
This is cooperative accounting, not a native-code preemption or hard RSS promise.

Recommended minimum D3: **invocation-pinned verified object cache, no eviction**.
This preserves the current private Repository.object callers' lifetimes. Every
returned GitObject/body/header/message view shares its owner's lifetime. Pack
compressed storage can be freed only after every dependent codec and view is
finished. Pack bodies/idx decoded data must not escape as aliases into a freed
compressed owner. Different invocations MUST NOT share mutable caches or counters.

Use one admitted-sized owned pack allocation filled incrementally; the present
Session.read piece-array+concatenation path must NOT be naively used for32MiB packs
(it can hold two full copies before indexes/decoded bodies). Optional VFS range
streams are not a required new capability. Mandatory bounded readFile fallback
still makes an owned copy and discloses provider-supplied allocation outside the
owned-resident accounting. Never pretend borrowed/provider memory is owned/charged.

Before each body/program/result/index/row allocation, reserve bytes, including
temporary coexistence. Memory pressure fails128 rather than reusing views or
silently discarding bases. Release a processed pack buffer after all its entries
are verified; retain verified object bodies through command completion. Duplicate
cache bodies can be released only AFTER type/length/byte equality and no dependent
view. Scalar metadata may survive release; dangling body/message views may not.
Explicit cache eviction/refcount leases are a later optimization, not hidden in M1B.

## State, Cleanup and Failure Semantics

Invocation state is DISCOVERING -> ADMITTING -> READY -> QUERYING -> CLOSING -> CLOSED,
with any failure entering CLOSING. Object location state is UNSEEN/VISITING/VERIFIED;
failed locations cannot become verified or fall back to another representation.

Register cleanup BEFORE acquisition/activation. All readers/codecs and pack owners
belong to the accepted output-operation scope; await owned release before outcome
selection. Close/finally/late acquisition share idempotent release completion.
Pending writer callbacks and late rejections must remain observed. No raw Node22
zlib engine internals, newer-node-only flags, detached decoding jobs or timeout
that abandons owned resources. Required stderr remains under the caller context.

Preserve M1A precedence: caller abort > escaping host/sink failure > cleanup;
local Git failures128/usage129 and diff difference1 remain distinct. Never infer
provenance from reason equality alone. No retry, fetch, repair or skip-on-corruption.
Root/sibling scopes are not aborted by local stdout closure; opaque input/host
promises are not forcibly preempted. Full repository atomicity/ABA detection is
not claimed. Before first stdout, revalidate observed pack/index directory and
file bytes through bounded streaming hashes, not an uncharged metadata-only guess.

## Test and Validation Matrix

MATRIX.md retains B01–B12 families; additions are only necessary format/ownership
neighbors. NEUTRAL-PACKS.json contains independently inspectable format DATA, not
product passes or native captures. Producer/validator are standalone fixture tools
using Node library primitives, never production parser imports or host Git.

Before module GO: ROOT decisions, different design review, M1A accepted or explicit
new source ownership window. Before acceptance: genuine product source/build/
installed/moved runs with all M1A regressions, bounded malformed/abort/borrowed/
cleanup and loaded-mutant controls. Actual native six-workflow comparison requires
a separate fresh grant and isolated fixture roots; NATIVE-RECIPES.md is UNRUN.

## Conformance Criteria

Acceptance requires reviewed implementation satisfying the selected profile,
qualified positive/negative whole-repository workflows, source/package bindings,
counter/cleanup evidence and no inherited unrun claim. Checksums in data fixtures
do not certify a production parser. Passing B01 does not prove all ordinary packed
repositories supported; M1B remains pending until implementation/review complete.
