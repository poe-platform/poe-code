# Candidate admission: sealed data-only recipe

Date: August 28, 2026. Owner: delegated candidate admission/source/package worker.
This recipe precedes extraction, materialization, serialization and receipt generation.
Static Git reads and in-memory archive header inspection alone preceded this seal.

## Fixed inputs and scope

- Candidate source: `35da18547ca82a67be9ca22b4adc21e3b8060780`.
- Evidence: `ef6032b210feb5cf19e6f6f94c40413740bef335`.
- Handoff: `bcec1ead34aee37c8fe574b248a8242ad4f60cfa:tests/commands/yq-author-20260828/HANDOFF.md`.
  That path is absent at the source and evidence commits; do not substitute HEAD.
- Baseline: `5137a74ec855a32d8a8860eb66b62eb44d11e290`; accepted length:
  `74361026502d76b8c2b696f9c60e410ac9b78d95`; interpreter blob:
  `d3ba11f0057b07d5ad307c5dfbb5f0612a87a047`, SHA-256
  `e32ad45efe69544ed95b43b97f191006f10d3beea9ca9e2a3327843dffd45a74`.
- Final CARRY: `bd471ef682d768692a682d40009a874f51e3ad68`; review:
  `de89e478d8ddce62eac955708f1b87d7be1bd137`. Preserve 194 records/eight
  overlays and all earlier failures, including B04. No rescoring or policy changes.
- Consumers: `409449136ae1adc252ff6e205a6bb5785d113d0f`.
- Runtime: `c49d494dd5a36b19198680239a72e0c95cb90d8d` and
  `ee9d0c1fd24b33aa918154eb379a92c02cfe5925`.
- Accepted full baseline report: `6d5cf6c640d87a5e427049d329eabf5c39136259`;
  package SHA-256 `ff230f2e9079cc843198533e412f836abb62e4ade63f4fa210b7269f7deb4eff`.
- Final artifact paths, relative to `tests/commands/yq-author-20260828/evidence-v4/`
  at the evidence commit: `SOURCE.tar` (2,713,600 bytes, SHA-256
  `e4e6880a3622952b153a8261fec007908e1495584abf705ba2b150e95badcedc`) and
  `package/virtual-bash-0.0.0.tgz` (782,141 bytes, SHA-256
  `2942ba1f6982a2e217350bbbad420e93d43e9336324b6db8a3d1d88b5a7aee4d`).

Only this directory may receive repository edits. Never copy AGENTS files, execute
author scripts, evaluate product code, import XAN/private packages, use native YAML,
install dependencies, invoke npm lifecycle scripts, compile, or run global types.
No attempts to repair a denied workload, alternate routing, or retry are authorized.

## One bounded data pass

1. Authenticate this recipe and `admit-data.mjs` against `PRESEAL.json` and its
   separately routed digest. Inspect immutable Git write-sets and exact blob maps;
   composition is baseline plus accepted interpreter plus seven explicit additions,
   never an assumption that source-commit ancestry is the selected tree.
2. Verify the accepted selected bindings and the consumers recipe seal before
   importing its read-only guards. No framework code is copied or changed. Read
   runtime schema/import-fence as immutable text only; never invoke its executor.
3. Check raw artifact hashes before parsing. Require USTAR headers, checksum,
   bounded sizes, canonical relative ASCII names, zero padding, regular type `0`,
   mode 0644, no links, duplicate paths, path-prefix conflicts, unexpected metadata,
   traversal, node_modules, private additions, or AGENTS.md at any path component.
   Finding AGENTS stops before any extraction, with the exact entry reported.
4. Independently bind all 279 author-manifest selections to immutable Git blobs:
   273 non-test archive entries, with six selected test-data files never executed.
   Verify the consumers' exact 264-file source base plus seven additions (271).
   The archive additionally includes baseline `package-lock.json` and
   `scripts/typecheck.mjs`; these two are not hidden in the 271-file guard profile.
5. Verify every file of the accepted 846-file package map, including baseline README,
   and exactly four outputs per new TypeScript file. Only an exact map equality
   can establish 846 + 24 = 870. Record bytes, modes, directories and entry hashes.
6. Serialize source USTAR independently from selected Git blobs, using authenticated
   archive order, 0644, uid 501/gid 20, uname kjopek/gname staff, mtime 946684800,
   libarchive numeric-field spelling, checksum and two zero terminator blocks.
   This is independent data serialization, not independent compilation.
7. Serialize package USTAR from verified author-emitted bytes and authenticated
   entry order: 0644, omitted uid/gid/names, npm epoch 499162500, npm numeric-field
   spelling and two zero blocks. Perform exactly one gzip attempt using Node zlib
   level 9/default strategy/memLevel 8/windowBits 15, mtime zero and OS byte 255.
   Record byte equality or mismatch without retry. Even byte equality proves only
   independent serialization of author outputs, NOT independent source-to-JS proof.
8. After all data-map checks succeed, copy authenticated raw artifacts as regular
   files into one unique canonical `/private/tmp/yq-candidate-admission-35da1854-*`
   directory. Materialize the 273-entry archive, the explicit 271-entry source
   profile, and the full 870-entry package. Copy/rename source and package staging
   directories physically outside the workspace; no symlinks/hardlinks, 0755
   directories/0644 files, no overwrites. Keep evidence outside these trees.
   Compare complete membership/modes/bytes before/after, including new entries.
   These are data copies and movement facts, not enrolled import capabilities.
9. Emit schema-exact source/full consumer receipts, separate expected raw hashes,
   a `BOUND_AUTHOR_BUILD` provenance receipt and pending runtime bindings. Validate
   shapes/map construction and attempt read-only source admission only. Record any
   actual guard rejection; do not alter candidateCommit, invent a composition Git
   commit, set rootAcceptedComposition true, or call a rejected recipe accepted.
10. Run only bounded synthetic data-path/header rejection checks and syntax checks
    of this worker's script. Record zero product/build/compiler/native-YAML counts.
    Atomic explicit-path commits seal recipe, then results. Publish readiness at
    `/tmp/yq-candidate-admission-ready.txt`; stop awaiting root's next route.

## Known pre-pass compatibility gaps

The frozen consumers `authorizeSources` enumerates all selected roots at
candidateCommit. Source commit 35da1854 contains unrelated paths/root changes and
an unselected YQ DESIGN.md; therefore its whole tree is not the authorized source
composition. Receipt shape compliance cannot fix this. Root/framework coordination
is required; no guard API change or alternate Git identity is authorized here.

The candidate adapter statically imports `node:timers/promises`, absent from the
frozen runtime import-fence allowlist. This is a real deferred execution blocker,
not permission to patch the fence or change the workload. Consumer allowedBuiltins
will enumerate only observed literal dependencies of the bound module closure.

## Deferred independent build/reproduction

Require root's accepted complete executor/admission/source binding preseal first.
Authenticate the Node/TypeScript/Node-types/undici-types pins from consumers
SELECTED.json, copy those regular tool trees outside the source/package trees,
and check tools and the 271-file source tree before/after. Future direct command:

```text
PINNED_NODE PINNED_TYPESCRIPT/lib/tsc.js --project SOURCE/tsconfig.build.json --outDir FRESH_OUTPUT/dist --typeRoots PINNED_TYPES/types
```

Run in SOURCE with empty lifecycle hooks, no workspace source fallback, no symlinked
node_modules, and fresh independent outputs. Baseline tsconfig/build config and
all source inputs remain byte-identical; capture exact command/environment/tool
hashes. An out-of-tree outDir changes relative source-map paths: preserve all raw
compiler outputs, then explicitly rebase only each map's single `sources` element
to the relative path from its package `dist/...` directory to its bound `src/...ts`
input, retaining every other map field and compiler JSON serialization. This
declared relocation normalization is not a claim of raw compiler-byte equality;
if the shape or any other byte differs, refuse rather than repair product output.
Match `.js`/`.d.ts` raw bytes and the explicitly relocated `.js.map`/`.d.ts.map`
bytes to the sealed expected package map, then use the sealed USTAR/gzip serializer.
Copy baseline README/package metadata byte-for-byte. Target archive/package hashes
are the two exact hashes above. This compilation and independent package provenance
are PENDING; reproducing author bytes now does not discharge either requirement.

Loaded-code controls, declarations, CARRY instrumentation, parent jq regressions,
and the one bounded different-agent YAML review remain future work. Direct module
and declaration paths never imply root/package export integration. Author 26+19,
typed build and moved controls remain author claims, not this worker's passes.
