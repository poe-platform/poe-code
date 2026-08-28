# Data verification and authorized reproduction

The default audit is data-only and never imports product code:

```
node tests/shell/cd-prerequisite-independent-20260828/review-4641075d/archive.mjs --verify
node tests/shell/cd-prerequisite-independent-20260828/review-4641075d/verify.mjs FULL_FINAL_REVIEW_COMMIT
```

`composition.json.gz` holds every byte/mode/blob/source commit of the265 selected
source/build files. `TREE-PROOF-FULL.json.gz` authenticates raw Git commit/tree/path
proofs, including the composed root and candidate/provider/regression provenance.
These selected inputs can be reconstructed without loose source Git objects.
`baseline-runtime.ts.txt.gz` supports the unchanged-member comparison. Unselected
repository subtrees are opaque references, not a whole-repository archive.

`ARCHIVE.json` describes bounded16MiB compressed parts and the index hash.
`ARCHIVE-INDEX.json.gz` records every directory/file/mode under the eight owned
scratch roots. The gzip parts concatenate into a framed stream of unique blobs;
each frame declares SHA-256 and size and contains the exact bytes. The streaming
verifier checks all parts, frame boundaries, blob hashes, membership and references.
Duplicate bytes are stored once; no file, cache, failed attempt, fixture, tool,
package, source copy or consumer content is omitted. This is data, not canonical
TypeScript test input. Source/module load receipts and raw child commands/env
configuration are retained in those trees.

Only after a **separate explicit ROOT authorization**, exact historical scratch
can be restored, without product execution, using:

```
node tests/shell/cd-prerequisite-independent-20260828/review-4641075d/archive.mjs --restore ROOT_AUTHORIZED_REPLAY
```

Restoration refuses existing scratch roots, preserves recorded modes and checks
the full restored inventories. It intentionally changes the clean live membership;
do not rewrite the final manifest to hide that addition. Use an authorized isolated
copy or remove the restored scratch after its own durable evidence seal.

Do not blindly rerun historical drivers: they deliberately reject existing output
paths and their raw configs contain original absolute paths/result destinations.
For a fresh actual replay, ROOT must assign a fresh output scope and version the
route/output-path adaptation before execution. Restore the pinned tools and exact
composed source, rebuild with its unchanged tsconfig, npm pack/install offline with
distinct empty user/global configs and scripts disabled, then physically move the
installed consumer. The executed runner bodies are run-v2, continue-v3, fixtures-v3,
entry-v2 and types; final actual import negatives use full-load-entry/controls.
Keep original cases/type fixtures unchanged and keep L24's scripted qualification.
Use fresh copied consumers and recompute absolute-path allowlists from their exact
inventories; never resolve to live src/dist or overwrite recorded result paths.

The two source mutants and20 existing regressions are specified in
`AUXILIARY-PRESEAL.json` and executed by auxiliary/aux-entry. They are separate
from86 public rows and actual load negatives. No baseline product, native28,
author87/239/42, remote service, SafeJS or full-gate replay is necessary to audit
this evidence, and none is authorized by these instructions alone.
