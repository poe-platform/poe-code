# Lifecycle v2 author result — eleven revised-profile passes

**NO-PROMOTION; author evidence only, not independent acceptance.** One authorized
cohort ran on August27,2026, 16:24:43.358–16:25:03.304 UTC. No retry, post-run
fixture/expectation change, product/private source fix, build or installation.
The driver completed with exit0. This timing is the recorded cohort interval,
not a work-duration or 72-hour claim.

## Freeze, scope and denominator

Freeze commit **`3f6db4dd29950d92410a4d4f9871ba18a5b56e89`** precedes every guest
and product/engine import in this v2 run. `RUNNER-FREEZE.json` binds ten runner,
expected-data, profile, documentation and diff/proof files; the commit also binds
the freeze itself. No one of those eleven files changed after execution began.
Original74 lifecycle files at `19da2549`, the original fourteen c8df preparation
files, 91464989 runner and five 37b89260 proposal files are unchanged.
Signed65a887ac/bbb7f807 and ROOT's explicit release authorize this alternate profile.

| Row / separate variant | Result | Qualification |
| --- | --- | --- |
| L01-aliases | PASS | Unchanged supported facade/operation positive |
| L02-budget-positive | PASS | Unchanged finite-loop positive |
| L02-budget-exhausted | PASS | Unchanged step-budget control |
| L03-callback-live | PASS | Unchanged queued callback positive |
| L03-callback-after-lifetime | PASS | Unchanged same-invocation lifetime control |
| L04-explicit-children | PASS | Unchanged explicit parent/child/sibling scope |
| L05-caller-error | PASS | Unchanged exact caller Error / secondary cleanup control |
| **L05-S1-selected-after-command** | **PASS** | New public source/selector; original branch ID retained |
| L05-cleanup-error | PASS | Unchanged cleanup-only control |
| **L06-C1-curl-open** | **PASS** | Alternate positive host caps; actual streaming positive |
| **L06-C1-curl-consumer-closed** | **PASS** | Same alternate caps; positive prerequisite completed first |

**11 valid PASS / 0 FAIL / 0 INVALID / 0 UNPROVED / 0 BLOCKED**, eleven actual
guest runs, eleven natural child exits, six logical workflows. These are **eight
unchanged controls plus three revised bindings**, not unchanged11 or a rescore.
Original19da remains **8 PASS / 1 FAIL / 1 INVALID_FIXTURE / 1 BLOCKED**. The old
zero-cap label records preadmission rejection, not conclusive normative invalidity.
Historical integration18/19→19/19, original-five1/5, opt-in-five5/5 and other cohorts
remain history; their counts do not contribute to this denominator.

`PROFILE-PROOF.json` authenticates exact guest bytes, all eleven original row
objects/expectations, all budgets, original Error construction and six unchanged
helper/runtime/resource/input/assertion blocks. `CASES.json` has exactly two byte
edits, host maxRedirects/maxRetries0→1. `REVISION.json` supplies separate variant IDs
and public source rather than changing `row.id` or the variable holding guest code.
`DELTA.patch-data` is the complete original-to-v2 child/driver/case diff. All original
assertions remain verbatim; added checks are scoped to the approved variants.

## L05-S1: an actually selected rejection

Original guest `guests/precedence.ajs.data` stays170 bytes, SHA256
`d08209d733eac4792eb3bd4033c2a8fa7c92eae25accdcb99a1b7e6cf90bb69c`.
Literal nested argv remains `safejs -e EXACT_GUEST --`, with empty stdin/guest args.
Public source is now exactly13 bytes `owned-guest\n)`, append hex`0a29`.
Host Errors remain `execution:L05-execution-error` and `cleanup:L05-execution-error`.
No synthetic parser/limit Error, holder, sleep, caller abort or guest capability
was introduced. The real Shell parser selects the later syntax-diagnostic path.

Actual journal: nested SafeJS **fulfilled status1 at16** → release done19 →
cleanupError rejected20 / observed by shared close21 → new exact syntax-diagnostic
sink entry23 → same-object executionError throw observed25 → public rejection26.
The new observer captures status1, cleanupDone, cleanupErrorObserved and releases1
at the actual sink entry; caller remains un-aborted. One selector call and one
throw are observed. Public rejection is the exact executionError reference,
not cleanupError; no public ShellResult/exitCode exists.

All four attempted diagnostics are retained and asserted exactly, in order:

```text
safejs: execution:L05-execution-error\n
shell: line 1: execution:L05-execution-error\n
shell: line 1: cleanup:L05-execution-error\n
shell: Expected command at offset 12\n
```

The last is37 bytes, hex
`7368656c6c3a20457870656374656420636f6d6d616e64206174206f66667365742031320a`.
Accepted external stdout remains `admitted\n` / hex`61646d69747465640a`; accepted
external stderr is empty. Diagnostic attempts/internal capture are not accepted
stderr or an unavailable returned result. Identity comparisons occur in the
child before serialization, not by comparing Error messages afterward.

This meets the frozen conditional selected-execution precedence in this **new
scenario**. It does not prove the original guest Error should have escaped ordinary
status conversion. Original L05's failed identity assertion and unproved selected
predicate remain untouched. Caller and sole-cleanup controls remain distinct.

## L06-C1: real streaming with independently owned effects

The guest uses the existing public shell-module facade to run registered
`owned-curl`; its host fixture invokes real registered `curl` with unchanged
literal argv. The fixture supplies the original streaming stdin to that invocation;
the guest is not given raw ByteSink/operation/cleanup authority. The actual TEMP
curl participant opts in; SafeJS wrapper itself is not claimed to opt in.

Both rows retain `-sS -T - -o /work/body.bin -D /work/headers.txt -w '%{http_code}\n'
https://owned.invalid/upload`, methodPUT, reused three-byte upload buffer and the
first-upload gate. Retained upload fragments are `41300a`, `42310a` (`A0\nB1\n`),
and first upload is observed before EOF. Fixed response200/OK/HTTP1.1 has the
original headers and fragments `626f6479300a`, `626f6479310a` (`body0\nbody1\n`).
No retry/redirect option, redirect response, external network or default transport.

| Observation | Open | Closed consumer |
| --- | --- | --- |
| Exact authorization / transport entries | 1 / 1 | 1 / 1 |
| Authorization attempt / redirectFrom | 0 / absent | 0 / absent |
| Method / live admitted signal | PUT / true | PUT / true |
| Public and nested curl status | 0 / 0 | 141 / 141 |
| Accepted public stdout | `200\ncurl:0\n` | `curl:141\n` |
| Accounted curl writeout calls | 1 | 0 |
| Independent accepted stderr | `independent-stderr\n` | `independent-stderr\n` |
| Transport cleanup / response dispose executions | 1 / 1 | 1 / 1 |
| Transfer aborted by stdout consumer | false | false |

Both preserve exact `/work/body.bin` bytes `body0\nbody1\n` and header bytes:

```text
HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 12\r\n\r\n
```

Open ordering: cleanup registered16 → upload18/19 → EOF20 → response21 →
registered transport cleanup22 → response disposal23 → accounted writeout24 →
nested curl settlement25 → inner disposal43 → public settlement45.
Closed ordering: registered16 → first upload18 → consumer closes19 → second
upload20 → EOF21 → response22 → transport cleanup23 → response disposal24 →
nested curl settlement25 → inner disposal40 → public settlement42. Both cleanup
completions precede nested/public settlement; no relative order between those two
callbacks was imposed. No rescue or extra wait makes these assertions pass.

Every authorization/transport entry is journaled before admission. Authorization
only allows first exact URL/PUT/attempt0/no-redirectFrom/live-signal call; transport
independently admits only first exact live URL/PUT call, registers cleanup before
body consumption and has no fallback. Final journal equality would fail an extra
call even if denied. No extra call occurred: denial branches are inspected guards,
not additional runtime rejection cases. Transport has no fabricated attempt field.
Derived request-record counts show zero retry authorizations, zero redirect
provenance and zero additional transport entries in each row, rather than hardcoded
observations. Fixed response200/no Location and unchanged no-L/no-retry arguments
support the **zero actual retry/redirect** inference.

The positive child closed at16:24:58.535 UTC; the closed-consumer child started
at16:24:58.800 UTC. The new valid positive, not the old invalid row, enabled it.
Host ceilings genuinely increased to1. These passes do **not** establish zero-host-
cap support or settle that original S1 API/design/documentation question.

## Source, imports and private closure

Authenticated TEMP S1 source stays213 files / manifest
`6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea`; full940,
compiled708 / manifest
`2578b6ea39cfdeb5b942b9aff20ec9bfff1fcf907cd2af751d8e73f5c24e632f`, package709.
Authority remains07a7dae5+db139ae9. Actual imports use the copied compiled public
package and legitimate `run`/`Budget`/`makeFsModule`/`declareHostOperation` source
hooks through the unchanged copied loader. No private barrel, live dist fallback,
engine build, dependency installation or private source committed here.

Node22.22.2 Darwin arm64, unchanged existing TypeScript5.9.3 loader tooling.
**2464 import records**:1738 packed-public-product,693 engine-source-copy,33
harness/tool.224 unique logged files,63 unique engine files. Bootstrap loader/guard
hashes are separately frozen. All imported identities match the regular-copy
inventories;24 whole regular-copy checks stay equal. Full sets detect new regular
files/removals/symlinks, not new empty directories, atime or atomic/intervening state.

Fresh private before equals original accepted state, and after equals before:
HEAD`bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`, tree
`ebcb4508690856b288a40e60e7682331d6fad8ff`, index SHA256
`2dc2ac516c19864f952c493eb39374db1a2946f359d31dfb6fd02a5fccfb6bc2`.
Exact status/staging, six metadata and264 engine regular-file hashes/length/mode/
mtime/ctime remain equal. The known dirty/untracked state remains; this is not a
clean-checkout claim. Shared preparer and both reconstructed routes remain unchanged.

Separately recorded **foreign live** source changes occurred during the run:
`src/commands/network/README.md` changed from SHA256`41e75f9a...` to`71d0f549...`;
`src/commands/network/shared.ts` from`7adab18b...` to`c397734b...`.
`VERIFICATION.json` and the raw public inventories contain full hashes/lengths.
They never entered the copied S1 source/package or vetoed historical identity.
This audit neither edits nor accepts those live changes or Faraday's dispatch.

## Resources, reconstruction and stop

All eleven direct child PIDs are recorded and naturally reaped with exit0, no
signal/watchdog/output-limit termination. Every child reports zero tracked timers,
workers, spawned processes, sockets, guard failures and unhandled rejections;
disposal settles. Parent launch/session also exits0. This is not retrospective
enumeration of every synchronous metadata Git PID, OS-wide instrumentation, or
a claim that opaque losing handlers/engine Promises must all be joined.

Durable raw evidence/private-after precede removal of owned
`/private/tmp/safe-bash-owned-output-lifecycle-execution-v2-G6dnda`.
Shared prerequisite trees remain read-only and retained. No foreign process kill,
caller rescue or private/cache/config/generated write. `verify-evidence.mjs` is
a post-run, read-only consistency tool, not an added runtime oracle or independent
replay; its output is captured in `VERIFICATION.json`. Reproduction/profile/source
paths are in the frozen README. A different reviewer requires separate ROOT release
and output ownership, preserving exact frozen child/inputs/guards/budgets.

No new prototype finding is established by this bounded run. General SafeJS
membrane/worker/native parity, all-pipeline ownership, current full gate and
production8670 acceptance remain outside scope. **NO-PROMOTION; stop after seal.**
