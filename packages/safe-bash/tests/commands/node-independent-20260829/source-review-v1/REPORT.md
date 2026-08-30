# Independent Node draft source review v1

**Source findings; no product acceptance.** Fixed draft
`bf9a7a3e397a1efdf3600ed3f841a311f3910cf4`, nine Node-local files /74702 source bytes.
Author implementation continues concurrently; nothing here describes mutable HEAD.
No module, Worker, guest, compiler, typechecker, build, install, engine, native,
network/private or mutation execution occurred.

## Immediate author/root action

### F01 — HIGH: failure retirement leaves cooperative parent work live

`src/commands/node/lifecycle.ts:85` catches start rejection and only captures
it. `lifecycle.ts:120` closes admissions/timer, calls provider cancellation and
retirement, then awaits all jobs at line129. It never aborts the private parent
signal. That signal is supplied to actual VFS reads at `host.ts:170`.

Source trace: an admitted FS read waits cooperatively for its supplied signal;
a separate provider/Worker failure rejects start; the provider retires its actual
Worker; owner.close waits forever for the still-live read. The5s timer was cleared
at cutoff. This is not an uncooperative-FS or all-jobs requirement: the cooperative
operation has not been told to cancel. The same omission exists in owner.failure;
only caller/deadline paths reach #controller.abort.

Repair fatal failure/termination propagation to the invocation-owned parent-work
signal while preserving raw reason presence and caller precedence. **Normal entry
cutoff must still drain preadmitted work without aborting it.** Do not abort the
caller or siblings. Future tests need a bounded held-read release even when the
baseline fails, and separate raw-provider versus genuine observed Worker exits.

### F02 — HIGH concern: FS call provenance is not typed-error recognition

`src/commands/node/host.ts:9` accepts any non-Proxy object with whitelisted
own fields, name FsError, known code and a negative safe errno. There is no
accepted `isFsError` recognition. A plain FS-origin object with those fields
passes line21, becomes fsError at line244, and its raw rejection is cleared on
delivered at line256. A guest can catch it and complete normally.

The actual FS-operation wrapper correctly excludes sink/control origins, but it
does not turn every thrown shape into a genuine typed FsError. Use the declared
genuine recognition route before finite extraction, or obtain an explicit root
structural-error policy. Retain unread stack and optional-field treatment. This
is a fault-classification concern, **not** a malicious trusted-host sandbox claim
or a dynamically demonstrated adapter exploit.

### F03 — MEDIUM: granted early usage diagnostics are absent

With valid factory settings, stderrWrite:true and argv ["--inspect"], invocation
at `src/commands/node/index.ts:46` throws before host construction at line54.
The catch calls diagnose, but line41 has no output branch without host. The
source-predicted result is exit2, zero diagnostic writes, zero stdin pulls and
zero prepare calls. Missing -e/-p operands follow the same path.

The governing NP1 diagnostic profile remains inherited by CONTRACT.md:11. Emit
bounded early diagnostics through existing ledger/sink/shared-budget ownership,
without acquiring source/VFS/provider just to print usage. Keep stderr-grant
refusal and exact diagnostic-sink failure precedence. This is a branch trace,
not a captured runtime stderr result.

## Three separate source questions, not additional executed failures

- **Q01:** `lifecycle.ts:85–86,114–117` upgrades a locally recorded profile
  failure to execution if the provider forwards that request rejection through
  start(). The callback receives only present/value, not owner provenance.
  Clarify the faithful profileFailure/escaping-rejection handoff; never fix it by
  class/equality inference that demotes an external NodeProfileError.
- **Q02:** `diagnostics.ts:26–29` retains synchronous publisher throws only.
  An async callback's returned rejection is not awaited/retained. A void callback
  type alone is not a runtime completion guarantee. This helper has **no caller
  in the nine-file draft**, so the actual publisher route remains unfinished,
  not a newly demonstrated runtime fault. Bind sync-only publication explicitly
  or enroll actual async publication. N33 must observe the real owner route.
- **Q03:** The strict error whitelist also refuses a genuine FsError with an own
  cause field. Decide whether that finite-transport limitation is intended.
  Source inspection found accepted RealFS operation():236 reconstructs its public
  errors without cause; **do not claim ordinary RealFS missing-file errors fail**
  from its internal nativeError helper. No provider source change is requested.

FINDINGS.json and SCENARIOS.json preserve exact anchors, source-derived timelines,
proposed minimal repairs and future positive/negative controls. None were run.

## Exact draft API binding

Only `createNodeCommand(options: NodeCommandOptions): CommandDefinition` is
promised. No list/plugin factory or root/subpath/default registration is required
at this phase. Options are exact own provider/grants; explicit undefined refuses.

Provider: profile/identity/prepare; session: detached start/cancel/retire;
services: signal/request/delivered/reserve/cutoff. Requests have **seven** own
fields (sequence,op,authority,path,flag,text,moduleKey), responses five. Completion
and retirement are provisional records, not proof of a real Worker by themselves.

Grants are seven booleans over the **supplied whole VFS namespace**, not invented
per-path allowlists. The original N14 confined-/data setup must use a truthful
configured VFS rather than adding grant options; detecting escape may itself
require a VFS call. N22 revocation can use a failing fresh realpath observation,
not mutation of the frozen option object. A session-local namespace1 is not a
FileStat identity token or assertion of global disjoint storage. Path normalization
and pathname races are not an atomic backing-identity guarantee.

UTF8 is now explicitly replacement decoding; strip exactly one source/JSON BOM,
retain ordinary-data BOM, encode lone surrogates as replacement. Limits are fixed,
not lowerable options. The256KiB ceiling is **trusted facade + user source**, so
raw source at256KiB is not promised to fit. Preserve the earlier conditional
boundary recipe instead of calling a changed raw-source expectation unchanged.

MAP.json binds all **38 semantic /8 type /6 load families** to exact draft paths
and lines. They remain unexecuted. Only candidate/API binding is advanced; the
prior semantic preparation files, counts and mutant classes are unchanged.

## Positive source observations and remaining barriers

Cleanup registration precedes open/source/provider preparation. Preparation is
specified inert; the owner uses one shared idempotent close promise. Source and
FS/sink origins are recorded, including falsy reasons. Caller priority is explicit
at final settlement; cleanup-only failures are not hidden by numeric outcomes.
IO uses actual context.fs/stdin/stdout/stderr and existing awaited sinks, not the
old development Map or a fresh Shell/Budget. Source admission is a complete
module-owned tokenizer/parser; private identifiers are decoded before refusal.
JSON cache is guest-local and reauthorizes via realpath on each require; writes
are delegated w/wx without a check-then-write fallback. These are inspected paths,
**not tests or guarantees of arbitrary-source confinement**.

The declared unfinished conforming provider/value-kind/intrinsic restrictions,
static entry, genuine blocking transport, PUBLIC98/95 load closure, executable
preseal and actual source/installed/moved types/load evidence remain known work.
No attempt was made to duplicate that implementation. F01–F03 need author/root
handling before treating the completed draft as an execution candidate; Q01/Q02
need explicit ownership decisions. A trusted provider label is not acceptance.

## Inputs and review limits

SOURCE-INPUTS.json binds all nine source modes/blob IDs/SHA256 values, checkpoint
and API/contract documents, accepted core error/RealFS reference blobs, and the
original preparation matrix. The accepted public79 derived identity/package
proof is reused from797aa139; it was not rebuilt or needlessly re-probed in GitDB.
Only bounded Git metadata and owned publication tools ran. DATA checks validate
counts/anchors/hashes, not TypeScript or program semantics. No author/production
file was written; no background child or acquired execution resource remains.
