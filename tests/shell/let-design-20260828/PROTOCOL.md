# LET native characterization v1 — pre-execution

Design-only leaf work. The accepted composition is baseline
`5137a74ec855a32d8a8860eb66b62eb44d11e290` with only the runtime blob from
CD `4641075df5355a91c83bf5b2cc3a88dfaf1f5153` (qualified acceptance reported
by root via `192ab78b`). Its whole commit contains unrelated concurrent work;
it is NOT the selected production composition. No product is imported or run.

Exactly 28 ordered native observations N00–N27 from CASES.json, one invocation
per row, no retries. This is an exploratory pre-implementation dialect protocol,
not a product pass/fail cohort and not a freeze of nonexistent LET outputs.
All scripts and observation topics are sealed before the first Bash execution.
N22 describes an excluded native array capability, not proposed parser scope.
N20 characterizes synchronous shell exit control, NOT asynchronous caller abort.

Use the previously qualified GNU Bash 5.3 binary with SHA256
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
No version probe precedes sealing: N00 records the actual version. Each child
uses `--noprofile --norc -c SCRIPT let-native`, empty PATH, C locale, UTC,
empty owned HOME/TMPDIR, empty ENV/BASH_ENV, and no inherited environment.
Only Bash builtins and bounded synchronous subshell/command substitutions
appear in the scripts. No network, credentials, filesystem writes by scripts,
product loads, external command execution, install or private repository access.

Supervisor: pinned Node 22.22.2, one native child process group at a time,
5-second per-row deadline, 16 KiB combined stdout/stderr ceiling per row,
at most 448 KiB captured native bytes. Deadline/output overflow is an admission
failure: terminate the group, wait for close, retain partial observations, STOP.
TERM is escalated to KILL after 250 ms if necessary; close/reaping is required
before settlement. Finite scripts have no background jobs. Record child PID,
exit/signal, byte counts, exact base64 bytes and UTF-8 views, elapsed time,
natural/forced closure, and post-close process-group absence. Subshell descendants
are Bash-managed; group absence is evidence of no surviving descendants, not a
count of every historical fork. Ordinary native nonzero exit is an observation,
not grounds to retry or discard. Unexpected spawn/error/integrity/cleanup failure
stops the run with explicit unexecuted rows.

Verify regular files/modes/hashes for binary, manual, Node, Git and every recipe
file before and after the run. Source bindings identify immutable Git blobs;
there is no live-source fallback or whole-checkout/history proof. Protect the
native executable on every row. Create the result directory exclusively to
prevent accidentally rerunning v1. Emit each row durably before final integrity
qualification. Empty HOME/TMPDIR must remain empty. Original source inspection
preceded this protocol; no LET implementation was inspected. Pre-code refers
only to the future LET implementation, not the existing arithmetic engine.

Future independent arithmetic/cancellation/resource controls are design output,
not executed native claims. No GNU diagnostic-parity promise, async preemption,
default plugin-count increase, native/full-gate acceptance, or runtime change.
