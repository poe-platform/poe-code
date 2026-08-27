# Preserved first preparation failure

Control freeze `04ed66216afd0245238b8d125c5e8651d279a78b` preceded all execution.
The first independent run is immutable under `evidence/` and `run.stderr.log`.
Actual canonical discovery found ten tests; all ten failed the shared before-hook
with `Tool symlink escaped the explicit tool tree`. No behavioral body, tamper
control, or retirement mutant executed. The subprocess exited naturally; owned
scratch was removed. This is not ten runtime regressions and not acceptance.

The review preparer's `cpSync(..., { recursive: true, dereference: true })`
produced four `.bin` symlinks pointing to the original checkout's tools. An
independent tools-only copy reproduced those exact escape paths, retained in
`evidence/tool-copy-forensics.json`. Content hashes alone did not distinguish
these links from regular files. The unchanged author's containment check
correctly rejected this improperly isolated preparation.

Only the review-owned preparer changes: recursively materialize regular bytes
and modes, require every resolved source to remain inside the explicitly supplied
tree, and assert that every destination entry is not a symlink. Candidate source,
tool byte expectations, canonical/probe/helper, scenarios, outputs and all
acceptance/negative assertions remain unchanged. The second attempt uses new
`evidence-attempt-02/` and `.work-attempt-02/` directories; nothing is overwritten.
The control binding now selects the commit containing this runner revision,
rather than the unchanged original FREEZE.md, and authenticates all eight frozen
files against that explicit commit before any second execution.

This is an owned review preparation correction, not a product or author-harness
change. No approval to alter any readonly path is requested or assumed. This
correction and the failed first attempt are committed before rerunning.
