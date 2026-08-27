# Opt-in immutable Stage 1 repair review

Read REPORT-v1.md, RESULT-v1.md and DOC-CLARIFICATION-v1.md. All writes belong only
to this new repair-fbbe1ef7 subtree; the prior independent directory is read-only.
Historical `.mjs` controls run explicitly, not as current canonical product tests.

Verify both evidence versions, raw Git identities and the layered complete file
membership (including additions), without looking up candidate Git objects:

```sh
node tests/shell/cancellation-stage1-independent-20260827/repair-fbbe1ef7/verify-v1.mjs
```

Replay from sealed committed source using a NEW output label:

```sh
node tests/shell/cancellation-stage1-independent-20260827/repair-fbbe1ef7/run-v1.mjs replay local-replay-01 tests/shell/cancellation-stage1-independent-20260827/repair-fbbe1ef7/evidence-v1/seal.json
```

Local Node (recorded v22.22.2), node_modules/typescript (recorded 5.9.3), and Git
for current live/index metadata are prerequisites. Replay needs no historical
loose Git objects. No downloads, native semantic oracles, TSX, @types/node or
private engine are used. Node and TypeScript are regular copied under output
scratch; original controls come from authenticated historical blobs. Scratch is
enumerated and removed; raw logs and manifests remain. Output overwrite is refused.

The sealed append manifest describes the committed review artifact. A new local
replay directory intentionally changes that membership and the complete artifact
verifier will detect it. Do not rewrite the old manifest or exclude arbitrary
new files to make that check green. The ONLY exclusion from the OLD independent
layer is repair-fbbe1ef7/; the new layer is authenticated completely, excluding
only its own recursive manifest entry. Old verifiers and manifests are untouched.

Original driver review-v2.mjs is unchanged. New run-v1.mjs/archive-v1.mjs adapt
candidate pin, output paths, raw-object binding, layered preservation, nearby
cohort and two repair counterfactuals. They do NOT edit the original three control
files. control-binding.json contains both original control and driver hashes.
FREEZE-v1.md and history-before-v1.json were committed before repair-body reading.

Author history is not independent coverage. Repeated isolated/moved/replay modes
are not added together. No global gate or Stage 2 integration is authorized.
