# Publication and process accounting

Date: 2026-08-29. Additive publication record; READY-SEAL.json remains unchanged.
All native cases and actual entry execution remain UNRUN. No actual output root,
runtime GO, approval request or private/production work was created.

Known-start ledger, including tool shells and exec replacement semantics:

| Tool session | Known OS starts charged | Roles |
|---|---:|---|
| instruction read | 2 | shell, cat |
| initial capture/bootstrap refusal | 2 | shell, mkdir; failure before metadata children |
| captured bootstrap correction | 5 | shell, cat, three Git metadata children |
| retained mechanism read | 3 | shell/exec-reader, pipeline builtin fork, Git batch |
| admitted owner-source display | 1 | shell exec-replaced by reader |
| patch / controller syntax / prepare | 12 | shell exec-replaced by controller, editing tool, syntax controller, nine module-syntax children |
| prepare-result read | 1 | exec-reader |
| precontrol correction/archive/hash | 6 | shell, two copies, editing tool, hash, stat |
| control seal field read | 1 | exec-reader |
| fatal-stop/publication correction/hash | 4 | shell, editing tool, hash, stat |
| reseal and controls | 4 | shell exec-replaced by controller, editing tool, two literal fixture children |
| result read | 1 | exec-reader |
| this publication | 2 | shell, editing tool |
| explicit add / diff check / commit / scoped commit identity | 4 | four exec-replaced Git roles |
| Total including remaining publication roles | **48** | finite known-role accounting, not universal host census |

Three controller Node images executed: syntax, prepare, controls. Nine separately
captured syntax children and two harmless lifecycle children completed. No second
controller seal run was needed. All eleven children are retired; lifecycle raw
rows establish exit, close, and absent group. The ledger's final active1 is its
controller owner, whose enclosing tool returned; it is not an outstanding child.
Known peak3 includes metadata pipeline overlap; control process graph peak2.
Editing-tool internal exec replacement is not counted as an additional process;
this is explicit known-role accounting, not an OS process census or enforced quota.

The ready snapshot is 193115 bytes. Its exact file inventory is in READY-SEAL.json;
in-flight control stdout/stderr and this later publication record are explicitly
outside that snapshot, retained separately. Controls completed with exit0 and
empty aggregate stderr. Capture/work remain far below 64MiB/256MiB. Executables
were stream-hashed, not copied into this scope.

Fixed preparation expiry is epoch milliseconds1788008309971.145, derived from
the original capture birthtime +1200000; no correction reset it. Final commit
checks this deadline again. Future actual issuance/expiry remain PENDING, and
600s/64-start/peak6 figures remain proposals only.

Exact executable preseal:
`b082c051f1e1599af1a5789786c20a6d89d882dda67b6d2430062c84779bf901`.
Control result:
`3d19d225fed8f5dcc4288fa77978ba79a999fd1031c2129f09030a66e4e278a1`.
Ready snapshot seal:
`7cad2e981d9008e90f64bc04d528ecc9da02458bd46859382d1028020c925b47`.
Prospective command-string:
`256789485b602f9f11f5414f45d33516ecc72d26abf08fe6e4a0dfbded7774e4`.

ROOT's host-API atomic publication policy is recorded, not implemented here.
Initial PIPESTATUS and local type remain native-adjudication questions. No claim
of GNU5.3 execution, full Bash parity, native signal/Promise equivalence, F05
creation-time proof, or complete ordinary-command-substitution source coverage.
