# Opt-in independent Stage 1 cancellation review

Start with REPORT-v1.md, RESULTS-v1.md and BUGS-v1.md. Product source is read-only.
Fixtures use `.ts.data` and explicit `.mjs` drivers: this historical candidate
review is not a current canonical test or a broad TypeScript exclusion.

From repository root, verify raw object/complete changeset proofs without Git
object lookup:

```sh
node tests/shell/cancellation-stage1-independent-20260827/path-proof-v1.mjs verify
```

Replay from the original sealed source; use a NEW output label each time:

```sh
node tests/shell/cancellation-stage1-independent-20260827/review-v2.mjs replay replay-local-01 tests/shell/cancellation-stage1-independent-20260827/evidence-v1/seal.json
```

Prerequisites: local Node (recorded v22.22.2), `node_modules/typescript` (recorded
5.9.3), Git for current status/index metadata only during replay. Runtime and
compiler are regular-copied into the owned output scratch directory; emitted
artifacts and all scratch are removed after evidence sealing. No install,
network, native semantic oracle, TSX, @types/node or private engine is needed.
Replay uses sealed helper bytes, not live source or candidate loose objects.

Output directories refuse overwrite. Original evidence manifests verify bytes
AND membership including newly appended entries; the manifest itself is omitted
from its own recursive list. Parent-directory manifests bind that file. The
versioned reports and final manifest are sealed separately after captures.

`evidence-v1/` is the original red capture. `evidence-v2/` is a repeat with copied
compiler-input membership checks. Do not delete or rewrite either to claim a
pass. Counterfactual copies are validation products only. Runner completion exit
0 is NOT a candidate pass: expected candidate TAP is 10 pass, 2 fail out of 12.

`commit-pathproof-v1.json` contains raw commits, parents and changed-path trees;
unchanged entries are authenticated by identical Git tree IDs. `seal.json`
contains reachable original fixture/helper blobs with per-object SHA-256. Neither
claims to reconstruct an entire repository or all history. All source references
in findings are to the pinned candidate, not concurrent live root work.
