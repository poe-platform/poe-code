# Preparation and execution attempts

2026-08-27, initial preparation: `git show` of CASE_MATRIX at accepted product
commit 21220b465537bf45ffcfb36740956a69f43bf75e failed because this later evidence
file is not in that commit. No generated freeze was created by that failed attempt.
Corrected authentication uses the matrix's own evidence commit
6580859f176b3fc172b78a42f50a339576744190 separately from accepted product source.

2026-08-27, initial policy-only check: 14 category-selection controls and 517
admission controls passed; original ten mismatch records were preserved exactly.

2026-08-27, initial runtime attempt: accepted archive compilation completed, then
a runtime-driver subprocess exited by SIGSEGV (status null; stdout and stderr both
empty), PID 32909, Node v22.22.2. The parent verifier failed with status 1 and removed
its own `.scratch-accepted-cb5J77` directory in finally. No runtime capture was
published. Because the failed driver emitted no output and prior successful child
results were not published after the failure, this attempt establishes no runtime
case pass count. It is not silently dropped.

A separate minimal startup probe, with no product imports, ran the absolute Node
executable with `-e 'console.log("node startup ok")'`. Its complete environment was
PATH=/usr/bin:/bin and LC_ALL, LC_CTYPE, LC_COLLATE, LANG all set to the tested name:

| Ambient name | Status | Signal | stdout | stderr |
| --- | --- | --- | --- | --- |
| en_US.UTF-8 | 0 | null | node startup ok plus newline | empty |
| deliberately-invalid.UTF-8 | null | SIGSEGV | empty | empty |

This independently reproduces an invalid-ambient Node startup failure; it does not
diagnose libc/Node internals. The corrected run replaces only the second HARNESS
ambient name with C, retaining en_US.UTF-8 as the first. Invalid locale values are
still present in explicit command-context controls, with the same expectations.
Original product source, argv, scalar counterfactual profiles and worker limits
are unchanged. This is a disclosed host-fixture correction, not unchanged-input
acceptance. No invalid-ambient runtime acceptance is claimed.

Corrected runtime capture completed successfully under ambient en_US.UTF-8 and C.
Per process: original ten refusals retained, nine C.UTF-8 scalar counterfactuals,
nine accepted-source runtime controls, and three descriptor validation controls.
See CORRECTED-RUNTIME-CAPTURE.json for exact tuples and VALIDATION.md for scope.
