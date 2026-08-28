# Presealed neutral DATA recipe v1

2026-08-28. This recipe is sealed BEFORE generator/checker execution. It permits
only tiny offline library processing, not M1B module/product/compiler/native Git.

## Inputs and routes

- M1A frozen source9885390fb11454fa194a3e60fdbef198dbfdf633, read-only11 paths.
- Existing `tests/commands/git-design-20260828/NEUTRAL-FIXTURE.json`, SHA256
  `fcb7bae1505a86b2b676396742d7bf362ad779c77192770ed94085646f8d0074`.
- Node `/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node`, observed22.22.2.
  Record its executable hash before use. Only node:assert/crypto/fs/path/url/zlib;
  no child_process, network, product imports, npm, Git fixture generation or private paths.
- New files only in this directory. Generator writes NEUTRAL-PACKS.json exclusively
  with `wx`; existing bytes are never overwritten. Checker reads only and emits
  a bounded JSON receipt to stdout, captured in a new named file.

## Finite DATA bounds

At most16 packs/160 total entries; each body/program<=98304 bytes; each encoded
pack<=262144 bytes; total input/pack/index/body data<=2097152 bytes; JSON<=4194304
bytes. At most32 malformed descriptors and depth64 in the DATA checker. No
large-limit allocation/stress. These fixture-tool bounds are NOT product limits.
Single Node invocation per generator/checker with30s outer supervision if needed;
no child workers. Receipt stdout<=65536 bytes. No silent automatic retry.

## Construction and independent arithmetic

The builder hand-encodes pack/index/header/offset/delta structures from literal
object bodies. Node builtin zlib compresses admitted DATA; crypto computes hashes.
No Git-produced pack bytes or production parser are used. Eleven original loose
objects are decoded only to recover already-sealed neutral bodies and verified
against their existing OIDs. Original six workflow inputs/expected outputs remain.

P01–P13 cover MATRIX.md. P13 is valid format with33 delta edges but would exceed
the proposed depth32 product profile; it must not be called malformed or accepted.
The checker is a separate same-author parser: bitwise CRC rather than builder's
lookup table; byte-layout/hash recomputation; graph/delta reconstruction compared
with literal body witnesses. It does not import builder code. Shared zlib/crypto
library use means this is not an independent native implementation or agent review.

The negative descriptor set mutates copies in memory only. Preserve pack/index
checksum dependencies when isolating a lower-level error; record the exact stage
of rejection, not just arbitrary exception success. Descriptor source and all
valid bytes are retained. Future product tests can reuse them without generation.

## Required receipt

Record runtime path/version/hash, tool and input hashes, fixture SHA256, bytes,
per-pack version/count/depth/body/CRC/OID validation, negative stages and exact
unchanged six-workflow mapping. Report DATA validation only. Product/native/build/
installed/moved/cleanup-stress executions remain0. Bind11 M1A source hashes before
and after this data work; no module changes. No AGENTS plaintext copy or snapshot.
