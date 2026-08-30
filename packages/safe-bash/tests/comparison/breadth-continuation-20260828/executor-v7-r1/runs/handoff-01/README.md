# Author handoff — review required, no admission permission

Candidate **230ed3c6e15617b312760367adf9ede4e5c7ff6a** binds the complete
successor. Recipe SHA256:
`05aa8dce295c507fd605c93aa113ba2ecd5605064dc0f6dfe3a20aa6dc6bf04d`.
Interface SHA256:
`913d051875c60492cce06937ff33b85bb4c9b36085b79169d5e51e87852880c4`.
HANDOFF.json gives exact paths, raw results, controls, child receipts and limits.

Original one-shot V7 execution: **31/33**, 2 harness failures, 0 unrun; all
28 children reaped. Evidence d180c3e4 preserves 273 entries in a 210954-byte
bounded archive. G08 assumed 0644 instead of the immutable source projection's
0444; B16 confused the final report's integer child count with the terminal's
array. Neither is a product failure.

V7-r1 changes only that source-mode predicate; entrypoint relocation and shared
immutable modules are explicit in DELTA.json. Its presealed focused data run
qualifies **2/2 plus 12 negative controls**, with no child launches. B16 is
explicitly post-capture reconciliation of the authenticated original receipt,
not a rerun. Compose 31 original qualifications + 2 corrections, never rewrite
the original 31/33.

The report fix actually rejects CAPTURE_LIMIT/SIGTERM/natural:false even with
exit0/close0; actual observed/retained stdout is 65537/65536. Missing `failures`
refuses without escaping. Whole-body failure controls cover setup, registration,
persistence, tail, quotas, output/serialization, cleanup and sticky caught
bootstrap violations. Per-record/stream and combined out-of-store evidence
bounds remain strict; no old oversized record is relabeled as compliant.

The getter delegates nothing: exactly `module`, then `worker_threads`, returns
undefined and permanently revokes captured functions. Detached access is valid;
there is no caller-authentication or stock-Node-equivalence claim. Separate
existing Module imports/denials remain outside this narrow guarantee.

Next: different review by Archimedes against these exact successor bindings,
then a **fresh root grant** before launch.mjs may run admission. Product 67eab12e,
pack6608 and comparator3.4.2 remain unchanged. Actual engines/staging/C11,
native/private/network and 99 semantics: **zero**. Old V4/V5/V6 failures,
294045 irrecoverable V6 stdout bytes, report19/20→18/2 qualifications and W07's
UNQUALIFIED/UNCREDITED status remain unchanged. No full-gate claim.
