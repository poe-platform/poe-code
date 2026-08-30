# V6 runtime admission: UNSAFE_STOP

One authorized attempt, `admission-v6-01`, on August 28, 2026. No retry,
permission change, fallback, semantic cohort, native run, or new engine execution
after the stop. This is an admission failure, not a product semantic failure.

## Authority and immutable inputs

- Root grant commit: `5ac29fefc1ac73e8ac2795a51bc81c43635c3a00`.
  GRANT.json SHA256: `d933f560b089abd29dbf5aa7af5253fb2de257f6306fe45100425cc8c1afef40`.
- AUTH commit: `1b08bc9c3b23ba9578e3659e2ec653ccd1b04bba`.
  AUTH.json SHA256: `5ab1ff02e9e52f517c2a2e43d478b3f61bdc13ad3885feb93680b43f467bf619`.
- Recipe `931b8e07114b8f69fa50f35e798a7a619f578cdb`, seal
  `937f5551b242c5388febd085aa18905095150f846c9e3005e766db7b39c979a0`.
  Accepted review `fb4ccfd95af9c3d3573d86c97826bed77605e370`, REVIEW.json
  `c86d2fd9e7cbfe2dbc0cf173cca1a4e2d453699ea4464144a6d4fa7011b049c5`.
- Exact candidate `67eab12e315054907ef4ef435c6bbca2f59e0c36`, whole pack
  `6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06`.
  Both interfaces, phase-plan hash, tools and exact command are in PREFLIGHT.json.
- 266 input bindings / 262 distinct paths authenticated before launch against
  immutable Git blobs; all 266 unchanged afterward. Six recipe namespaces remain
  append-checked, excluding only declared runs descendants. Preflight's 272
  synchronous metadata Git children are separately recorded, not admission workers.

## Actual disposition

3/14 planned workers launched; all three exited, closed and had absent PID/groups.
Target installed and physically moved probes qualified (2/3 probes). Each records
211 authenticated actual nextLoad sources, consumer evaluation, factory use,
worker-to-consumer and consumer-to-bare-package resolution. Moved origin is absent.
These are admission observations, not semantic workflow passes.

Comparator just-bash 3.4.2 (pinned, not a latest-version claim) records 21 actual
nextLoad sources, export/factory observations and one denied operation:
`process.getBuiltinModule("module")`. Its FD3 record sequence 47 is
`offline-denied`; the final resource report retains the violation. The frozen
offline guard throws `OFFLINE_DENIED` for this API, and the worker's violation
predicate requires exit 1 even though export/factory observations completed.
Coordinator then records `ADMISSION_PROBE_STOP` / `UNSAFE_STOP`.
This is not another package-self-reference failure or an unbound target load.
The receipt identifies the operation, not its precise comparator call stack or
the safety of permitting it. No permission was widened.

C01–C12 are all UNRUN; 11 remaining planned worker operations are unlaunched.
C11 setups = 0; semantic calls = 0. Required complete production-authority,
negative-control and C11 admission qualification remains unmet.

## Capture and closure qualification

All worker stdout/stderr were empty; complete FD3 captures are respectively
136251, 136171 and 20088 bytes, below 262144 each. No worker capture/supervision
failure, signal, pending resource, descriptor or late error was recorded.
Comparator's denied-operation violation remains a failure, not a cleanup leak.
Coordinator PID/group 94468 also closed, exited 1 and is absent.

There is a separate outer capture failure: coordinator emitted 359581 stdout
bytes by serializing nested probe reports in its fatal summary. The fixed 65536
capture retained that prefix only; **294045 bytes were not retained**. They are
not reconstructed. Coordinator stderr was empty. Full RESULT.json and every
worker FD3 capture were independently persisted and are retained byte-exactly.
The outer cap is not raised and the failure is not excused by RESULT retention.

## Post-run bindings and evidence

Original comparator closure: 3843 content files plus one metadata-only instruction
file, 4275 entries. Materialized views: target installed/moved each 860 files /
906 entries; comparator 3845 files / 4277 entries. All content, modes, exact
namespaces, tools and archive hashes remain intact. No instruction plaintext was
read or materialized. Target proof is exact accepted pack reuse, not a new build
or pack reproduction. Heap bounds are V8 old-space, not RSS; checked elapsed is
not hard preemption.

POST-AUDIT.json is a separately labeled post-only integrity/closure audit, not
new controls or admission qualification. EVIDENCE-MANIFEST.json binds 18 raw
members in raw-evidence.json.gz (1174849 bytes; SHA256
`4d48578eef41c7d9bfce10abf17fa3772a9cd47be04f351c325c6c57743c33ae`).
The archive expands to JSON with per-member path/mode/size/hash/base64 and was
round-trip checked; it contains no product tree or instruction plaintext.
Original local captures and staged trees remain untouched.

RESULT.json SHA256: `902e4643e0e4865daad215c7a7c0cd1285218a8714904169ccf70e18d3467cb2`.
LAUNCH-RECEIPT.json SHA256: `1d726f323e7aaa7bed3df018ba9920392391f4e378b5aa353731491c30e288e2`.

## Root action required

Review the comparator's denied builtin-module access under the existing offline
policy before authorizing any narrowly bound compatibility repair; do not allow
arbitrary getBuiltinModule or ambient fallback. Independently bound coordinator
fatal reporting must fit the existing stream cap without discarding raw child
receipts. Any successor needs resealing, different review and a fresh grant.

The V6 grant is consumed. V4 failure/grant, V5 F1, V6 invalid synthetic fixture,
historical scores and W07 UNQUALIFIED/UNCREDITED remain unchanged. V4 RESULT still
hashes `4847ea6e321a5c6bdfb4140ca8359cdc0102bbe64c5e7a38988ed9c884ef62c4`.
The 99-semantic cohort remains unauthorized. No full gate, native, service,
SafeJS-engine or comparative superiority claim follows.
