# Owned-output cancellation: temporary prototype r1

**Partial design/prototype, not production acceptance.** The separately adapted
five, unchanged 57 existing controls, nine review controls and 12 author cases
pass on r1. Two source-reviewed ownership boundaries remain unresolved: active
borrowed curl input, and transitive ownership through `operation.output`. Passing
the bounded cohort does not satisfy those broader requirements. Stop here for
root's API decision and an independent immutable-candidate execution.

No live product source, root exports, configuration or old fixture was edited.
No delegation, independent holdout-body inspection, dependency installation,
native product subprocess, host-FS fallback, root build, full suite or release
qualification occurred. Express resolution returned `ERR_MODULE_NOT_FOUND`;
there is no Express execution claim. No external network target was used.

## Exact reconstruction and identity

Accepted review: `3eba797a2f286c80149dff22afbcd177e3ffea08`. Baseline:
`c9b96263d1204bdf54e89324cc0c7d1ef6bd3f79` plus the accepted three dirty
tree-command source files, not a clean committed candidate. The exact accepted
source-manifest hash is
`6d8589043618e623e35a63e92cbecc160b7f587335a69bba3e0b0f57e34dca8b`.
Its original serialization is reauthenticated, not replaced by a new algorithm.

`reconstruction.json` records all 227 restored files, provenance and per-file
hashes: 212 source files, four package/config files and 11 original execution
inputs. `baseline.tar.gz.data` contains those bytes, including the preserved dirty
files. No current source fallback is needed for the final reconstruction.

Final temporary candidate:
`/tmp/safe-bash-owned-output-prototype-Bl8HzL/candidate`.
The compiled import is `dist/index.js` there, or `dist/contracts/output.js`.
The corresponding declarations include `OutputOperation`; sink types are in
`dist/contracts/io.d.ts`. Nine temporary source paths differ from baseline.
The temporary root index remains unchanged; its existing export-star forwards
the new temporary contract export. Curie's live integration paths were untouched.

Canonical final manifests use sorted `{path, bytes, sha256}` entries in compact
JSON. `handoff.json` carries every entry, compiler inventory, tools and runs:

| Layer | Files | SHA-256 of manifest |
| --- | ---: | --- |
| Source, including source documentation | 213 | `c13d21a4205f75a846363e7e2c13db103ed841ee61397553105745c940f31c44` |
| Copied tests/probes/helpers | 14 | `bdae375b37ea07dcbbd505a23873d472cfd379eae70f0b037d82b9830046de44` |
| Compiled JS/declarations/maps | 708 | `c4df1c6910557948441eb47b3b7a9a9d069267e14e3745541f5d1e8c6d766bb0` |

Both strict copied-source build and scoped copied-source/test typecheck pass.
The latter lists exactly 357 compiler files including standard/development
declarations; it is not a check of the repository's entire test inventory.
Existing hash-authenticated Node 22.22.2/TypeScript/tsx tooling is referenced by a
temporary `node_modules` symlink. No dependency bytes were installed or changed.

`restore-handoff.mjs-data` independently reconstructs from the baseline archive,
applies `source-r1.patch-data`, restores the three added test bindings, checks
every source/test hash and rebuilds. Our reconstruction at
`/tmp/safe-bash-owned-output-prototype-replay-SD1yV7/candidate` matches **all 708
compiled hashes**, with no git-show or live-source fallback. This is an author
reconstruction check, not the independent verifier. Its compiler exited normally.

## Proposed contract and actual transitions

`API.txt.data` preserves the pre-implementation declaration. Version 1.1 added
only the optional request cleanup hook before source implementation. Root decides
the real API; these names are prototype-only.

- `ByteSink.ownedOutput?: { consumerClosed: AbortSignal; write(bytes): Promise<void> }`
  exposes an actual close capability and a separate accounted owned write path.
- `createOutputOperation(context, destination)` returns `signal`, `output`,
  `registerCleanup`, `acquire(start, release)` and idempotent `close()`.
- Construct synchronously registers the same `close()` with existing 07acb
  invocation cleanup before starting owned IO. OPEN admits cleanup/resource
  slots. Acquisition starts immediately, never after downstream demand.
- Consumer close aborts only the operation signal and shuts admission. Cleanup
  callbacks drain concurrently; repeated/finally/invocation close shares one
  completion. Source/caller/stage signals are distinct. No all-command enrollment
  or eager stage cancellation is introduced for owned writes.
- Normal `close()` drains without creating an EPIPE or aborting its signal.
  Writer close/empty completion does not fire the pipe's consumer-close signal.
- Acquisition that resolves after admission closes is refused and released.
  Close does not await an opaque pending acquisition. Late rejection/release
  failure is observed, not retroactively inserted into an already returned exec.
  Registered cleanup is an explicit cooperation contract, not hard preemption.

Pipeline/budget/signal wrappers, including external Shell capture, forward the
actual sink capability and account owned writes. Owned writes do not populate
the legacy successful-write set. Legacy after-write stage cancellation and final
cancellation of completed legacy-writing stages remain intact. Empty/nonwriting
independent stages are not canceled simply because stdout closes.

`operation.output` itself currently omits this optional capability. A second
operation constructed on that wrapper therefore lacks transitive early-close
notification unless its caller explicitly supplies the parent's signal. This is
a known design boundary, not established by the nested-independent-destination
test and not represented as a finished nested-ownership contract.

## Ownership matrix

| Work | Actual r1 ownership / limit |
| --- | --- |
| Explicit custom owned source | Enroll before read; pass operation signal; register cooperative source cleanup |
| `cat` with only named VFS operands | One explicit stdout-owned operation around those reads; signal reaches S3/WebDAV |
| `cat` with stdin/mixed stdin operands | Not enrolled; retains baseline behavior, not a new active borrowed-read guarantee |
| Untouched shared stdin during independent owned work | Not acquired/returned by that operation; author case subsequently consumes every byte through nested invoke |
| Curl stdout-only request | Transfer enrolled before authorization/request, including pre-response cancellation |
| Curl necessary body/header file | Transfer is not stdout-close-owned; independent file/header work finishes |
| Curl stdout headers/body/writeout among file effects | Separate output operations; EPIPE can defer status until independent file effects finish |
| Curl request/socket | Optional `HttpRequest.registerCleanup` registers cooperative idempotent dispose before `http.request` |
| Curl response/late response | Acquisition slot and idempotent response disposal; late response released without awaiting pending acquisition |
| Curl borrowed stdin upload/data/format | **Unresolved**: transfer construction may give borrowed reads an output-owned signal; no active-borrowed safety claim |
| Stderr/unrelated registered work | Remains caller/invocation-owned, not canceled by an output operation |
| Opaque sink | Caller cleanup only; no inferred reader demand or close notification |

**Minimum root decision:** keep transfer preparation unenrolled until borrowed
input completes, or add an explicit non-destructive borrowed-read lease? The
frozen baseline has no such lease/rollback contract. Do not silently treat stdin
as owned. Root also needs to choose transitive operation-output capability
semantics. This leaf does not expand the temporary patch to invent those APIs.

## Reasons, errors and semantic profile

An already-aborted caller wins enrollment; thereafter the first operation abort
reason retains identity. Later caller abort still wins public exec outcome by
the existing invocation contract, even when the operation retains EPIPE.
Registered cleanup failures are observed and surfaced through existing invocation
drain rules; `close()` itself may reject, and is not an exception-precedence
combinator for arbitrary host `try/finally` code. Caller/error/cleanup/result
selection remains the existing host contract, not a stage-cancellation shortcut.

Named cat and curl recognize their owned EPIPE as producer status 141 without
spurious stderr. A handler can catch it, finish independent file/stderr effects
and return a genuine status (author 0 and 7 cases). Curl preserves a genuine HTTP
failure status while completing its independent header effect. Pipefail still
selects the rightmost nonzero pipeline status; trailing `true` still runs only
after the pipeline settles. No timeout is used to manufacture cancellation.

This explicit early owned-work policy is intentionally stronger than universal
GNU Bash pipe behavior. Native nonwriting/empty/error effects retain 0/0/7, while
actual writes after reader closure yield 141 in the pinned reference. The C9
synthetic demand-cycle control remains **not product** and not evidence of a
demand-before-start scheduler or a circular original start barrier.

## Inputs and results: keep cohorts separate

| Cohort | Exact baseline replay | Prototype r0 | Prototype r1 |
| --- | --- | --- | --- |
| Original five, unchanged | 0/5; five inner 1200ms failures | 1/5 | 1/5 |
| Separately adapted five | Not run as baseline acceptance | 5/5 | 5/5 |
| Existing controls, including head-zero | 57/57 | 54/57 | 57/57 |
| Accepted review C1–C9 | 9/9 after harness path repair | 9/9 | 9/9 |
| Author logical cases | New, not baseline coverage | 6/12 | 12/12 |
| Pinned native effects C3–C7 | 5/5, source-independent | Not duplicated | Same preserved reference |

There is no aggregate pass denominator combining original and adapted versions
or repeat executions. Existing 57 = head-zero + 19 remote + 28 byte IO + five
shared lifecycle + four streaming. All original 11 input files retain their
exact accepted hashes. Original inner 1200ms and outer 3000ms/1MiB bounds remain.

The unchanged prototype S3 original passes because its factory already records
the IO signal. The original local producer remains unenrolled and times out;
WebDAV/curl originals fail their old stage-aborted assertion. Their later cleanup
assertions are not reached and are not credited. All failures remain in raw logs.

`adapted-fixture.patch-data` precisely separates the new binding: custom producer
creates an operation and registers cleanup; VFS/authorizer observations capture
the IO operation signal instead of stage signal; producer sink writes are
counted; stage remains unaborted. Original commands, started barrier, fixture
payloads and deadlines remain. Every adapted case records **one started read/GET,
zero writes, one resource return, zero active work**, EPIPE operation cancellation
and non-aborted caller/stage. Cleanup is observed before fixture teardown; remote
peer-close events can occur after shell settlement, before the explicit existing
bounded close assertion. This is not a claim that exec awaits remote-peer
quiescence or every opaque host promise. Later `true` runs normally.

Twelve author cases cover success/error independent effects; untouched borrowed
input with nested independent destination; normal writer/opaque completion;
caller identity over EPIPE and cleanup failure; late acquisition/rejection and
closed admission; five curl file/header/writeout/error combinations; and actual
streaming curl close after one owned write followed by independent parent work.
Assertions pair status, exact bytes, VFS effects and ordered events. Raw traces
are in `evidence/runs/r1-author.stdout`.

One focused self-fix round followed r0. `ATTEMPTS.md`, initial source patch and
initial author data preserve the failures. Three legacy completed-stage control
regressions required a source correction. Six author failures were whole-result
shape mistakes, corrected by adding exact existing stdoutBytes/stderrBytes
expectations, not relaxing assertions. The exact author fixture correction is
`author-r0-to-r1.patch-data`. Initial control-loader path failures also remain.

## Native, containment and coordination

The authenticated executable is the accepted GNU Bash 5.3.0(1)-release binary
at `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`, SHA-256
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
The profile is GNU Bash on Darwin arm64, not GNU/Linux. Cases use Bash functions
and builtins plus hashed Darwin utilities. Scripts, output, PIPESTATUS, file
effects, tool hashes, PIDs and process-group closure remain in evidence. Results
are C3=141, C4=0, C5=0, C6=7, C7=141 with matching effects; no performance ranking.

All test child groups report close observed and no residual group. No outer
supervisor deadline/output kill occurred. Authored loopback servers close with
zero tracked sockets; original fixtures use their original bounded teardown.
Late rejection checks are explicit; no hostile endpoints or privileges used.
The source and reconstructed temporary trees remain for handoff, not live
processes. Final closure evidence and artifact inventory accompany this report.

Nine inspected current sink/context/cleanup/command files match the baseline
hashes; no critical interface drift required a base change. Protected root
index/plugin index/package/README hashes match the initial observation. The
ledger hash changed concurrently under its owner's commits; this leaf did not
edit it and does not describe the whole worktree as unchanged. Foreign staging,
native artifacts and other work are not staged or committed by this leaf.

The owned evidence adds **zero raw .ts/.test.ts/.js/.mjs discovery files** and no
test exclusion. All new code is inert `.data`/`.patch-data` inside the repository;
actual executable source exists only in the uniquely task-owned temporary trees.
Recorded work is this bounded session, not 72 hours. Accepted Arch5 c3a3647 and
pending default6 remain separate; sort7ba5301 establishes no full gate here.
Release remains RED pending Poincare/root integration and a root-assigned exact
candidate rerun. Root must observe this leaf actually CLOSED before authorizing
the fresh independent executor. There will be no source changes after handoff.

## Reproduce without live-source fallback

From `/Users/kjopek/Workspace/safe-bash`, run:

```sh
node --input-type=module < tests/shell-stress/first-read-contract-review/owned-output-prototype/restore-handoff.mjs-data
```

The script prints its unique reconstructed candidate and runner path, validates
tool/baseline/source/test/compiled hashes, and exits with no compiler left alive.
The runner preserves original and adapted cohorts separately. Source patches are
inert evidence, not authorization to apply anything to the live repository.
