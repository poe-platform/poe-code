# M1B independent worker interface v1

Status: Frozen authoring interface; target execution NOT STARTED
Implemented Through: Not applicable at this early interface seal
Purpose: Allocate concrete peer modules to a serial, bounded, parent-supervised review.

## Authority and allocation

Only the root-routed final committed recipe can admit execution. This interface
is not a GO token, candidate proof, or inherited author acceptance. The target is
stored source `fca6f81d2d96db2bbceabf3247cd57ffe240bde6`, derived-only tree
`23074ef0c443ca618c4f26204b5f3d2274b86895`, and the full 910-member package SHA256
`cc0e75c2d0d12f713f0458e608ddeae157cf3432b4e0b48277a329a98115aa1a`.

The runner owns admission, tools, supervision, guarded loaders, capture, scheduling
and final composition. `semantic/` owns fixtures and stock assertions for M1A,
38 format rows, B01–B12 and six virtual workflows. `mechanical/` owns the 32
resource/108-variant disposition map, S01/S02 instrumentation, exact loaded mutant
postimages/restores, five direct type fixtures and codec observer qualification.
Neither peer edits the other's files or the runner. Peers publish a committed
component manifest and seal; evolving files are never executable authority.

## Export and manifest ABI

Each peer entry is an ESM `.mjs` exporting
`async function runCase(api, caseId)`. No import-time candidate loading is allowed.
Its data manifest is `{schema:"m1b-cases-v1", cases:[...]}`. Every case record has
exact fields `id`, `entry`, `role`, `rows`, `variants`, `layouts`, `timeoutMs`,
`captureBytes`, `workBytes`, `requires`. Paths are relative to the review root;
IDs are unique. Roles are `STOCK`, `MECHANICAL`, `LOADED`, `TYPE`, `SOURCE_ONLY`,
or `UNRUN`. Layouts are `S` and/or `M`. Timeout is at most 30000 ms. `requires`
is an array of exact sealed adapter/mutant/fixture IDs, never dynamic code.
Unrunnable rows remain explicit records and do not become passes.

`api` exposes only these harness facilities:

| Member | Contract |
|---|---|
| `caseId`, `layout`, `candidateRoot`, `caseRoot`, `signal` | Immutable case identity, `S`/`M`, admitted physical roots, cooperative AbortSignal. |
| `load(relativePath)` | Async import of an exact enrolled `dist/**/*.js` in this case's ordinary or explicitly mutant layout. No public-export claim, TS/workspace/host fallback. |
| `capture(label, ownData)` | Async durable parent raw JSON capture and acknowledgement **before assertions**; finite exact own data only, no getters/coercion/prototype test. |
| `captureBytes(label, bytes)` | Async durable raw byte capture, accepting Uint8Array; copied ownership before return. |
| `check(label, boolean, details?)` | Records an assertion after at least one acknowledged capture. False is sticky case FAIL. Details obey the same finite own-data rules. |
| `registerCleanup(callback)` | Synchronously enroll idempotent cooperative cleanup before resource acquisition. Runner awaits all registered callbacks in reverse order, even on throw. |
| `compile(fixtureId)` | Parent-owned exact sealed fixture/compiler request; no worker argv/path/environment authority. Returns `{code,signal,stdout,stderr}` after raw capture and known reap. Bytes are Uint8Array. |

Cases may use ordinary builtin helpers declared in their component closure, but
MUST NOT spawn processes, load unbound candidate code, use network, write outside
`caseRoot`, or allocate an unbounded generator. Every case receives fresh FS/state;
shared process module state MUST be restored by registered cleanup. Mechanical
instrumentation MUST identify actual product bytes and scope; it is not stock proof.
Retained buffer/abort reason identity assertions occur **inside the same worker**.
Serialized reason descriptions never prove cross-process identity. Catching a
thrown value MUST preserve the actual value for in-worker checks, including null
and undefined; no blanket exception waiver is permitted.

## Capture, batching and retirement

The parent authenticates all active code, candidate/tool memberships and modes
before admitting a worker. Workers request captures over an owned IPC channel;
the parent reserves bytes before creating exclusive raw files and acknowledges
only completed writes. Parent stdout/stderr are independently captured as bytes.
All raw data precedes the assertions it supports. Unknown/duplicate/missing case
receipts are failures, never implicit passes. A case with zero assertions is
INCOMPLETE. Unsupported observations remain SOURCE_ONLY/UNRUN.

One worker may receive a fixed batch of manifest IDs. Its absolute batch deadline
is shared; a case has at most min(30000 ms, remaining batch/global time), including
cooperative cleanup. Cases do not renew the batch/global origin. Timeout is FAIL.
An unsafe cleanup, provenance, integrity, capture or retirement result stops all
further admission. A safe ordinary assertion failure may continue only after
capture, complete fresh guard and known retirement. Consequently a failing case
ends its worker batch; later independent batches may continue after those barriers.
Unreached members of an ended batch are UNRUN, not product failures.

All child exits other than zero remain aggregate FAIL, including a compiler whose
diagnostic was expected. Such diagnostic matching is separately labeled type
counterproof, not a passing process or exception to the root rule. Peers MUST NOT
hide a child exit or silently change the five frozen fixture expectations. If this
prevents a green aggregate, report it explicitly rather than introducing a waiver.

## Bounds and peer handoff

The complete final recipe MUST reconcile <=168 owned child starts at all nesting,
peak four processes, 7200000 ms single-origin wall including finalization, 256 MiB
total capture and 1 GiB working bytes. Build <=120000 ms; cases <=30000 ms. No
retry, per-layout renewal, opaque host preemption, hard RSS, or escaped-child claim.
There is one active outer worker and at most one parent-owned compiler tool.
Peers MUST publish exact case/variant counts, fixture/postimage path/mode/size/hash,
required builtin imports, batch isolation constraints and per-case capture/work
ceilings. JSON-only proposed mutants or unbound observer counts are not runnable.

S is independently compiled selected source, never copied author JS. M is the full
offline installed package physically moved before target invocation. Installed but
unmoved is admission/origin evidence only, not a third semantic cohort. The absent
root Git export remains an integration gap. The old 289/288 observer discrepancy
is not a demonstrated leak; S02 cannot be suppressed by an unqualified adapter.

## Verification state

This early seal fixes the ABI for authoring only. Runner bodies, component seals,
full tool/source/package admission, numeric reconciliation and independent review
are required before the final launch checkpoint. No controls or target code have
been executed to certify this interface.
