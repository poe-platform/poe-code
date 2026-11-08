# Independent Worker design review: finite DATA preseal

2026-08-28. Post-proposal and post-ROOT-selection, before this review's DATA
checks. This is not a pre-author freeze or executable-provider qualification.

## Inputs and ownership

- Author `53e5bffd5e808b198cfda2ff3a5cedccf88990e9`, proposal subtree
  `tests/commands/node-design-20260828/worker-resource-quiescence-proposal-v1`.
- Additive ROOT selection `700651e5ec6f50435a0298845c411a8f2a5a386f`, its
  `root-selection-v1` subtree. L retirement selected; original NP1 and Q remain
  unproved/not selected respectively. Neither is rescored.
- Archived public SafeJS commit `bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`:
  `tests/commands/node-provider-experiments-20260828/PUBLIC-SOURCE.json.gz.base64`,
  338073 encoded bytes, SHA256
  `9723f42cc9f01e3dff7c3ad8705538f99cbdc1c507a2d0699a4575ecb4a227ec`.
- Source manifest in that directory: SHA256
  `a670629995f8cb7331a5e24d35ad4bb185dc0fbe5f70de8281598de615cd35b1`.
- Only this independent subtree may be written. No private repository read,
  extracted engine files, production import, Worker, compiler, VM, subprocess
  oracle, native fixture, network service, or apply_patch candidate changes.
  Primary public documentation retrieval is source research, not execution.

## Finite admission

At most three serial, harmless Node DATA processes (peak one), each bounded by
the tool timeout and an internal elapsed check; total admission at most five
minutes. No child creation from these processes. Node is only the JSON/hash/gzip
processor, never an engine/module loader. Node binary path:
`/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node`.

Per-file encoded read at most 2 MiB; gunzip output at most 8 MiB; cumulative
logical processed data at most 64 MiB; combined captured output at most 16 MiB.
Source excerpts are bounded and remain stdout evidence, not loose source copies.
No symlink inputs or outputs; known files only. Git read/explicit-owned commit
operations and shell source inspection are development bookkeeping, not subject
children. No authorization for any real Worker/engine/guest process follows.

## Declared checks and outcomes

1. Discover archive JSON structure as inert data; report only keys/counts.
2. Authenticate fixed input bytes against committed blobs, archive manifest,
   public Git object identities/membership from byte/NUL tree records, all
   declared 37 function-body bindings and their member hashes. Any mismatch
   stops dependent conclusions; preserve the failing capture.
3. Check SAB arithmetic, finite sequence/frame/epoch limits and exact bijection
   of eight WRQ inputs to eight L obligations. These are arithmetic/binding
   checks, NOT an implemented protocol or semantic passes.
4. Read bounded source excerpts for bridge copying/errors, job completion,
   cancellation and cache identity. Compare against primary Node/ECMA docs.
5. Classify static adversarial schedules: stale/reused slot; response/cancel
   race; payload admission across cutoff; async ACK blocking sync; undelivered
   rejection; exit before parent cleanup; copied callback argument before
   validation; inherited/hostile-field input. Report missing proof, not model
   acceptance as actual implementation evidence.

The final review must recommend exact remaining ROOT choices, the smallest
useful profile, and proof obligations. No implementation or runtime acceptance
can result from DATA checks. Preserve original private-ABI experiment history;
Raman owns that separate review.
