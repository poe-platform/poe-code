# Durable root authorization — one attempt, pending exact-hash confirmation

Date: 2026-08-28. This document records the actual root message below. Its
containing commit, once created, supplies the full40-character `rootReceipt`
for the subsequently prepared grant; no self-reference or invented receipt.
Preparation is authorized. **Dispatch remains prohibited until root confirms
the returned exact grant hash.** No attempt has been consumed by this document.

## Authoritative message, preserved verbatim

> ROOT accepts narrowedexecutorrepair evidence400dd9bd/e2372c41 and authorizes preparing a DURABLE ONE-ATTEMPT ROOT RELEASE for exactarrayc0adae539c736db0e4023d401562ce958d9ebb00/selected30f88590/packe12ed19882b6722503a8fb962ca88e0d6c40300a7e76acc3f81aef5961e0a3a3, seal c7f198821b82f8ce2661913b944211b747de2bd5a4017c431406687cda212d80, dispatchSHAee5f7e1d17d7ce47dc7bdd6de757923180c8bd46add0f854fda960bbbc374807. First commit exactROOT authorizationdocument reflecting this message underownscope (full40commit becomesrootReceipt; nofake/selfreference). Then prepare regulargrantJSON exactly5fields action execute-array-successor-v3/sealSha256/candidate/packageSha256/rootReceipt and return literalrawbytes/SHA/absolutepath/fullrootReceiptcommit and command withuniqueLabel='ARRAY-S06-20260828-01'. DoNOTdispatchuntilrootconfirmsreturnedexacthash. Scope33semantic22mechanical16holdoutsP01–10AST4/types10each3layouts12mutants+S06/positivecontrols, expected345children373max374inclcoord,110minTOTALfrompre-admissionthroughfinalpublication/cleanup,128MiBcapture512MiBworkingstorage/concurrency1, privateM21SOURCEONLY+5mixedexplicit. No native/private/YQ/XAN;exact271?269sourcebindingsperseal authoritative, noproductedits/newloops. Preservealloldfailedharness/c7outcomes/H12heldhistory. Rootgrantoneattemptnomatteroutcome, norescore, safeordinaryassertionsaggregateafterknowncleanup/integrity; safety/integrity/capture/unknownreap STOPdependents no retry. Userprioritycommandsnotinterruptedbythisalready-preparedreview.

## Exact binding and execution restrictions

- Candidate: `c0adae539c736db0e4023d401562ce958d9ebb00`.
- Selected tree: `30f88590b66b88dc9694a56c85f1ee690f02218b`.
- Whole862 package SHA256:
  `e12ed19882b6722503a8fb962ca88e0d6c40300a7e76acc3f81aef5961e0a3a3`.
- Seal SHA256:
  `c7f198821b82f8ce2661913b944211b747de2bd5a4017c431406687cda212d80`.
- Dispatcher SHA256:
  `ee5f7e1d17d7ce47dc7bdd6de757923180c8bd46add0f854fda960bbbc374807`.
- Unique label: `ARRAY-S06-20260828-01`.
- Scope remains33 semantic,22 mechanical,16 holdouts, P01–P10, AST4,
  types10 in each of source/installed/moved,12 mutants plus S06 and positive
  controls. M21 is source-only and five mechanical obligations remain mixed.
-269 source bindings;272 expected Git children =269 blobs +2 object checks
  +1 capsule. Expected345 children, maximum373;374 maximum including coordinator.
-110-minute total from pre-admission through publication/cleanup;128MiB
  captured child output;512MiB working storage; concurrency1. No reset/tail.
- One attempt regardless of outcome; no retries, rescore or new loops.
  Ordinary assertions aggregate only after known cleanup/integrity. Safety,
  integrity, capture or unknown-reap failures stop dependents.
- No product edits, native/private-engine/YQ/XAN actions. Original failed
  harness/c7 outcomes and H12 held history remain intact. User-priority command
  work is not interrupted by this already-prepared review.

## Concrete admission mismatch requiring root resolution

The message explicitly requests grant `action: execute-array-successor-v3`.
The exact authenticated dispatcher above instead asserts
`go.action === 'execute-array-successor-v4'` at dispatch.mjs:26, and the bound
SEAL launch action is also v4. These are not interchangeable. The requested
five-field grant will preserve v3 literally, not silently substitute v4.

Consequently that grant is **not admissible by the sealed dispatcher**. Root
must resolve this discrepancy before any dispatch. No dispatcher, seal,
product or policy alteration is authorized here; no attempt is made to test
the known mismatch dynamically. A plausible40-hex receipt only passes the
format check; the real durable authorization and exact-hash confirmation
remain external root decisions.
