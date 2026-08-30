# Independent CORE repaired-producer DATA review

## Verdict

**PRODUCER DATA ACCEPT**, limited to the frozen corrected producer, source/tool
provenance, shipping bytes, complete DATA layouts, and finite guard preparation.
This is not runtime acceptance, pilot PREEXEC approval, or permission to execute.
The independent producer review and the pilot AUTHOR preparation are different
deliverables. No production files were edited.

Reviewed final packet `b015f0ea4f53b3c28dfb78c77eec3bf6138ad35f` under
`tests/compatibility/bash-ere-core-transport-rebind-20260829/author-v3`.
`ADMISSIONS.json` authenticates all 334 packet Git blobs from NUL-delimited tree
records, plus the two original freeze-commit objects. These are exact committed
inputs, not a claim about the entire changing repository.

## Freeze and decode

- Freeze commit: `b8e181757058ff51c32e00387abc730cd1acc29c`, committed
  2026-08-29 16:07:04 UTC. Final packet commit is 16:10:42 UTC.
- Archive: 909885 bytes, SHA256
  `fc559bb3a1bd7db72e959461ce2b733871cde0867095c61fd065021fb498606d`.
- Pre-inflate receipt: 821512 bytes, SHA256
  `52b75de5a8b9af27effc7d5dcf5ffa64eeb8171383413810709143b144fef54d`.
- Historical Git batch barrier ran 16:07:04.735–16:07:04.766 UTC; the admitted
  decode receipt records 16:07:05.032 UTC. Both frozen blobs were committed first.
- This independent invocation admitted regular-file type, compressed length and
  exact SHA256 before its sole gunzip; it decoded that same Buffer. No archive
  extraction, executable load, install, build, pack, or product evaluation occurred.
- Independent tar admission checked checksums, regular member types, bounded
  sizes, duplicate/path rejection, padding, and every shipping size/mode/hash.
  Result: 5792256 decoded bytes, 1002 members, 5029786 member bytes.

## Source, tools, and emits

The composition is `ff0c86a560da56b58437928c499ca7f5b9d25d70`. All 305 source
files matched their byte and Git-blob pins: 303 unchanged inputs and the accepted
owner/root overlay from `4abbdeec8e34de88ed2cf7bd32be9c06b413c631`.
Prior SOURCE/PURE review `f17d8dec11190ef40ecac6c175b208a2e29c7fbf` is unchanged;
this review does not rerun or widen its private-policy acceptance.

All 115 Node-type closure files (2522132 bytes) matched both their isolated copies
and original composition tool pins, including sizes and modes. These are existing
LOCAL type bytes, not installed or downloaded during this review. Historical
strict-build and offline `pack --ignore-scripts` receipts show code/signal 0/null,
exit plus close, both pipe EOFs, and retirement. Compiler diagnostics are empty.
The 208-byte npm notice is retained; it is not an install.

All 1000 emit rows were compared with the admitted shipping bytes: 992 unchanged;
exactly owner/root `.js`, `.js.map`, `.d.ts`, and `.d.ts.map` changed. There are no
other changed emit paths. Failed-v2 causality remains separately authenticated;
the old TS2688, 1000 failed emits, contract STOP, and old captures are not rescored.

Historical tool receipts bind Node
`/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node`, 112989184 bytes, SHA256
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`, and the
compiler/npm closure. This invocation used that explicit Node pathname, but did
not independently rehash the 112 MB executable. Future dispatch must re-admit
current tool bytes; the historical binding is not a current immutable-tool lease.

## Shipping edges and corrected reviewer assumptions

There are 48 private ERE assets. The audit independently counted **29 relative
literal static import edges** and **one literal Worker URL**. These remain two
categories; their old combined classification is **30**, not a lost edge.
The actual literal in admitted `owner.js:108` is
`new Worker(new URL("./worker-entry.js", import.meta.url), ...)`.

The first audit receipt `AUDIT.json` honestly retains two HOLD assertions caused
by this reviewer's incorrect schema assumptions, NOT producer defects:

1. `audit.mjs` required `/worker.js` after successfully counting 29 static edges
   and one URL. The sealed target is `/transport/worker-entry.js`.
2. It assumed every layout product root was `app/package`. Installed/moved use
   their explicitly sealed `packageRoot` instead. It stopped at the installed
   README lookup; it did not complete the moved-layout check in that invocation.

Neither failed assertion was erased, rerun, or counted as a passing control.
The separately allowed PURE pilot-selection admission necessarily authenticated
each complete candidate layout and public-package closure using the explicit
roots, and confirmed the correct literal Worker target in all three. Its evidence
is `../bash-ere-core-public-pilot-preparation-20260829/PREPARATION-RECEIPT.json`
and `PILOT-PRESEAL.json`, whose SHA256 is
`819acd62efb035279d61aaced782abe4c5779f3dc1a5983a0db694d4bc3fc7d7`.
This additional admission is DATA evidence, not pilot runtime acceptance.

## Complete layout admission

| Layout | Product files | Complete app files | Logical bytes |
| --- | ---: | ---: | ---: |
| source-built | 1305 | 1392 | 9203237 |
| installed | 1002 | 1089 | 6537603 |
| moved | 1002 | 1089 | 6522935 |

The selection admission compared the complete actual regular-file AND directory
sets with each sealed manifest, then checked every retained file and all 1002
shipping entries against the correct package root. No symlinks were admitted.
This is a quiescent DATA snapshot, not an append-proof lease. The authored DATA
relocation and its frozen bindings are not public npm-install proof, nor evidence
of a runtime surviving a move. All future consumers require fresh admission.

## Guard and controls

Guard preseal SHA256:
`e832b9cf2342c99d09a785f801ae4c73f5905a3d349c9efbc2818e6955c1f66e`.
It binds 70 definitions and 210 prepared cells, all UNRUN. The authenticated
controller's pure clock was evaluated, not its process dispatcher or product.
Eight controls passed once: compressed tamper; compressed size; unrelated emit;
eight-output-kind delta; backwards clock; exact reservation boundary; insufficient
reservation UNRUN; and raw undefined primary / false cleanup with no next case.

The new guard reserves 180 seconds inside 1800 seconds and admits a next case
only when case + cleanup + publication fit. This is a finite admission condition,
not guaranteed bounded completion of an uncooperative native operation. Actual
dispatch, outer process ownership, cleanup, and all runtime gates remain unrun.
Summing its declared components independently yields **332963204 bytes**, with
131072000 unique capture bytes. This is conditional logical accounting, not an
actual filesystem quota, allocated-block/RSS bound, or universal OS containment.
The old 125-minute guard and old 332129069-byte bound were not rewritten.

The 242 known-role / peak4 / 309-Worker CORE proposal remains a proposal only.
The ordinary pilot below does not inherit those counts, or transfer private-fault
acceptance. FULL135, L08, B07, public Expr/type, six nonpublic and seven CORE gates
remain OPEN; original 5001/T1 75 PASS / 1 nonpass / 59 UNRUN, UNKNOWN cell76,
extra-archive STOP and prior census qualifications remain intact. No XAN, P2,
comparator, or private runtime work is authorized by this review.

## Publication and current work

Current review began 2026-08-29 16:15:49 UTC; inclusive deadline is 16:40:49 UTC.
Two PURE DATA helper invocations ran; one additional PURE selection helper ran
the two permitted pilot controls. Actual Workers, Shell.exec calls, builds,
installs, packs, native oracles, and network requests: **zero**.

`CURRENT-LEDGER.md` gives the finite OS-role census and publication reservations.
Helper stdout/stderr were opened by the outer shell before Node startup. Large
read-only manifest output is retained rather than treated as runtime capture.
No production or foreign staging paths are included in the explicit-path commits.
