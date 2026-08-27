# Independent validity review — phase 1

**August 27, 2026. NO-PROMOTION. Static review only; no new pass.**

Signed reviewer identity: **Codex independent leaf verifier**, thread
`01a043dd-cfc3-7f93-8f3b-70e2d7b1d2a4`. This is a new review, independent of
surface author `01a04292-5421-7363-8bcb-a70b97fae4e9`, lifecycle author
`01a04292-c8dd-7331-9dac-619c9861b11b`, and original preparer
`01a0438a-acfd-7dd0-8d20-a9d07a3c527c`. Identity is an explicit agent/thread
attestation, not a claim of a cryptographic personal signature. `SIGNATURE.json`
binds this report and its supporting records by SHA-256.

## Decision summary

| Target | Independent conclusion | Original result retained |
| --- | --- | --- |
| Surface 08 | Observer assumed a fulfilled failure-result shape. Raw evidence contains no engine rejection value. The public command does fulfill with status 1 and the expected diagnostic. | FAIL, two missing-field assertions; not a membrane pass |
| Surface 07 | Exact unavailable reflection helpers and supported operations are measured. This is a dialect profile, not general reflection/membrane proof. | Matching profile, separate from six supported surface passes |
| L05 execution-error | The nested invocation completes with status 1. The explicit existing contract allows the registered cleanup failure to determine public rejection in this situation. The intended selected-execution prerequisite is unestablished. | FAIL, not a replacement pass or a general fixture-invalid waiver |
| L06 open | Constructor rejects zero `maxRedirects` before guest/transport admission. Positive-only host limits are implemented, but the inspected public declarations/docs do not state that lower bound. The fixture-invalid label is not a proven contract judgment. | Original INVALID_FIXTURE retained; independently qualified as pre-admission configuration rejection / host-range contract unresolved |
| L06 closed | Positive prerequisite did not succeed; no child/guest was launched. | BLOCKED |

There is **no established owned-output precedence or privilege-exposure defect
in these observations**. There is a **possible pre-existing network host-cap
validation/design defect, or missing range documentation**, requiring root/user
contract adjudication. It must not be erased by calling all zero limits invalid.
Conversely, a TypeScript `number` declaration alone does not prove every numeric
value is supported. Neither ambiguity is a pass.

## Scope, authority and authentication

Only this new `validity-independent/` directory and reviewer-owned regular TMP
artifacts are writable. The parent and repository AGENTS rules were read. No
scoped AGENTS file applies below this directory. Ownership comes from the current
root assignment, not historical worker names in documentation.

Exact authoritative commits:

| Input | Commit |
| --- | --- |
| Independent assembly authentication | `07a7dae5db51612a23e74d1d164d33723d4d61b6` |
| Its report-only correction | `db139ae983ad66364e0367f9fb1ed0262ee61f63` |
| Surface frozen inputs | `5645b4f516438b66e4fad32a585ab27cda8f7cdc` |
| Surface frozen runner | `5d2c2f93d794b2a52d56ee503119052a5fefe1fd` |
| Surface original results | `b0ff1977c9c912054edd136510d62819d28cf890` |
| Lifecycle frozen inputs | `c8df5cf2819d7ad9d54c2a70800258c7c200665a` |
| Lifecycle frozen runner | `91464989ff4c563195330cc3a7cacc4500c0bad0` |
| Lifecycle original results | `19da254941847de60e80ea18407332bbe10b5265` |

The original reports are exactly
`surface/execution-v1/attempt-01/REPORT.md` and
`lifecycle/execution-v1/REPORT.md`, relative to their common review parent.
Additional original CONTRACT/Q1 documents are read from the lifecycle freeze
commit, not later live author proposals. `INPUTS.json` records exact commit/path
bindings and hashes, including relevant original documentation and tests.

Both retained regular routes under
`/private/tmp/safe-bash-owned-output-receipt-review-zqBitE/` match all **940**
entries of the independent assembly receipt's `routes.candidateFiles`, not just
reported totals. Each contains **213 source files**, manifest
`6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea`, and **708
compiled files**, manifest
`2578b6ea39cfdeb5b942b9aff20ec9bfff1fcf907cd2af751d8e73f5c24e632f`. Complete
candidate manifest:
`a2632992e84344c1a6a92fcee181a1e6d535d6cb87ef1a9a7841e48af9c02e28`.

The existing regular `engine/` copy under
`/private/tmp/safe-bash-owned-output-prototype-preparation-rE94MK/` matches all
**264** frozen preparation engine entries. Its manifest is
`e3af7cb5d53cb3c64d22f7ac20c187cc3b7347754857811f210b8c32a937d90f`, bound by
preparation `f666ad8c76ea4362b093ee52e3e7e3b5c3702916` to recorded private HEAD
`bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`. That is historical attribution, not
a fresh assertion about the private checkout. **No private checkout query or
write occurred**, so no new private metadata guard was needed or claimed.
Private source bytes are not copied into this report or committed artifacts.

Hash/metadata checks are data inspection, not product execution. No guest,
engine, package runtime, native oracle or network transport was invoked; no
build, installation, source fix, fixture migration, environment/shebang/dispatch
edit, worktree, symlink write, or upstream patch occurred. No author proposal
directory was read. Historical raw captures and original assertions are unchanged.

## Surface 08: what is captured, and what is inferred

Frozen guest: `surface/probes/08-function-spread-profile.guest.txt`, SHA-256
`96a9b23cc16568b930baaa636e16ed8a6134c9e18f4d8d289d0ccb4378a41462`.
The guest attempts object spread of the imported stdio callable. This is not
namespace spread, descriptor enumeration, or a parser-rejection observation.

The original `raw/08-function-spread-profile/actual.json` records one actual
engine call and these events in order: engine start; operation close settled;
shell exec settled; operation, pipe, collector and shell cleanup settled. There
is **no** `actual-engine-run-settled` event and **no `engine` property**. Absence
is not a captured `engine: null`, `ok: false`, TypeError instance, rejection
reason, stack, or exact object identity.

The public shell **fulfilled**, not rejected: exit code **1**, zero stdout bytes,
stderr exactly `safejs: Cannot spread function into object literal.\n` (52 bytes).
No VFS effect, privileged identity finding or cleanup failure is recorded.
`assessment.json` has exactly two failed checks: `engine ok` and `exact error`;
both expected fields are missing, rather than observed mismatches. Public
status/stdout/stderr and the cleanup checks already pass in that original run.

The original observer (`surface/execution-v1/child.mjs:135`) awaits the engine
and only then writes the settlement event and result fields. It has no rejection
recording branch at this boundary. The copied interpreter's object-spread
closure branch throws; the copied run implementation propagates exceptions.
The public adapter (`src/commands/safejs/index.ts:103`, `:112`, `:119`) catches
runtime failure, completes its shutdown, diagnoses, and selects status 1.
These independently inspected paths and the original events support a
**rejected engine-Promise inference**, not a newly captured rejection. The
raw runtime-signal AbortError belongs to facade teardown and is not evidence
of the function-spread rejection's name, stack or identity.

The private-copy implementation references are `src/interp/interpreter.ts:3582`
(SHA-256 `4d33fdba962311153d7cc8ce10d93990fe5db2604513b52fa1f3ea4cbdffc715`)
and `src/run.ts:446` (SHA-256
`243e3ca4efef03f6df73a50ef2f23fdcee4ef07c4e26eca7f498bf7823988e1b`). These are
metadata references only; no private implementation excerpt is included here.

### Surface 07 and the actual privilege evidence

The guest observes `typeof Reflect === "undefined"`, and the same type for these
five `Object` members: `getOwnPropertyDescriptor`, `getOwnPropertyDescriptors`,
`getOwnPropertyNames`, `getOwnPropertySymbols`, and `getPrototypeOf`. It does not
exercise those unavailable operations or prove that host objects lack prototypes.

Supported observations are exact stdio keys/entries for `error`, `errorBytes`,
`readBytes`, `readText`, `write`, `writeBytes`; each entry is a function.
`Object.hasOwn(stdio, "write")` is true, the `Object.assign` copy's write is a
function, and `Object.is` preserves its identity. Engine `ok: true`, public
status 0 and empty output match the frozen dialect profile.

Cases 02–04 collectively inspect 25 shape rows: 12 direct namespace/data/callable
rows, nine nested/copy/alias rows and four explicit shell/result rows. Their
`ownedOutput`/`registerCleanup` member types are undefined and own-property
checks false. Cases 05 and 06 separately record zero callback/acquisition/release
calls and the caught non-function diagnostic. A legitimate stdio `write` method
is not evidence of the host's privileged accounted-write capability.

The host really possessed `context.registerCleanup`, the pipe's `ownedOutput`,
its `consumerClosed` signal and accounted `write`, and a real output operation.
The runner verifies those premises before forwarding only `operation.output`
as stdout to SafeJS; it does not inject those authorities into the guest.
The recorded descriptors at depths 0–2 contain no matched tracked authority
identities; `hostFindings` is empty in all eight originals. This is bounded
inspection of the visited properties, not exhaustive graph/closure inspection
or a universal non-leak proof. The conditional case 09 was not executed and
does not earn a pass.

## L05: reason, status, bytes and the normative selector

Authoritative existing rule: candidate `src/contracts/command.md:99` selects
caller-abort reason first, then an execution rejection **selected by the existing
execution path**, then registered cleanup failure, then the command result.
Lines 106–109 explicitly say a completed CommandResult, including nonzero
status, does not hide cleanup rejection. The original qualified prototype's
`CONTRACT.md`, section 5, incorporates that rule and independently requires
owned code to preserve an established execution throw through awaited close.
Neither rule says that every engine/host/utility throw must escape public Shell.

This distinction predates this failure. Original
`owned-output-qualified-prototype/FIXTURE-CORRECTION.md` preserves ordinary
command-throw conversion failures; `SELECTED-BINDING-PRE-RUN.md` explicitly
separates a subsequent outer syntax-diagnostic sink rejection from ordinary
command conversion. Original Q1 `execution-q1/REPORT.md` likewise distinguishes
selected raw rejections from status-only observations and withholds unsupported
ordering claims. Those documents justify the distinction independently of the
implementation under review. Their historical result totals are not re-adjudicated.

In `L05-execution-error.json`, with caller not aborted:

| Event order | Recorded observation |
| --- | --- |
| 7–9 | First accounted write accepts `admitted\n` |
| 10–12 | Second write attempts `selected\n`, rejects at the public sink, facade signal aborts with executionError |
| 13–14 | Attempted SafeJS and shell diagnostics reject with that same executionError |
| 15 | Engine rejection is recorded (unlike Surface 08) |
| 16 | Actual nested `context.invoke("safejs", ...)` **fulfills with status 1** |
| 17–21 | Close starts, resource release completes, cleanup rejects with cleanupError and is observed |
| 22 | Attempted cleanup diagnostic also rejects with executionError |
| 23 | Public exec rejects with the identical cleanupError |

Accepted stdout is exactly `admitted\n`, hex `61646d69747465640a`; accepted
stderr is empty. No public exit status exists for this rejected exec. The
status **1** belongs to the nested command result, not a fabricated public
result. Attempted diagnostic bytes are not accepted stderr. Exact attempted
texts are `safejs: execution:L05-execution-error\n`,
`shell: line 1: execution:L05-execution-error\n`, and
`shell: line 1: cleanup:L05-execution-error\n`.

The frozen wrapper (`lifecycle/execution-v1/child.mjs:334`) records a primary
only if nested invoke rejects. Here invoke returns a result; the subsequent
cleanup-only rejection becomes its failure. Candidate runtime
`src/shell/runtime.ts:510` converts ordinary command failures, observes and
suppresses diagnostic-write failure unless aborted, and returns status 1.
Literal invoke uses that path (`:1351`, `:1383`). Public `Shell.exec`
(`src/shell/shell.ts:87`) drains and then applies caller / selected rejection /
cleanup / result order. Thus cleanupError winning is **consistent with the
explicit contract in this topology**, not evidence of a finally-close overwrite
of an established public primary.

Keep the original FAIL. It is a genuine failed intended-selector assertion,
not a license to change the expected identity to cleanupError and call the
precedence test green. Its frozen qualification already requires source-selected
rejection, not merely a failing diagnostic sink. The caller and cleanup-only
controls keep their own original passes; they do not repair the missing
selected-execution arm. No new precedence bug is established here, and this
does not prove absence of other prototype bugs.

## L06: host cap contract is not CLI behavior

Frozen limits include `maxRedirects: 0`, `maxRetries: 0`, with positive byte,
URL and time limits. Exact argv has `-sS -T - -o /work/body.bin -D
/work/headers.txt -w` followed by the frozen format and URL. It contains no
`-L` or `--retry`. The explicit transport is fixed to one authorized PUT, a
200 response, fixed upload/body/header bytes and independent stderr; it is
not a native curl or network-service experiment.

| Evidence layer | What it establishes |
| --- | --- |
| `src/commands/network/types.ts:35` and published `dist/commands/network/types.d.ts:28` | Both caps are `number`; options accept `Partial<NetworkLimits>`. No lower-bound annotation or branded range is declared. This is not proof that all numbers are valid. |
| Network README `:24`, `:72` and frozen root README curl section | Host limits, defaults of ten redirects/five retries, and CLI ceilings are documented. No positive-only lower bound or explicit zero-host-cap guarantee was found. |
| `src/commands/network/shared.ts:7` | Every host limit must be a safe integer at least 1; `maxTimeMs` additionally cannot exceed 2,147,483,647. This is the **implemented** range, not a documented normative precondition discovered elsewhere. |
| `src/commands/network/args.ts:52`, `:73`, `:111` | Integral CLI retry/redirect arguments accept nonnegative integers through MAX_SAFE_INTEGER and are clamped to host ceilings. Retry count defaults to 0; redirect following defaults to false. |
| Original network tests and Q1 fixtures inspected at the freeze | Positive host-cap examples exist; they do not prove zero is prohibited. No explicit zero-host-cap allowed/rejected contract test was located in the inspected network test scopes. |

The root README's sentence about positive safe-integer overrides at line 190
belongs to **stream-format/split**, not network limits. Applying it to curl
would invent a contract. No primary native/protocol fact is needed for this
repository-API distinction; no external browse or native probe was performed.

The implemented first rejection is from `limitsFor` during `curlCommands(...)`
construction (`network/index.ts:13`, `network/curl.ts:73`), before `.use` can
register it and before guest invocation. Default property order places
`maxRedirects` before `maxRetries`. The captured public result is status **1**,
zero stdout, stderr exactly
`shell: line 1: Invalid network limit: maxRedirects\n` (51 bytes). The originating
RangeError type is a source-path conclusion; the original record does not
contain a separately serialized raw constructor rejection. The public exec
itself fulfilled. It is not curl exit 2, a rejected public exec, or a transfer
failure after a request.

Zero engine runs and authorizations, no transport-enter/upload/response events,
no curl status, zero accounted writeout calls, and ENOENT for the required
body/header files are recorded. The wrapper's one acquired resource is released;
the inner Shell is disposed before public settlement. The transport cleanup
hook was **not** reached. Rejecting `maxRetries: 0` after a valid earlier cap
is statically predicted by the same validator, **not a second captured failure**.
The closed-consumer row remains blocked by missing positive `L06-curl-open`.

The original runner labels any zero-engine-run row `INVALID_FIXTURE`
(`lifecycle/execution-v1/child.mjs:442`), regardless of whether the admission
failure violates a product contract. That mechanical label cannot adjudicate
this question. Zero can meaningfully specify no retries or no redirect hops;
a count ceiling must not be assumed to be a positive work budget.

The relevant validator, argument parser and network README are byte-identical
to baseline `c9b96263d1204bdf54e89324cc0c7d1ef6bd3f79`; the blanket rejection
is not newly introduced by TEMP ownedOutput. The types file as a whole differs
and is not misrepresented as unchanged. No explicit documentary contradiction
was found: **the host lower bound is absent/ambiguous**, while implementation
and CLI ranges differ at distinct API layers. This warrants a possible
pre-existing API/design or documentation issue, not a proven zero-host-cap
violation and not a definitive invalid-fixture acquittal.

## Minimal-delta criteria for a later signed review

These are review criteria, **not permission to edit or execute**. Original
captures, counts, failures and source identity must remain intact. Any later
author proposal must arrive as exact hashes from root and receive a different
signed review before a new bounded run. Semantic assertion changes require
root/user approval first.

1. **Surface 08:** A possible observer-only correction records fulfillment and
   rejection separately at the existing engine await, then rethrows the exact
   caught value without wrapping, substitution, extra execution or extra host
   grant. Do not synthesize `engine.ok = false`. Keep the guest, public status,
   exact bytes/effects, budgets and cleanup checks unchanged. Replacing fulfilled
   result expectations with rejection expectations is still an explicit
   observation/assertion delta requiring approval; do not retroactively relabel
   the original missing fields as captured rejection evidence.
2. **Surface 07:** Preserve the six exact unavailable names and supported
   positives. Do not add a reflection capability, substitute a host implementation,
   rename the row into membrane acceptance, or turn conditional case 09 into a pass.
3. **L05:** No report-only label or expected-identity swap can establish selected
   execution. A proposed new binding must demonstrate, through the actual public
   execution path, the same primary identity selected before public outcome
   settlement, alongside registered cleanup failure and exact byte/event claims.
   Historical outer syntax-diagnostic controls explain the distinction but do not
   authorize adding that topology or replacing this SafeJS row. Preserve ordinary
   status-conversion observations separately and obtain root approval for any
   semantic change; no prototype fix is justified by this capture alone.
4. **L06:** **No unconditional constructor correction is approved or recommended
   as contract-proven in phase 1.** First resolve whether zero is a supported host
   prohibition or positive-only host caps are the intended bounded API profile.
   If root explicitly accepts the positive-only profile for this scenario, the
   smallest implementation-compatible candidate is changing only the two host
   fields to 1, not dropping them to defaults of 10/5. This is a conditional
   proposal criterion, not an accepted fix: it raises the host ceilings and
   cannot be represented as preserving literal zero host authorization.
   Under unchanged argv, no redirect-follow flag, default zero retries, fixed
   200 response and one-request authorization/transport assertions, zero **actual**
   retries/redirects can still be the intended scenario. Preserve streaming,
   producer-reuse copies, upload barrier, consumer-only close, independent files/
   headers/stderr, exact 0/141 status expectations and cleanup order. Do not add
   CLI flags, increase other limits, prebuffer uploads, weaken assertions or run
   the closed row without its successful positive. If zero host caps themselves
   are required, keep the rejection as a possible product issue and route it to
   its owner; changing the fixture would silently remove that requirement.

## Closure and remaining questions

Original surface accounting stays **7/8 raw assertions**: six supported cases,
one dialect match and one observer failure; conditional case 09 unexecuted.
Original lifecycle accounting stays **8 PASS, 1 FAIL, 1 INVALID_FIXTURE,
1 BLOCKED**, with the L06 contract qualification above. This phase executes
zero rows and adds zero passes. No whole-gate, native parity, superiority,
72-hour-duration or production-promotion claim follows.

Unresolved decisions are the network host zero-cap range and the authority to
change observer/selector semantics. Streaming/retention under the L06 setup and
the intended L05 selected-execution competition remain untested by this cohort.
Exhaustive SafeJS privilege/membrane safety remains unproved.

`INPUTS.json` records the static check interval, complete shared-copy equality,
frozen bindings and inspection limits. The before snapshot began after initial
instruction/receipt and preliminary source reads, not before the first read of
this session. Re-enumeration checks regular files plus directory names and rejects
symlinks: it detects new entries, including empty directories, in those three
scoped trees. File mode/mtime/ctime and bytes are compared; directory metadata,
atime, intervening mutations and unrelated trees are not covered. Live public
edits are not candidate inputs and were neither reset nor claimed unchanged.

After the owned atomic commit and readiness marker, this verifier stops without
reading author proposals, polling root, adding waiters or launching probes.
