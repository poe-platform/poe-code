# CORE70 v6 — narrow controls qualified; ready for different preexec review

2026-08-29. Harness-only correction. No production change, candidate execution,
Worker, parser, engine, Shell, compiler, build, install or native invocation.
The frozen e013/da4e composition excludes Faraday's arithmetic changes and HEAD.

## Actual result

- **30/30 PURE controls:** original25 unchanged plus five explicit-root controls.
- **18/18 inherited owner records:** three syntax, thirteen synthetic ownership/
  capture/deadline/failure records, two actual harmless child executions.
- Two additional changed-module syntax constructions completed in preparation,
  separately from those18; no full35-syntax or305-source replay.
- PURE preparation PID65675 and controller PID65682 retired with exit0.
  Harmless children65685/65687 retired with exit0/7, respectively, both with
  stdout `OUT\n`, stderr `ERR\n`, eight captured bytes each and observed close.
- No unknown retirement, failed assertion, capture/integrity/cap stop or retry
  occurred in v6. Historical v4/v5 failures remain literal and unrescored.

`raw/ADDITIONAL-CONTROLS.json`, `raw/RESULT.json`, raw stdout/stderr and
`raw/children.jsonl` are the actual evidence, not author expectations. The
synthetic missing-close case deliberately proves unknown-retirement detection;
it is not an unknown retirement of either real child.

## Minimal change and exact admission

The corrected controller uses an explicit canonical repository root and exact
source/copied-path allowlists, never ambient cwd. The five new controls verify
execution from isolated cwd, wrong-root refusal, traversal refusal, undeclared
absolute-path refusal and exact copied-entry resolution. All original25
assertions and18 owner records are unchanged.

V6 removes the redundant full inherited execution-seal read that caused v5's
351213-byte input to exceed its262144-byte helper guard. No guard was weakened.
The seal is not consumed by these narrow assertions: its prior accepted DATA
hash/size/provenance are recorded in `raw/PREPARED.json`. The optional new512KiB
allowance was unnecessary and is not used. Every consumed entry/dependency
retains regular-file/size/hash admission. Changed entry/root helper have exact
fresh bindings; the three v4 dependencies retain literal expected hashes.
The owner rechecks its five-file inventory and streamed fixed Node binary.

New generated entry SHA256:
`95e7a72148f7aac0a0f040c619c615e78d8565dcbacdf064a94c1198a639a950`.
Root resolver SHA256:
`d9a2fecb17a403eeb26f9bc060472ca5cd6f88075dfc41f87cdb1386e1305aa3`.
Node22.22.2:112989184 bytes, streamed SHA256
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.

## Exact reachable matrix, unchanged and UNRUN

`../v4/CASES-v4.json` maps R01–R32, H01–H08, EC01–EC25 and EH01–EH05:
70 concrete bodies × source-built/installed/physically-moved =210 cells.
Neither cases nor expected bytes changed in v6. This mapping and v4's full
closure seal remain inherited DATA, not a fresh runtime/load claim.

| IDs | Concrete obligations retained | Proof status now |
| --- | --- | --- |
| R01–R32 | Literal matching/captures, quotation, publication and profile cases | All runtime UNRUN |
| H01 | Root ownership and invocation route | Runtime UNRUN |
| H02 | Fixed forwarding checkpoint witness; exact object/false caller reasons | Instrumented runtime UNRUN |
| H03 | Real maxExpansionBytes1/payload aa/zero Worker; group32/33, node4096/4097, interval255/256, private pattern/work/state cases | Reachable runtime UNRUN; depth64 SOURCE-only |
| H04 | Reserve/hold/close and retain/release forwarding; live old snapshot, replacement, failed reservation, cleanup | Instrumented runtime UNRUN; ticket exhaustion SOURCE-only; private close rejection UNOBSERVED |
| H05 | Exactly-one retained-args parent postMessage gate across genuine invoke mutation | Instrumented runtime UNRUN |
| H06 | Standalone exact-false sink separate from caller abort | Runtime UNRUN |
| H07 | Wrong id/operation/cardinality/span/fraction/extra/late frames; valid companions/restoration and binding refusals | Instrumented runtime UNRUN |
| H08 | Fresh public exec initial allowance equality; shared internal consumption | Runtime UNRUN |
| EC01–EC25 | Numeric2, same-node/grouped negation and error-control/publication rules | Runtime UNRUN |
| EH01/EH02 | Genuine private pattern cap65536 exceeded by65537-byte env pattern | Runtime UNRUN; not33-group unsupported grammar |
| EH03–EH05 | Caller/resource/sink/cleanup and exact invoke-Promise provenance, including raw falsy | Runtime UNRUN |

H03's inherited SOURCE argument is specific: recursive expression(depth+1)
entry occurs only through group parsing, whose group-count32 guard dominates
the recursive call; group33 refuses before depth64. It is not an executed
depth branch. The source-only qualification must remain visible in review.
H04 ticket exhaustion is not demonstrated by lowered caps. Its actual private
ArrayOwner.close rejection remains a separate unobserved obligation; today's
synthetic rejecting-close control only proves observer forwarding/reason
identity. Registered host cleanup is not relabeled as that private failure.

## Observer closure and scope

H02/H04/H05/H07 remain ROOT-approved TEST-only profiles, not stock-runtime
proof. V4 binds48 compiled private assets with29 relative imports, one Worker
URL and four builtin specifiers (separate counts). Nine fixed owned wrapper
roles per layout are checkpoint plus seven faults and a positive companion.
Whole-file hashes/role mapping precede actual future Worker acquisition;
Worker options remain unchanged. No arbitrary URL, public seam, counter
injection, validation weakening or lowered limits is introduced here.

Worker observer requests/replies are capped128 each, starts by the sealed
per-cell maxima, waits by the bounded guard. Array observation is capped256
owner/binding identities and4096 records; original calls, return values and
rejection identities forward even when observation fails. Today's controls
check exact own-data/order/accessor handling, fixed witness/options, actual
source-binding refusals, raw-falsy terminal presence and synthetic forwarding.
They do not prove actual Worker interception or private product behavior.

The final cell's explicit failure-presence logic now has five real PURE tests
for false/0/empty-string/null/undefined plus unsafe-retirement-not-green. This
does not replace future public raw-falsy runtime observations.

## Bindings, resources and next authority

Inherited candidate `da4e1cc187022255521879b00db2ac77674f79d9` /305 inputs;
full1002 package908381B SHA256
`4f90df04dba998f184473254bb450f9e085b9fc9d5994dc91a21a7ccf1d1d66e`.
Inherited v4 execution seal351213B SHA256
`ea3c82e4192729f4cbd2172e9548d5e21da3d4e3d8ccbfbfa7ad591a47736301`.
No package read, inflation, complete source census or reinstallation here.

Fresh v6 clock1788013306138 through1788013906138 (10min inclusive). Grant:
28 known OS starts, peak3,40MiB capture,160MiB work. Two PURE processes and two
harmless children actually ran and retired. Invocation-local known starts
include shell/admin/apply_patch/Git roles; the actual child receipts give PIDs,
not reservations. The immutable publication snapshot and external final tail
are distinguished in `raw/known-starts.log` and
`/private/tmp/safe-bash-core70-v6-known-starts.log`. This is not universal
transitive OS census and does not repair old uncertified histories.

Ready for DIFFERENT preexecution review of the completed packet, not actual
CORE GO. Proposed future runtime bounds remain210 case children + coordinator
+ four administrative roles =215 known OS maximum, peak2 OS, one live Worker,
309 Worker starts, zero internal loaders,125min inclusive,128MiB capture,
512MiB work. Those are proposals, not current permission. Private transport
qualification, relevant deferred private obligations, independent preexec review
and a fresh ROOT actual release remain required. No product acceptance implied.
