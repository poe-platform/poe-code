# Reconstructing the temporary v2 candidate

Run from `/Users/kjopek/Workspace/safe-bash` with the existing authenticated Node
and development tooling. The existing Codex `apply_patch` command must be in
PATH; no install or global build is needed. The restored source is never read
from the live product checkout. Inputs are the immutable v1 directory's baseline
archive/source patch and this directory's v2 patch, frozen author data and
handoff. Do not modify the v1 candidate or either evidence directory.

The exact materialization and execution commands are preserved inert in
`RECONSTRUCTION-commands.sh.data`. They use `apply_patch` to materialize the
script under the owned temporary prefix, then run that temporary script.

Choose a fresh owned script filename if the example filename exists. The script itself uses
a unique owned mkdtemp directory for its candidate. It validates archive names,
verifies the baseline and exact intermediate v1 source/test/compiled identities,
applies only the new source delta, adds the frozen author fixture, then verifies
the final 213-source/15-test/708-compiled identities and all 358 actual compiler
inputs. Candidate paths are normalized through realpath only for relocation;
file content hashes and relative path identity are still required to match.
It leaves the reconstructed candidate read-only and prints a proof containing
its import location and a bounded author replay command. The recorded successful
execution is `reconstruction-proof.json`; raw command/result/closure evidence is
`runs/reconstruction-r1.json`.

The primary already sealed import is:
`/tmp/safe-bash-owned-output-direction-prototype-PMLamJ/candidate/dist/index.js`.
The alternative contracts import is the same candidate's
`dist/contracts/output.js`. Root must still wait for actual author CLOSED before
independent execution. The reconstruction proof is not independent review.

## Preserved harness corrections

The first direct reconstruction reached the compiler-input comparison and
failed because TypeScript emitted `/private/tmp/...` while the harness only
normalized `/tmp/...`. The exact original script is `restore-v2-r0.mjs.data`.
That first tool output was truncated and was not saved as a full raw file; the
unchanged script was therefore replayed with bounded raw capture.

The first captured attempt (`runs/reconstruction-r0-path-failure.json`, retaining
its original label) actually failed earlier with `spawnSync apply_patch ENOENT`:
the existing product supervisor intentionally uses PATH `/usr/bin:/bin`. This
is an execution-environment mismatch, not a source or product failure. Nothing
was changed in the product supervisor or test fixtures. Supplying the existing
author PATH for reconstruction alone produced the expected canonical-path
failure in `runs/reconstruction-r0-canonical-path-failure.json`.

`reconstruction-harness-r0-to-r1.patch-data` changes only the reconstruction
script's path normalization to compare realpaths and relative candidate paths.
The successful attempt uses the same declared existing author PATH, recorded
in its raw JSON. All actual input hashes and both compiled manifests match.
These corrections do not earn product source-fix credit or add author cases.
There is one focused product source refinement, zero author fixture corrections,
and one separate reconstruction-harness correction round.

No failed scratch copy was deleted or reused as an unauthenticated source.
All synchronous reconstruction children are reaped; the successful proof lists
their command, PID, exit status and absence after reap. Supervised attempts each
record normal close with no residual group. Failed and successful scratch
candidates are retained read-only at final seal.
