# Lifecycle validity reconciliation — proposal only

**NO-PROMOTION. No new guest, engine, product, parser or native curl execution.**
This is the original lifecycle author's source/contract reconciliation, not the
different reviewer's acceptance. ROOT must separately approve any revision.
Original `19da254941847de60e80ea18407332bbe10b5265` remains **8 PASS / 1 FAIL /
1 INVALID_FIXTURE / 1 BLOCKED**, eleven rows/six workflows. No original result,
assertion, fixture, runner, budget or classification is edited here.

## Authority and authenticated inputs

`STATIC-PROOF.json` binds all 74 original lifecycle files to their `19da2549` Git
blobs, including original fourteen-file `c8df5cf2` preparation and pre-execution
`91464989` runner. It authenticates the retained source-route and package-route
940-file trees and 709-file installed TEMP package against original execution
inventories, before and after this static check. No copy, build or import occurs.
Source remains 213 files / SHA256
`6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea`;
compiled remains 708 files / SHA256
`2578b6ea39cfdeb5b942b9aff20ec9bfff1fcf907cd2af751d8e73f5c24e632f`.
Receipt `07a7dae5` plus report correction `db139ae9` authenticate assembly only.

All `src/...` and `dist/...` references below are relative to authenticated
`/private/tmp/safe-bash-owned-output-receipt-review-zqBitE/source-route`, **not
the evolving live product**. Compiled references also match the retained public
package. S1 and qualified/Q1 documents are authenticated at
`e57b5aa16f749b6fac558877dff0712e64df05a8`; S2 has no additional source patch.
The full source identity and individual relevant hashes are in the static proof.

## L05: normative decision, not implementation-as-oracle

**The frozen public precedence contract does not require executionError for this
observed path. It requires cleanupError once the existing execution path selects
a completed status and there is no caller abort.** This conclusion uses the
normative conditional, not just the implementation's differing result:

- `src/contracts/command.md:99` chooses caller exact reason, then the original
  rejection **selected by the existing execution path**, then sole cleanup failure,
  then result. Line108 explicitly says a completed nonzero result does not hide
  cleanup rejection. Contract SHA256:
  `8a5426b1e7a30a03dc62f74b28c6eb7bf9b008b78cb7b521eb7de0bc5c59a3f8`.
- `owned-output-qualified-prototype/CONTRACT.md:35` expressly makes that command
  contract authoritative and distinguishes local IO identity from public selection.
  Line37 forbids finally-close overwriting an **established execution throw**;
  it does not reclassify every previously handled nested IO failure as one.
  This is stronger guidance for owned callers than S1's warning that bare finally
  may mask a throw; it does not create a competing public precedence policy.
- `owned-output-streaming-prototype/CONTRACT.md:74` preserves genuine command
  statuses and caller-public precedence, separate from first local operation reason.
  `src/commands/safejs/README.md:217` separately documents guest/runtime errors as
  status1 and parent cancellation as an exact-reason rejection.
- Qualified author Q02 retains original ordinary-registry-throw failures and
  separately names its syntax-diagnostic selector. Independent
  `owned-output-qualified-review/ordering-replay-q1/REPORT.md:31` likewise rejects
  a missing selected-rejection premise and requires actual diagnostic/order markers.
  Those earlier scores are not SafeJS evidence and are not added to this cohort.

Existing baseline tests support the distinction, without being rerun here:
`c9b96263:tests/shell/invocation-cleanup-lifecycle.test.ts:58` uses a real
`ShellLimitError` for the selected-rejection control; line72 asserts ordinary
Error-to-status1 plus exact diagnostic after successful cleanup. They do not
directly test this SafeJS/sink/cleanup combination. Their Git identities are in
the proof, not substituted for candidate tests or current whole-suite acceptance.

### Original exact inputs and observations

Public source is exactly `owned-guest`; stdin is the empty byte array. The host
wrapper literally invokes `safejs` with `['-e', exactGuest, '--']`. Frozen guest:

```js
import * as stdio from "stdio";
const emit = stdio.write;
await emit("admitted\n");
await Promise.resolve().then(() => emit("selected\n"));
return "precedence-complete";
```

Host Errors are constructed once: `execution:L05-execution-error` and
`cleanup:L05-execution-error`. The second stdout write throws the former;
all three attempted public diagnostics also throw that same host object.
The registered resource release throws the latter. Caller is **not aborted**.
Original in-child reference checks, not serialized messages, establish the
public identity. The engine's serialized error message alone is not a separate
engine-object identity proof.

| Original order | Actual event and significance |
| --- | --- |
| 3 < 4 < 5 | Cleanup registered, actual output operation constructed, resource acquired. |
| 7–9 | `admitted\n` accounted write and external acceptance complete. |
| 10 < 11 < 12 | `selected\n` write starts, external sink throws executionError, SafeJS facade signal aborts. This is not caller abort or evidence that the output operation itself aborted. |
| 13 < 14 | Diagnostic attempts `safejs: execution:L05-execution-error\n` and `shell: line 1: execution:L05-execution-error\n` reject with the host executionError. |
| 15 < 16 | Engine rejection observed; **nested safejs invocation resolves `{exitCode:1}`**. |
| 17 < 18 < 19 < 20 < 21 | Shared close entered; resource release entered/completed; release and close reject with cleanupError. |
| 22 < 23 | Attempted `shell: line 1: cleanup:L05-execution-error\n` diagnostic rejects with executionError; public exec rejects with the identical cleanupError. |

Externally accepted stdout is exactly `admitted\n`, hex `61646d69747465640a`;
accepted stderr is empty. Rejected diagnostic attempts are **not accepted stderr**.
There is **no public ShellResult/exitCode**: public exec rejects. Status1 is the
nested command result, not a public rejection reason or public returned status.
Shell capture writes precede the external sink (`src/shell/shell.ts:115`); its
unreturned internal buffers must not be confused with accepted external bytes.
One acquisition/release completes before public settlement; no caller rescue.

### Where translation happens and why cleanup wins

1. `src/commands/safejs/io.ts:68` records the output failure; the command's local
   controller publishes cancellation (`safejs/index.ts:54`). The command handles
   its run/output error and attempts its own diagnostic at lines120–124.
2. That diagnostic itself rejects. Its rejection escapes the SafeJS definition
   (`safejs/index.ts:40`), but remains inside ordinary command execution.
   `src/shell/runtime.ts:510` unwraps it, checks the actual runtime signal, attempts
   a shell diagnostic at522, catches that sink failure at523, rechecks abort and
   selects status1 at526. No caller abort, ShellLimitError, ShellSyntaxError or
   EPIPE is selected in this row. The facade's private controller did not abort
   the caller/runtime signal.
3. Frozen host wrapper `execution-v1/child.mjs:334` uses separate failed/value
   slots. `context.invoke` returns status1, so no primary throw is established at
   that ownership boundary. Its explicit idempotent close then fails; that is
   propagated, not used to overwrite a caught execution throw. The wrapper's
   ordinary cleanup Error and diagnostic failure are again translated by runtime.
4. `src/shell/cleanup.ts:46` observes the registered shared close rejection and
   retains it in invocation failures; one resource is released, not reacquired.
   Public `src/shell/shell.ts:96` drains, checks caller, preserves a selected
   `#execute` rejection if any, otherwise throws the sole cleanup failure at104.

Thus no violation of the cited conditional public precedence or primary-preserving
owned-caller rule is established **by this original observation**. Calling the
original program invalid would be too broad: it is a valid supported workflow,
but not a selected-execution-rejection control. Original raw FAIL stays FAIL;
the intended selected-rejection target stays UNPROVED. This does not certify all
precedence paths or dismiss a contrary normative contract supplied by ROOT.

## L06: zero-valued host caps are a documentation ambiguity

**Do not treat zero as intrinsically an invalid budget.** Zero is a meaningful
no-retry/no-redirect ceiling. The observed constructor rejects it, but the
inspected public types/docs do not document that lower bound. The previous raw
INVALID_FIXTURE label describes inability to enter this implementation; it is
not a normative finding that requesting a zero host cap is illegitimate.

| Field/surface | Documented or declared range | Authenticated implementation |
| --- | --- | --- |
| `NetworkLimits.maxRedirects` | `number`; default10. No documented minimum/maximum/integer constraint in network README or declaration. | `limitsFor` accepts safe integers 1..9007199254740991; rejects0. |
| `NetworkLimits.maxRetries` | `number`; default5. No documented minimum/maximum/integer constraint in network README or declaration. | Same safe-integer 1..9007199254740991 check; rejects0. |
| CLI `--max-redirs` | Listed supported; CLI may not raise host ceilings. Network README supplies no complete numeric range. | `args.ts:52` accepts decimal nonnegative integers through MAX_SAFE_INTEGER; line111 clamps to host cap. Zero is accepted; negative/unlimited -1 is not. Only `-L` enables following. |
| CLI `--retry` | Listed supported for specified completed HTTP responses; CLI may not raise host ceilings. No complete numeric range documented. | Same nonnegative parser; line112 clamps to host cap. Default retries0 (`args.ts:77`). Zero requests no retries. |

Sources: `src/commands/network/types.ts:35`, compiled
`dist/commands/network/types.d.ts`, `src/commands/network/README.md:24` and74,
`src/commands/network/shared.ts:7`, `src/commands/network/args.ts:52` and111.
S1 CONTRACT and qualified CONTRACT §6 require streaming/independent effects;
neither specifies a host numeric minimum. Existing frozen candidate's fifteen
test/helper files contain no zero-host-cap acceptance/rejection assertion.
The six canonical network TypeScript files at historical c9b likewise contain no
explicit test of either host cap at0; `safety.test.ts:19` checks CLI retry -1,
`http.test.ts:77` checks CLI max-redirs2. No current/live test sweep is claimed.
The relevant network README/shared/args bytes equal c9b; proof records that equality.

Official primary documentation cross-check, consulted **August27,2026**, not a
native execution: curl's current manual defines retry0 as no retries; libcurl's
MAXREDIRS documentation expressly permits0 to refuse redirects. These establish
why zero is meaningful, not the policy of this separate TypeScript host API.
References: `https://curl.se/docs/manpage.html#--retry` and
`https://curl.se/libcurl/c/CURLOPT_MAXREDIRS.html`. No curl binary/version/platform
parity claim or guest-exception native oracle follows. No private material was searched.

**ROOT routing:** this is an undocumented implementation restriction / public
configuration ambiguity, not a proven explicit-doc contradiction and not a
new owned-output cleanup bug. A blanket source loop cannot by itself prove the
normative min1 contract. ROOT/source owner must decide whether zero should be
supported or the positive-only host profile is intentional. This leaf neither
changes production nor chooses a green interpretation.

### Original early rejection, exact boundary

Frozen caps: upload1024, download1024, buffer4096, header4096, **maxRedirects0,
maxRetries0**, URLs1, time2500ms. Both fields are host constructor limits, not
CLI options. `curlCommands(...)` synchronously reaches `createCurlCommand` and
`limitsFor` before `inner.use` receives the plugin (`child.mjs:292`). Default
object order places maxRedirects before maxRetries; the first RangeError is
`Invalid network limit: maxRedirects`. Rejection of maxRetries0 is a **static
consequence of the same guard**, not a separately executed result.

Actual public Shell result: exitCode1, stdout empty, stderr exactly
`shell: line 1: Invalid network limit: maxRedirects\n` (not curl option status2).
No guest run, authorization, request, upload/response bytes, or body/header files.
Engine modules had been imported in that child; zero guest runs is not zero imports.
Events3/5 enroll/acquire outer resource;6/7 enroll/acquire inner Shell;8/9 release
outer resource;10/11 dispose inner Shell;12 publishes diagnostic;13 settles.
Dependent L06-closed is not launched because its frozen positive prerequisite
is invalid. It is not evidence that closed stdout blocks or preserves transport.

## Conditional revision requests, not approvals

`PROPOSALS.json` is inert metadata, **not an applicable patch or executable runner**.
No original file is a write target. Any later runner must be separately versioned,
reviewed and hash-frozen before a separately authorized child execution.

1. **L06-C1, separate positive-host-cap binding:** propose only two constructor
   values 0→1, retaining exact guest/argv/byte inputs, existing deadlines and
   all status/stdout/stderr/file/cleanup expectations. This changes host capability
   ceilings, even though the workload requests no retry/redirect; it is not an
   unchanged-input replay. Add explicit single-admission/transport counters,
   attempt0/no-redirectFrom checks and fail-closed authorization for any second
   admission. With original argv (no -L/--retry), response200/no Location and
   exactly one request, actual retry/redirect counts must both stay0. Raising
   the caps is proposed solely as an alternate supported binding, conditional
   on ROOT accepting that profile while the zero-cap API question remains open.
2. **L05-S1, explicitly NEW selected-rejection scenario if ROOT wants it:** change
   outer shell source from `owned-guest` to `owned-guest\n)` only in a new named
   variant, keeping the original guest and IO/cleanup Error objects/bindings.
   Incremental parsing (`parser.ts:525`,722; `shell.ts:154`) puts a genuine syntax
   diagnostic after the original command's status/cleanup, outside ordinary
   command-to-status conversion. Its host sink would throw the same executionError.
   Static expected extra attempted diagnostic is exactly
   `shell: Expected command at offset 12\n` (`parser.ts:681`, `types.ts:55`,
   `shell.ts:176`). This is a new source-selected failure, **not proof that the
   original guest error should have escaped**. It needs explicit selector/order
   assertions and separate review before execution. No extra holder, sleeps,
   caller abort, synthetic signal, private hook or budget change is proposed.

L05-S1 retains the original desired public executionError identity and accepted
bytes but changes the scenario/selector and adds exact attempted-byte/order
criteria. L06-C1 retains both original outcome expectations but changes caps and
adds controls. Neither replaces the original fail/invalid/blocked records.
The original non-selector L05 observation and caller/cleanup controls remain
negative/reference evidence, not freshly rerun controls. If a later selector is
unreached or the positive transport never starts, report UNPROVED/invalid—not pass.
No precedence assertion relaxation to cleanupError is proposed here.

## Closure and remaining decisions

`node .../validity-proposal/inspect-static.mjs` is a read-only builtin/JSON/Git
check, not a product test. Its evidence authenticates full regular-file inventories
including new regular entries/removals and rejects symlinks; it does not cover new
empty directories, atime, atomic/intervening or future state. No private checkout
or private source copy is read, so no new private-state verdict is invented.
Original private-before/after evidence remains authenticated inside `19da2549`.
No new case children, workers, sockets, dependency services or temporary product
copies exist to rescue/close. Original execution cleanup evidence is unchanged.

Awaited decisions are ROOT's contract/profile choice and the separate reviewer's
verdict, **not permission for this leaf to wait or execute**. No source/env/shebang
or production8670 gate decision is made. This leaf seals the proposal and stops.
