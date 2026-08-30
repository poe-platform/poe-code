# Surface observer validity proposal — no promotion

Status: **PROPOSAL ONLY; not implemented, not executed, not independently
approved.** Original evidence at `b0ff1977c9c912054edd136510d62819d28cf890`
remains **7 PASS / 1 FAIL / 8 executed**, including case08 FAIL. No new pass count
is issued. This review does not admit the TEMP prototype to production.

Original surface fixture/runner author and reviewer thread:
`01a04292-5421-7363-8bcb-a70b97fae4e9`. The proposal author is that **same** thread,
not the different signed reviewer required before any revision or rescore.
No delegation occurred. The sink-migration author and lifecycle companion are
not authors of this surface proposal; their new expectations were not consulted.

## Authenticated inputs and limits

`PROOF.json` is the captured result of the read-only `authenticate.mjs` command.
It binds original committed blobs, all 57 retained raw capture files, and every
regular file in the retained candidate (940), packed consumer package (709),
and copied engine (264). Full tree checks include new entries and before/after
byte, mode, mtime and ctime equality. The checker uses only Node builtins and
bounded public Git reads: no engine/tool loader import and no guest execution.

Pins:

| Input | Immutable identity |
| --- | --- |
| Original cases/guest input freeze | `5645b4f516438b66e4fad32a585ab27cda8f7cdc` |
| Original pre-guest runner freeze | `5d2c2f93d794b2a52d56ee503119052a5fefe1fd` |
| Original raw audit | `b0ff1977c9c912054edd136510d62819d28cf890` |
| Prototype provenance seal | `f666ad8c76ea4362b093ee52e3e7e3b5c3702916` |
| Different receipt verification | `07a7dae5db51612a23e74d1d164d33723d4d61b6` |
| Report-only coordination correction | `db139ae983ad66364e0367f9fb1ed0262ee61f63` |
| Qualified Q1 evidence, not clean production source | `e57b5aa16f749b6fac558877dff0712e64df05a8` |
| Candidate archive SHA-256 | `a3b9aa6fcb4596e8281de2c30943b98baa01449941c8368401d1172bce95d420` |
| Source213 manifest SHA-256 | `6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea` |
| Compiled708 manifest SHA-256 | `2578b6ea39cfdeb5b942b9aff20ec9bfff1fcf907cd2af751d8e73f5c24e632f` |

Retained inputs are under the regular directory
`/private/tmp/safe-bash-owned-output-prototype-preparation-rE94MK`:
`candidate/`, `consumer/node_modules/virtual-bash/`, and `engine/`.
The candidate declarations and emitted JavaScript match the original package
inventory; selected emitted module hashes also match case07/08 actual import
logs. `PROOF.json.selectedSources` contains exact absolute read paths, sizes,
SHA-256 values and original relative import paths. No live source overlay is used.

Private source provenance is the original guarded checkout at
`bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`, matched here through its existing
regular 264-file copy. **There was no fresh live-private HEAD/status/index query
or checkout read in this phase.** This proposal authenticates retained bytes,
not the current live checkout. The original run was public packed TEMP product
plus actual copied private source-hook injection (`run`, `Budget`, `makeFsModule`,
`declareHostOperation`), **not** private installed-package acceptance. No source
hook or public product module was imported during this follow-up.

Key private copied paths and SHA-256 values, each matched to both original
case07 and case08 import receipts:

| Path relative to retained `engine/` | SHA-256 |
| --- | --- |
| `src/run.ts` | `243e3ca4efef03f6df73a50ef2f23fdcee4ef07c4e26eca7f498bf7823988e1b` |
| `src/interp/interpreter.ts` | `4d33fdba962311153d7cc8ce10d93990fe5db2604513b52fa1f3ea4cbdffc715` |
| `src/interp/globals/object-array.ts` | `b9103764b650f0b193450145694f1618673be159272ce6a5524511605b8cbad9` |
| `src/interp/methods/function.ts` | `3a5482d6c00b84356f02a0d56817ab0e1cdc993c24541ce5989cc3832c7dadcb` |
| `src/interp/host-bridge.ts` | `68b91c99f60d971a80cd70996f94d8d1686713dfe3c14ec283ca4e732c457b90` |

These are the actual source copies, not an old upstream patch or a hypothetical
engine. Private code is not reproduced in this proposal.

## Actual TEMP public API and contract

Authenticated `dist/contracts/io.d.ts` and `dist/contracts/output.d.ts` expose
optional `ByteSink.ownedOutput = { consumerClosed: AbortSignal,
write(Uint8Array): Promise<void> }`, and public TEMP
`createOutputOperation(context, destination)` with `signal`, `output`,
`registerCleanup`, `acquire(start, release)`, `child(destination)` and `close()`.
There is no `accountedWrite` field or `runtimeOwnedOutput` global. The operation's
guest-facing output replacement has only `write`; the operation itself is not
granted to the guest. Types are not guest runtime globals.

The unchanged original host witness (`execution-v1/child.mjs:147`) checks real
`context.stdout.ownedOutput`, the same public pipe consumer signal, a callable
metadata `write`, actual operation keys, and a single successful host acquisition
and release. It records privileged object/function identities before describing
the real supported facades. Only the original context's stdout is replaced by
`operation.output` before executing the real SafeJS command. No control module,
raw operation, cleanup callback, or raw host context is injected into the guest.
The nonempty host premise prevents a vacuous test of nonexistent metadata.

Authenticated `src/commands/safejs/types.ts` and its emitted declaration define
`run(...) => Promise<SafeJsRunResult>`, whose fulfilled value is either
`{ ok: true, returnValue?: unknown }` or `{ ok: false, error: unknown }`.
That return type does not say the Promise cannot reject. The source command
explicitly handles both a fulfilled error result and an exception/rejection.
`src/commands/safejs/README.md` documents guest/runtime errors as status1,
distinct from parser/usage status2 and original-reason parent cancellation.
`src/contracts/command.md` requires registered cooperative cleanup settlement
and preserves caller cancellation/rejection semantics; it does not require a
guest runtime error converted to a command status to reject `Shell.exec`.

Relevant source/declaration SHA-256 values are all in `PROOF.json`, including
`src/commands/safejs/index.ts`, `src/integrations/safejs/values.ts`, the command
contract, package/barrel and actual emitted modules. This is the authenticated
frozen TEMP API, not a claim about evolving live production declarations.

## Case08: exact observer paths and retained facts

The entire unchanged 52-byte guest is:

```text
import { write } from "stdio";
return { ...write };
```

SHA-256: `96a9b23cc16568b930baaa636e16ed8a6134c9e18f4d8d289d0ccb4378a41462`.
Its literal argv remains `["-e", source, "--", "surface-arg"]`; the public
`surface-entry` invocation uses stdin `"surface-input"`. There is no callback
attempt or guest mutation in this case.

The frozen expected engine record is **`ok:false` with error message
`Cannot spread function into object literal.`**. Independently, it expects
fulfilled Shell execution (`rejected:false`), public status1, empty stdout,
exact stderr `"safejs: Cannot spread function into object literal.\n"`, unchanged
VFS, a required host premise, all four host counters1, natural native-child
exit and no watchdog rescue. The classification already says unsupported
function spread only, not namespace-spread/non-leak acceptance.

| Layer | Existing v1 observer / product path | Original case08 evidence |
| --- | --- | --- |
| Runtime wrapper entry | `child.mjs:113` increments calls; line135 emits start immediately before `await run(...)` | `runtimeCalls:1`, start event present |
| Fulfilled engine result | Lines137–140 emit settled and record `engine.ok`, return value or `errorInfo(result.error)`, and used budget | No settled event; no own `engine` or `budgetUsed` field |
| Engine call throw / await rejection | No wrapper catch at line136; propagation skips result recording | No direct rejection receipt exists |
| Public SafeJS command | `src/commands/safejs/index.ts:101` awaits `withSignal`, validates only a fulfilled result, throws `result.error` if `ok:false`; catch/finally drain, close and diagnose | Public diagnostic is captured; no evidence that fulfilled-result validation ran |
| Host operation wrapper | `child.mjs:176` forwards original command with operation output; finally awaits `operation.close()` | `operation-close-settled` present |
| Public Shell boundary | `child.mjs:183` awaits `shell.exec`; success records `shell`, outer catch would record `failure` / rejected Shell | `shell.rejected:false`, status1; no own outer `failure` field |
| Final harness cleanup | Lines190–210 close operation/pipe, await collector, dispose shells, record VFS/signals/handles and result file | All cleanup markers present; no cleanup failure |
| Assessment | `run.mjs:132` checks `actual.engine?.ok`; line134 checks `actual.engine?.error?.message` | Both observations are `undefined`; both frozen assertions FAIL |

The failed assessment entries contain expected `false` and the exact message,
but **omit** `observed` after JSON serialization of `undefined`. They do not
record an observed `ok:false`, an observed different message, or a raw error
object. `PROOF.json` uses `engine:null` only as its own absent-field summary,
paired with `engineFieldPresent:false`; the original actual.json has no engine
field. That summary must not be mistaken for a returned engine `null`.

Exact retained public/effect facts:

- Shell: `rejected:false`, `exitCode:1`, `stdout:""`,
  `stderr:"safejs: Cannot spread function into object literal.\n"`.
- Public stdout base64 and accounted collector output are empty. Stderr base64:
  `c2FmZWpzOiBDYW5ub3Qgc3ByZWFkIGZ1bmN0aW9uIGludG8gb2JqZWN0IGxpdGVyYWwuCg==`.
- Counters: `{ acquired:1, released:1, cleanup:1, childCleanup:1 }`.
  `cleanupFailures:[]`; `hostFindings:[]`; complete VFS bytes/namespace unchanged.
- Case native child pid106 exits0, no signal, `timedOut:false`; parent pid99924
  remains alive with `knownLiveChildren:[]`. Native child status0 is not public
  command status0 or test PASS. Original closeout reaped all eight case children.
- Native child stdout (separate from the guest/public stream) is exactly
  `{"id":"08-function-spread-profile","runtimeCalls":1,"resultWritten":true}`
  followed by a newline; native stderr is empty. The result-time resource list
  is `["PipeWrap"]` and handle list `["Socket"]`, before natural child closure.
- Recorded runtime options include maxSteps20000, deadline1787844033763,
  maxCallDepth64, stringLength65536, arrayLength4096, dataSize1048576.
  Used budget is **unobserved**, not zero. Caller/operation/consumer signals
  remain un-aborted; runtime signal ends aborted by ordinary terminal native
  AbortError. This is not a forced-cancellation or synthetic reason test.

Exact original event order:

```text
shell-exec-start
actual-engine-run-start
operation-close-settled
shell-exec-settled
operation-cleanup-settled
pipe-cleanup-settled
collector-cleanup-settled
innerShell-cleanup-settled
shell-cleanup-settled
```

### Observation versus source-supported inference

Directly observed: entry, missing fulfillment record, the exact public error
diagnostic/status, unchanged effects and settled cleanup. Not directly observed:
the engine rejection object/type/name/code/stack/identity, or whether the call
threw synchronously versus its returned Promise rejecting.

The copied interpreter's `evaluateObjectSpread` rejects function spread with
the matching TypeError; ordinary namespace spread follows a different path.
The copied `run.ts` awaits interpretation and its error path rethrows rather
than always normalizing exceptions into `{ok:false,error}`. The public
`withSignal` propagates the operation's settlement through its race and removes
the abort listener in finally. This strongly supports **inferred runtime
rejection** for case08. It is not a manufactured raw rejection receipt.
The v1 settled event precedes result inspection, so a later failed result-field
read would not explain its absence. A missing rejection observer remains a
real measurement gap even though the public error is expected.

No actual privileged exposure or failed valid public contract is established
by these retained case07/08 facts. In particular, case08's public status,
diagnostic, no-effect and cleanup expectations all pass; its failure is at the
unobserved internal result shape, not those public checks. This does **not**
prove every failure is a fixture defect, certify an unobserved reason, or
exclude authority reachable by other paths. If later direct evidence contradicts
the public contract or shows authority exposure, preserve it and report to ROOT;
do not change product code or promote the prototype.

## Case07: dialect match, not membrane denial

The unchanged case07 guest SHA-256 is
`f17be70596dafc1d96cc0700f3af708efca0d33f4e4c701ed2d45d0c8310d009` (666 bytes).
It fulfilled `ok:true` with result keys `ok,returnValue,snapshot,stats`.
The six measured availability expressions returned the string `"undefined"`:

- `typeof Reflect`
- `typeof Object.getOwnPropertyDescriptor`
- `typeof Object.getOwnPropertyDescriptors`
- `typeof Object.getOwnPropertyNames`
- `typeof Object.getOwnPropertySymbols`
- `typeof Object.getPrototypeOf`

These methods were **not called**. This is neither a parse failure nor a
recorded denial of an attempted descriptor/prototype operation. It cannot prove
that a hidden privileged property is absent. An unavailable inspection API
does not exercise the membrane's handling of that inspection.

The same case successfully exercises `typeof`, `Object.keys`, `Object.entries`,
`Object.hasOwn`, `Object.assign`, `Object.is`, and array `map`/`sort` on the real
stdio namespace. Exact keys are
`["error","errorBytes","readBytes","readText","write","writeBytes"]`;
each entries pair reports `"function"`. `ownsWrite:true`,
`copiedWrite:"function"`, `sameWrite:true` show a legitimate copied callable
alias, not privileged operation access. Shell status0, empty stdout/stderr,
unchanged VFS and all counters1 match the frozen dialect profile.

Namespace object spread is separately exercised by original cases03/04.
Function spread in case08 is not interchangeable with that positive. Direct
`__proto__`/`prototype`/`constructor` reads in other frozen rows are also not
execution of the absent descriptor/getPrototypeOf operations. Reflect calls,
`Object.defineProperty`, `Object.setPrototypeOf`, `Object.create`, arbitrary
prototype mutation and constructor/binding revisions are not established here.

The actual copied Object builtin supplies the supported operations just listed,
not the unavailable methods. The copied host bridge can preserve function-valued
host data properties, and callable-member lookup has a custom-property path.
Therefore callable enumeration or absent reflection alone is not a general
engine security boundary. The real facade identity/descriptor witnesses and
the six preceding field-access cases remain their own bounded evidence. No new
callback attempt, raw-host grant, broader surface probe or case09 is proposed.

## Minimal separately versioned observer proposal

`observer-only.patch-data` is **inert data**, not applied to any file. Its base is
the original `execution-v1/child.mjs`, SHA-256
`5cab487b9a63feade2048a1f6b13fb3756f668d14f7a3ecacbf7b921da97c13d`.
If later approved, apply the delta only to a separately named/frozen new runner
copy. The generic `a/child.mjs` / `b/child.mjs` patch paths do not authorize
editing v1. `proposed-record.data.json` defines additions; it is not a fabricated
execution result or a replacement for CASES.json.

The only proposed semantic instrumentation is a harness-owned `engineOutcome`
tag: `not-entered` → `entered` → `fulfilled`, `call-threw`, or `await-rejected`.
It separates a synchronous call throw from rejection of the one awaited return.
The catch records only `typeof reason` and `reason === null`, appends a distinct
event, then **`throw reason`** using the same binding. On fulfillment the existing
engine result recorder and budget-used capture remain unchanged. The internal
function call is still made once with identical source/options references and
awaited once; no new callback, timer, race, sink write or budget is introduced.

Do not call `errorInfo`, `String`, `JSON.stringify`, descriptor reflection or
unknown reason properties in the new catch. Such reads could trigger a getter,
proxy trap or serialization hook and replace the original failure. The minimal
tag intentionally does not capture rejection message/name/stack. The existing
public diagnostic remains a separate exact observation. Reason identity is
preserved by the proposed rethrow; it was not dynamically measured in old case08.
No arbitrary thenable is relabeled as a Promise by the tag; the tag describes
the await outcome, with the pinned engine signature supplying its Promise basis.

Only harness record assignments and event appends precede the same rethrow.
There is no new await before propagation. The product catch, output drain,
operation finally and outer cleanup ordering are untouched. Existing caller
identity, public API behavior, terminal abort behavior and lifetime controls are
not replaced or bypassed. A proposed rejection event would precede the existing
operation-close marker; that is a proposed observer receipt, not a newly observed
event in the old record.

### What stays unchanged, including the failure

All eight original guest byte strings, argv/stdin/VFS fixture bytes, module
facades, host premise, product/engine/loader copies, budgets/deadline policy,
parent watchdog, cleanup callbacks, native-handle guards and original assertions
stay unchanged. No constructor/binding alteration is included.

**There is no `record.engine = {ok:false,...}` synthesis on rejection. There is
no assessor or expected-data patch.** A rejected case08 will therefore still
fail the original two result-shape checks, now with an explicit outcome receipt.
This observer-only proposal is deliberately not an 8/8 migration. A different
signed reviewer must review the preserved failure and any subsequently proposed
expectation change; ROOT must authorize that separate work before a new score.

### Finite instrumentation controls for later approval only

These are planned host-only observer checks, not new guest cases and not engine
acceptance. None has been implemented or executed here:

| Finite input | Required evidence |
| --- | --- |
| Fulfilled `{ok:true,...}` and fulfilled `{ok:false,error:sentinel}` | One call/await; same result reference forwarded; `fulfilled`; existing recorder distinguishes ok values; no rejection event |
| Synchronous throw and immediately rejected Promise using one frozen sentinel | Correct distinct tag/event; outer catch receives `Object.is(received,sentinel)`; no fulfilled recorder; no wrapping or swallowing |
| Immediately rejected `undefined`, `null`, `false`, `0` | Exact same reason at outer catch; correct typeof/null tag; no truthiness-dependent omission or synthetic result |
| Frozen sentinel with counted/throwing message getter | Zero observer getter reads; same reason rethrown; no raw-host capability granted to guest |
| Finite finally marker on fulfillment and rejection | Exactly one finalizer marker after the outcome marker; original result/reason preserved; no nonsettling work |

The signed reviewer should first approve the delta and negative controls. Any
later actual-engine execution requires ROOT release, a new runner commit/hash
freeze, authenticated regular inputs and existing bounded child/private guards.
No additional guest cohort or implementation is authorized by this report.

## Checks, attempts and closeout

The recorded authentication command is:

```sh
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/integration/safejs-owned-output-prototype-review/surface/validity-proposal/authenticate.mjs
```

It was run in a known child with a 30-second outer deadline; status0, no signal,
no stderr. It performs read-only hashing/public Git access, not a runtime probe.
One earlier read-only discovery lookup incorrectly named
`candidate/src/integrations/safejs/README.md` and reported ENOENT. The actual
command README and integration source/declarations were then inspected. This
lookup mistake is retained in `PROOF.json`; no guest attempt resulted from it.
Original first failures, freezes and raw metadata were not edited or discarded.

`SEAL.json` binds the proposal inputs; `CHECKS.json` records the static check.
The inert delta is checked
as text against the committed base; no modified executable child is materialized,
imported or run. No new dependency, private build/install, worktree, symlink,
loader service, native oracle, guest child or worker is created in this phase.
All finite authentication/inspection children have returned; no background work
or polling remains. Production/private/old audit files remain untouched by this
proposal. Only explicit new owned files are committed; foreign work is preserved.

**Stopped pending ROOT approval and different signed review. NO PROMOTION.**
