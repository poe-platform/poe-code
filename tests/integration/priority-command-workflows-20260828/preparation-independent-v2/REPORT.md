# Independent preparation repair review v2

August 28, 2026. **STATIC/DATA closure of the original F1–F4 repair
rootcauses, with an F3 reporting qualification; no product GO.** Root's final
choice accepts that documented qualification: no metric successor or extra
tests are needed. This record covers only the exact candidate below, not live
edits. `ROOT-CLOSURE.json` preserves the final coordination decision.

## Bound inputs

| Input | Exact identity |
| --- | --- |
| Repaired executable code | `2a63780fd8ddd8bd97b6f2ad31ac33e969da5bae` |
| Root-routed final evidence/seal | `a63169d1d84f4d81812cafa3b58c1e0624090c3e` |
| `PREPARATION-SEAL-v3.json` SHA256 | `00ee97d8617eb75a4ac47bf383b19c186a12a8fcd4144096fd08a54d2f2d45ea` |
| Ordered fourteen-file code-set SHA256 | `8d1cd6efee03426e726751175c1c2439323a24c82203b2d70b3da482527b0261` |
| `GO-v3.template.json` SHA256 | `9f84baf5a92e31e9824abc6a8bba23e1254d45fdf4400f6fa80d7705f67acef9` |
| `REPAIR-PROTOCOL-v3.json` SHA256 | `38f63ee90570cfc9602c6e3f4239458dbd177f9749bdae9db985013f618b70d4` |
| Author repair `RESULTS.json` SHA256 | `ca08842002325ee7ea896b1a212c9216b0e943cc290a7a54849a486ae31c04ed` |
| Original reviewed code | `116f5dd79f14032ebcf9a2e46de0d912005c3ffa` |
| Prior independent review | `3b094276a7c669427493de5828aab70364ef7b14` |
| Frozen eight-file packet | `5d432becbe385eb323c10feecfa5e982bfd3b099` |
| Derived source268 composition | `8437e4eda904e1248c25eeef0d9d455b1d251495` |
| Full858 package SHA256 | `6b5863d51ecd6484b79b7141a2004c04b775f9894d5b80bb016a02ffbefed40e` |

The root response text and hash, individual code pins and selected final-file
pins are in `DATA-RESULTS.json`. No raw HEAD supplied reviewed inputs. The
derived composition remains an accepted derived identity: no stored-object
requirement or repeat source/archive authentication was introduced.

## Four repairs

All source anchors in this section refer to the executable commit above,
under `tests/integration/priority-command-workflows-20260828/`.

### F1 — Sticky actual-child dependency refusal: repaired in scope

`worker-preload.mjs:19` sets the shared refusal word before throwing and emits
the first refusal URL/reason. The load hook surrounds both admission and actual
returned-source checking. `worker-observer.mjs:37` enrolls the word and `:53`
snapshots it at exit. `admission.mjs:97` rejects either the child refusal log or
the sticky word; it does not infer provenance from a mapped diagnostic.

Authenticated benign DATA shows both required shapes: caught-load exits0 with
no Worker errors, yet has the refusal word and an actual child-thread dependency
refusal receipt; mapped-load records a parent-mapped error and Worker exit1 with
the same sticky refusal. Both have empty parent constructor-refusal lists.
Worker entry receipts bind the benign entry bytes, PID, token and thread ID.
Parent-load observations were not substituted for actual child-load receipts.
These are existing benign observations, not accepted-product Worker proof.

### F2 — Safety STOP versus ordinary mismatch: repaired in scope

`future-adapter.mjs:140` retains sticky safety codes independently of throws.
Its request/authorization admissions, cleanup/resource checks, mandatory traces
and namespace boundary checks feed that channel. `runtime-entry.mjs:35` awaits
Worker cleanup before printing the record. `future-supervisor.mjs:207` retains
the observation and `:209` writes it before `:211` checks safety; a refusal
escapes the case loops into STOP, before another subject can dispatch.

Complete clean observations with ordinary byte/status or declared error-type
mismatches still reach the failure aggregate at `future-supervisor.mjs:225`.
Author controls separately exercise caught refusals, missing traces, pending
resources, namespace changes, ordinary aggregation and independent cleanup.
No new classifier or subject execution was needed for this review.

Immediate regression review included the disclosed fixture bookkeeping change:
the injected throwing source closes its own cursor before throwing, without
changing the frozen fault input. C05 now awaits both disposal promises before
checking shared-promise identity; cleanup/listener removal remains in `finally`.
The original eight packet files, including all expectations, are byte-unchanged.

### F3 — Unknown reservation retention: repaired, reporting qualified

`admission.mjs:105` debits four starts before dispatch. Only complete matching
attempt/start/exit/retirement settlement refunds unused slots. Earlier STOP leaves
all four withheld; it cannot restore an unknown child's reservation. Exact total
starts becomes `null`, rather than a fabricated zero. The three author reservation
controls cover pre-settlement STOP, incomplete logs and complete-only refund.

One immediate reporting limitation was sent to root promptly: safety checking
precedes settlement, so a first child's already-observed start can coexist with
`productWorkerStartsKnown:0`, `productWorkerStarts:null` and
`workerStartsWithheld:4`. The start remains in raw receipts, but the named known
metric sums only cleanly authenticated reservations. This is not a cap-return
failure. The final sealed `REPAIR-PREPARATION-v3.md` explicitly documents that
narrow metric meaning; its SHA256 is
`ddadbb773e6dd2c7f1859f1900cae537470f88ad084600a6d4e00758e4d730b6`.
Root initially routed a narrow reporting correction, then explicitly chose to
retain exact v3 with this documented qualification, without v4 or extra tests.
The author will preserve started, unexecuted edits as nonexecutable DATA and
restore exact v3; root owns the later restoration metadata check. This review
does not certify those edits or claim restoration already occurred. The
full-reservation withholding remains intact in the reviewed candidate.

### F4 — Terminal storage and deadline accounting: repaired in scope

`admission.mjs:133` reserves16,777,216 bytes inside—not in addition to—the existing
536,870,912-byte cap. `future-supervisor.mjs:30` takes the smaller parent allowance;
`:48` leaves the terminal reserve out of usable nonterminal space. Projected and
retained receipt writes check storage and deadline. At most520,093,696 bytes are
available for nonterminal storage under the full cap; a smaller parent budget
reduces that further.

`future-supervisor.mjs:237` pads the terminal receipt to the fixed reservation,
accounts projected and actual retained bytes, samples the inherited deadline
after writes, and permits only bounded STOP-receipt correction. Returned scratch
is `max(0, inherited scratch - retained bytes)`, not unchanged reusable capacity.
The final sample can turn a late PASS/FAIL into STOP before returning. Sampled
logical accounting is not a kernel quota, RSS cap or arbitrary host preemption.
Author's three terminal controls are pure accounting-helper observations, not
real-supervisor disk/deadline execution. No cap was raised or adequacy established.

## DATA evidence and boundaries

`DATA-RESULTS.json` records13 grouped binding/receipt checks, all passing. These
authenticate14 code pins,21 protocol input pins,41 relevant pins of the99-entry
final seal,13 repair receipt files and the8 frozen packet files. These are
overlapping sets, not additive product tests. A scoped committed Git diff confirms
unchanged historical seals/templates, both prior protocols and receipt cohorts,
`SOURCE-AUTH.json` and `CALLS.json`; their semantics were not rescored.

Author42 controls remain9 parse-only +29 DATA/SYNTHETIC +4 benign controls.
The four captured OS children (PIDs72586–72589) have exit/close/reap receipts;
their four Workers have known exits, zero pending terminations and no emergency
retirement. The controlling driver PID72573/exit0 is the author's sealed
attestation, not an exit independently observed by this reviewer.

This verifier created zero subject processes and zero Workers. The bounded
DATA-binding session used68 synchronous Git metadata children, all returned;
shell inspection/commit tools are separate and completed synchronously. No
background child or delegated worker remains. No product import/run/build,
install, pack, native oracle, comparator, private/network/XAN/array activity or
additional benign control occurred. The previous437 checks were not repeated.

One extra live-equality check stopped before writing evidence when concurrent
author edits changed live `admission.mjs` from the pinned8788 bytes to10264.
That was an unnecessary reviewer assumption, not a failure of the committed
candidate. The corrected check uses the root-routed immutable inputs; live
successor edits were preserved and excluded. No append-proof live-tree claim
is made, and no successor is silently folded into this verdict.

`GO-v3.template.json` remains `PREPARATION_ONLY_NOT_A_GRANT`. Actual `GO.json`,
`PARENT-BUDGET.json` and `future-run-01` were absent at inspection. All31 frozen
cases across three layouts—**93 actual product calls—remain UNEXECUTED**.
Preparation repair closure, future authorization and product acceptance are
separate; this bounded review grants none of the latter two.
