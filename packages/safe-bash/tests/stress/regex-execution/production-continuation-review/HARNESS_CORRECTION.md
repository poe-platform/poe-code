# Preserved baseline harness assumption correction

The first baseline public.json remains immutable. Its registration/invalid-options
case incorrectly expected `agentCommands(options)` to validate synchronously.
Inspected public implementation creates the definitions during plugin setup,
which Shell.use schedules on its ready promise; invalid policy is observed by
awaiting exec, not by constructing the plugin descriptor. This was a verifier
assumption defect, not evidence that maxWorkers=0 was accepted by execution.

The corrected test awaits a no-op exec to ensure valid plugin setup really ran
without constructing a Worker, and awaits invalid-policy exec rejection. Its
rerun is public-corrected.json. No command byte expectations, cleanup assertions,
native fixtures or historical evidence changed. The other original public case
failures (rg early downstream and active benign caller abort) remain meaningful
cleanup failures; do not erase or relabel them.

## Native walker metadata qualification

native-walker.json retains the helper's top-level `cwd`/`files` for its initially
created shared ordinary-glob tree. That tree is unused by the two walker oracle
executions. Each observation's own cwd is the executed directory, populated from
the corresponding frozen walker-cases.mjs files. The helper source shows the
separate per-case creation and actual spawn cwd. native-walker-fixture-readback.json
independently reads those exact directories back and compares their contents to
the frozen cases. All five case files match. This qualification corrects metadata
interpretation only; no native command result or expected output is rewritten,
and no new oracle execution is represented as the original capture.
