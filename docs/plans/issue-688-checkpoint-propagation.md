# Compression checkpoint propagation follow-up

## Validated problem

On September 10, 2026, the compression transform at remote main
`52a76cc880cbcc6088ccd5dc65b70e0a86c24b90` created a child abort signal without
inheriting its caller's registered cooperative CPU checkpoint. Actual Shell
execution eventually rejected an exceeded CPU budget, but only after publishing
the entire compressed output. This is delayed enforcement, not an unrestricted
successful budget bypass.

## Correction

Copy the registered checkpoint to the transform's child signal immediately after
signal composition. Preserve parent registration, absent-parent behavior, local
abort precedence, and exact thrown values. The helper remains internal; no public
barrel or Shell runtime change is needed. File-operation child signals must
inherit the checkpoint separately before passing their signal to this transform.

## Evidence

The identical 31-case regression suite changes from 28 failures and three passing
controls to 31 passes. Twenty existing codec controls and strict NodeNext types
also pass in authenticated scratch. Actual native codecs and Shell execution
stop at the next checkpoint after the first output write; below-limit executions
still complete. Falsey hook failures and caller cancellation remain distinct.

Evidence is retained in `/tmp/issue688-checkpoint-fix-OwlmL7/handoff.json`.
The three-file patch has SHA256
`615828fb737d20b52907284a4410dbbd4d8c1e3e1b90948e6e2d1d55318bdef0`.
Root verifies target preconditions and adds the exact maintained discovery path.
The admitted source, existing codec controls, and maintained discovery checks pass
173/173 actual cases in `/tmp/issue688-checkpoint-live-v1.log`; all three admitted
payload hashes match the authenticated handoff.
The preliminary merged full test is interrupted before admission; its incomplete
result is not a passing gate. Final merged checks and publication remain required.

This fix preserves cooperative between-step semantics. It does not establish
instruction preemption, universal latency bounds, or native compression-byte
parity beyond the recorded controls.
