# Focused v2 review: finite DATA preseal

2026-08-28. Different review of Locke's document/data candidate
`82aae2f5bff404423e81ddb6ddfacb6e0abd35a9`, after its creation and ROOT D1–D3
ratification. This does not authorize implementation or actual experiments.

## Fixed inputs

Candidate subtree:
`tests/commands/node-design-20260828/worker-resource-quiescence-proposal-v2`.
Required complete-body SHA256 values supplied by ROOT:

- HANDOFF.md: `6041fe928927ffc672075a5fbbdfb38b0360b8af750e6ce184d57d0884208682`.
- SEAL.json: `afeeb6c6aa42577b9e7e0e7ebd682cf0ace17e09c54368a1c2d1101cc097b7a4`.

Read candidate Git commit and NUL-delimited exact path/mode/blob inventory, and
authenticate all12 packet bodies before drawing dependent conclusions. Inspect
the seal's pinned inputs and cross-check the exact28 typed FS codes against its
pinned contract bytes. The previous37 public source-body checks remain the earlier
review's authenticated DATA result, not new function/engine execution. No private
checkout or unaccepted moving-HEAD product input may enter the proof.

## Admission and limits

At most three serial Node DATA-only processes, peak one, at most five minutes total
execution; at most16MiB captured output and64MiB logical processed bytes. Per input
read at most2MiB, decoded data at most8MiB; no symlink inputs/outputs or directory
traversal outside the named repo inputs. Processor:
`/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node` (not requalified as an engine).
Only fs/crypto/assert/JSON data operations; no dynamic subject imports, compiler,
Worker, VM/eval, native oracle, network/provider execution, installation or private
access. Git reads and explicit-owned commits are development bookkeeping, not
subject launches. All captures use fresh filenames; preserve failures.

## Declared checks, not runtime scores

1. Candidate commit/object membership, required hashes, all sealed outputs and
   bounded pinned-input bodies. Report any unauthenticated reference distinctly.
2. F1–F7 and D1–D3 disposition coverage; exactly28 FS codes and exactly eight
   unchanged WRQ-to-L identities. No passing an obligation from its presence.
3. Fixed SAB offsets/alignment/arithmetic, frame/sequence/epoch bounds, legal
   upload/response/ACK transitions, frame precharge arithmetic and counter ownership.
   Arithmetic contradictions are design findings, not observed Worker failures.
4. Manual source/DATA review of admission/cutoff, original-descriptor and cache
   identity seams, delivery/error precedence, actual exit plus parent cleanup,
  5s admission timer and unobserved continuation distinctions.
5. Return exact residual blockers and a minimal future experiment preseal proposal.
   No model implementation, real Worker or engine run is included. Do not duplicate
   Raman's private-ABI work or touch the frozen apply_patch author candidate.

Only `tests/commands/node-worker-independent-20260828/v2/**` is written for this
continuation. Existing review/historical artifacts remain unchanged.
