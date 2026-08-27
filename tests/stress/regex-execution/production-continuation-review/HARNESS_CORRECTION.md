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
