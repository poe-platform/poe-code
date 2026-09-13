# Chart crossing CLI regression

Ownership: the original `packages/safe-bash/tests/commands/pptx/chart-crossing.test.ts`
and this plan. Root owns SDK fixes, shared registration and commits.

Run quoted `pptx charts set --objects` updates through the injected virtual shell
using an original memfs package. Independently inspect output XML to verify that
value-axis crossing edits affect the linked category axis, preserve the value
axis's own crossing marker, initialize custom crossing at zero, preserve an
existing negative coordinate and clear a coordinate with JSON null. Reopen the
chart through the public model to check custom mode and the nullable coordinate.
Verify that binary stdout publication leaves the input bytes untouched.

Register exactly `tests/commands/pptx/chart-crossing.test.ts` in
`packages/safe-bash/scripts/integration-inputs.test.mjs`; that file contains
unrelated edits and remains root-owned. No downloaded fixtures or host product
I/O are used. No documentation or product branding changes are needed.

Validation: run the focused Node test file before the fix, rebuild the maintained
selected pptx workspace closure after the fix, then rerun the file. Root runs the
integration registration guard and maintained lint/type checks. Do not execute
the full pipeline, commit, push or release from this worker.

Red receipt: the focused Node route ran three cases in approximately 0.7 seconds.
Existing negative-coordinate retention passed. Custom initialization failed
because independently read XML had no numeric crossing (`undefined` versus
`"0"`). Clearing the coordinate removed the XML marker but model readback
returned automatic mode instead of custom mode. Both failures reproduced before
the root-owned fix was built.

Green receipt after root reported the maintained pptx build closure passed:
`node packages/safe-bash/scripts/test-reporting.mjs --import tsx --test-concurrency=1 packages/safe-bash/tests/commands/pptx/chart-crossing.test.ts`
passed all three cases in approximately 0.5 seconds. An initial reporter
invocation omitted `--import tsx` and failed module resolution before tests;
the corrected maintained reporter invocation above resolves TypeScript helpers.
Scoped whitespace verification passed. No maintained file-specific ESLint route
was found: the root guard rejects file operands and package lint checks package
metadata. Root retains lint/typecheck ownership.

No screenshot was taken: this change affects numeric chart XML and model
readback; these tests publish binary stdout and introduce no visible CLI text,
help or layout change. This verifies command behavior, not rendered chart
appearance. Visual chart QA remains outside this bounded regression.
