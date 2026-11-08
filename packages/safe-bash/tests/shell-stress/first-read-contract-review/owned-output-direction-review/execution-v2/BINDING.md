# V2 declaration-only independent binding, revision 0

**Partial preparation; no candidate access; D01-D07 remain 0/7 executed.**
The parent's exact criteria, payloads and bounds remain authoritative. This
directory adds a binding record, not a replacement corpus or product proof.
The assignment authorizes this leaf only; no delegation occurred.

## Declaration and input identities

- Parent freeze: `eb2fde0beb13aeb738019309c6db9ec8aa4ab9694a82d3f35efc1cbfae0527ae`.
- Parent preparation: `c0efba18e44d625ebd690937992a8ba6ae942f9167ae14610d9a7274f831eddb`.
- Permitted provisional v2 API snapshot: `90294b9529e400e77cb397d6e6d745f763cc07bf9739dad12dc0d66b64b1338e`.
- `cases.json.data` and `inputs.json.data` are exact parent bytes, not adaptations.
- `authentication.json` verifies all 12 parent files, 41 seal entries (including
  29 old review files by hash only), and 16 commit/path comparisons. Hashing old
  files is not permission to inspect old execution drivers or author test bodies.

## Fixed branch and ownership policy

Select **opaque nonpreemptible sequencing only**, before source inspection.
The declaration offers no per-read lease, owner handback, rewind or rollback.
Do not select a lease branch after observing results. An unresolved borrowed
`next()` remains unresolved until the external harness releases or rejects it.
Output close is not proof of read settlement. No `return`, `cancel` or destructive
close on the shared iterator is allowed without explicit exclusive transfer.

For real curl, declared stdin-dependent data/upload/writeout preparation occurs
before stdout-transfer enrollment. Body stdin is prebuffered under
`maxUploadBytes`, with delayed request start; writeout `@-` keeps
`maxBufferBytes`. This trades stdin streaming for bounded buffering and does
not make arbitrary host promises interruptible. File-only bodies remain
streaming. No request-start inference may be made from a read-start event.

Commanded consumption is not intrinsically dropped data: bytes actually uploaded
for this command are legitimate effects. However, buffered bytes merely observed
by a probe are not a committed upload or supported handback, and consuming the
frozen sibling/owner suffix is not success for D01. Host-defined independent
frames can support a separate honest ownership profile; they are not an implicit
partition of this cohort's arbitrary shared cursor.

The API names declared are `createOutputOperation(context, destination)`,
`signal`, `output`, `registerCleanup`, `acquire`, `close`, and
`parent.child(destination)`. Exact import paths, TypeScript signatures, callback
shapes and return types were not supplied in the permitted text; none are guessed.
Use invocation `registerCleanup` (the existing 07ac lifecycle) before resource
admission, with the same idempotent finally cleanup. No parallel lifecycle.

## Exact case mappings and blockers

| Case | Declaration-only mapping | Unresolved requirement; not a pass |
| --- | --- | --- |
| D01 | Real curl `--data-binary @-`; prefix then pending late read; opaque sequencing. Entire four-chunk cursor stays visible. | No declared way to commit exactly prefix/late after already-closed stdout and preserve both visible suffix chunks. Full prebuffering may legitimately consume more input, but fails the frozen positive suffix requirement if it does. Adding EOF after chunk 2, replaying buffered bytes, or calling a bounded view an original full cursor changes the fixture. This is a binding incompatibility/risk, not an executed product defect. |
| D02 | A custom real Shell command sequences one opaque read, then commits the late bytes to `/direction/opaque-record` outside the stdout lifetime; subsequent consumers use the same full cursor. | Actual Shell/registry/VFS signatures, real downstream-close observation and operation/cleanup settlement mapping are absent. No invented handback API. |
| D03 | Harness records explicit exclusive transfer before acquisition; cooperative owned release can finish the owned read, while an unrelated borrowed cursor stays live. | `acquire` and cleanup callback signatures, owned-resource release binding, overlapping close/dispose and exact output-close reason mapping are absent. Ownership is granted explicitly by the fixture, not inferred from signal/iterator use. |
| D04 | Explicit `parent.child(destination)` then `child.child(destination)`; parent stdout termination closes admission transitively. Child/grandchild cooperative cleanup is registered before admitted work. | Exact callback signatures and first-reason behavior need declaration binding. Already-admitted opaque acquisition is not declared awaited. To satisfy frozen cooperative coverage, a truthful registered cooperative cleanup must cover the deferred acquisition before admission; merely waiting on opaque acquisition is not a product guarantee. |
| D05 | Parent destination is independent of stdout; one stdout child and one file sibling. Child-only closure must permit fresh parent/sibling acquisitions and exact file/stderr completion. | Parent destination contract, output notification, successful post-close acquisition and normal-close versus EPIPE status mappings are absent. No test-side propagation. |
| D06 | Entire finite two-chunk upload plus real EOF is legitimately commanded input; deferred enrollment must not suppress needed body/header files. Exact independent stderr/file bytes remain required. | Shell/curl/transport/VFS declarations and exact serialized headers/late-write status are absent. Keep original argv and all response bytes; do not broaden diagnostics after execution. |
| D07 | Preserve four fixed subruns and exact sentinel identity: caller object, caller zero, selected execution error, two child cleanup errors; explicitly reject late opaque work under a harness gate. | Exact Shell public selection/aggregation behavior and child cleanup registration signatures are absent. No invented status or assumed nested AggregateError flattening. Each rejection must be observed; a missing subrun leaves D07 incomplete. |

## Exact bytes and bounds

D06 is internally consistent: `mixed-body-kept\n` is **16 bytes**, matching
the frozen `Content-Length: 16`. The preliminary question in the early needs-root
report is resolved, not a fixture defect. No input/header correction is made.
Actual candidate header serialization remains untested.

All seven inputs and D07's four subruns remain byte-identical. Guards remain
1200 ms per cooperative phase, 5000 ms per process, 262144 combined output bytes,
64 events and 512 encoded bytes per event. A guard failure is a harness stop,
not evidence of prompt product cleanup or proof a pending opaque read was drained.
No stdout status/diagnostic allowances have been selected from observed results.

## Prepared harness boundary

`driver.mjs.data` is an inert capture of the unique-temp preparation driver.
It accepts a future compiled-import parameter but cannot import a candidate or
execute product cases in this revision. `fixtures.mjs.data` supplies external
pending-read gates, a full unpartitioned cursor and bounded event recording.
Its checks use synthetic input instrumentation only, never fake Shell/curl.
This is **not yet a complete executable seven-case product driver**: missing
bindings are explicit nulls in `binding.json`, not invented compatibility.

Before implementation/test-body access or candidate import, a fresh authorized
leaf must authenticate root-observed author CLOSED plus immutable v2 ready,
obtain exact permitted declarations, resolve or retain these blockers, implement
and separately freeze the complete executable bindings/inputs. Restore only
authenticated v1+v2 inert archives/patches to its own temp and hash source/tests,
compiler/tools/compiled outputs; never fall back to live source or root dist.
Keep first failed bindings/results and at most two focused harness-fix rounds.
The verifier does not fix the prototype. Existing controls and old16 require
their own authenticated inputs/closed driver seal and stay separate cohorts.
