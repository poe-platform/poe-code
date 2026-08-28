# README-only full-package addition — pre-execution recipe

This append-only qualification preserves the original `351e03ad…` package and
`16c4502d` evidence: they prove the **845-file runtime/declaration/package.json
projection**, not complete package composition parity. The accepted baseline
`13fe54de…` has 846 regular files. Its sole additional member is root README.md,
36,273 bytes, SHA256 `87e92b73c7339b104212a9fb11006d339694f65575a7b79debfaa902ef9cf9d1`.
The author's existing `reconstruct.mjs:224` stages package.json and dist only;
it and every historical capture remain immutable.

## Frozen work and acceptance conditions

Commit this document, RECIPE.json, and run.mjs **before** invoking the fresh pack.
The runner requires that explicit committed recipe revision, not incidental HEAD.
Authenticate the original projection tarball, prior independent evidence, baseline
full-package capture, baseline Git README bytes, and actual Node/npm identities.
Extract only checked regular tar members into an exclusively owned empty temporary
stage. Reject unsafe paths, links, duplicates, unsupported headers, or oversized
archives. Add only the literal pinned README with its original 0644 mode.

Run offline npm pack with lifecycle scripts disabled, isolated HOME/config/cache,
and the authenticated Node executable. Require exactly 846 members and prove every
common 845 member has unchanged bytes, SHA256, and mode. Bind npm reported members,
sizes, modes, entryCount, integrity, shasum, and package identity to the actual tar.
Require byte-identical package.json, exports, and metadata, with zero runtime
dependencies and no bundled dependencies. Verify every declared export resolves
to retained package members (including wildcard targets); do not import product.
Check stage, tool inventory, and historical inputs before/after. Remove only the
runner's own temporary directory. Preserve failure records, if any.

The report records the new tarball hash, complete per-member hashes/modes/sizes,
tool identities, actual command/output, and negative manifest controls. No source
patch, build, 60-case/93-case replay, native oracle, installation, or whole gate.
Original behavioral acceptance transfers solely through common-byte identity;
this addition is a packaging proof, not a new behavior score or current-HEAD claim.
The 269-input selected source archive and emitted package are explicitly **not**
a full Git archive. No AGENTS.md is copied or packaged.

## Replay

`node run.mjs PRESEAL_COMMIT` produces a new immutable `result/` once.
`node run.mjs --verify` checks retained evidence without packing or running tests.
The new verifier authenticates the old sealed files without modifying older
whole-directory seal validators to silently admit this additive revision.
