# G09 author harness correction, not a product/expectation change

Original ten-group run at /private/tmp/unified76-inherited-author-9algcW:
9 PASS / 1 FAIL / 0 unexecuted, retained unchanged in RUN-V1. G09 performed one
admitted direct Git setup read, then failed before the bare-name authority map.
It incorrectly looked for `scopeInputs[].sha256`; the fixed profile binds Git
`blob`, `bytes`, `mode`, `path` instead. Expected was undefined. This is an
author-harness schema error, not an adapter or frozen-helper failure.

Correct comparison: exact length and Git SHA1 of `blob <length>\0` plus content
against the existing fixed profile entry. No expected bytes, input, candidate,
helper or shipping source changes. Preserve all original failure records.

Before focused execution, seal corrected harness and binding. Execute ONLY G09
in one fresh root/worker, maximum60s/1MiB per stdout/stderr, at most four exact
previously authorized Git reads with5s/2MiB each. Do not rerun the other nine
groups or infer a fresh ten-group result. Add pre-dispatch and post-dispatch
receipts in the new root so a failed assertion cannot erase Git telemetry.
No full prerequisites/private checks/copy/A10/gate. Existing authoring/control
authorization is used for this bounded harness correction, not old gate GO.
