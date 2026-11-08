# Owned-output direction: bounded temporary v2/r1

This is a temporary design candidate, not a production integration, release
qualification, superiority claim, or waiver of the four unchanged failures.
Only this new evidence directory and uniquely owned temporary paths were edited.
No delegation, independent test-body inspection, dependency installation, live
source/root/export edit, global build, or full-suite run occurred.

## Authentication and scope

V1 remains immutable at evidence commit
`1ff82cb748c60145740dba354610ac7ed7a7f15f`. Its accepted source is the preserved
accepted3eba797a / c9b96263d1204bdf54e89324cc0c7d1ef6bd3f79 plus three dirty source
files, not the concurrently changing live checkout. Two fresh temporary copies
were reconstructed from its inert baseline archive and source patch. Both
matched the v1 213-source, 14-test and 708-compiled identities before any v2 edit.
All 235 v1 artifact hashes and original candidate source/test/compiled files
were rechecked at seal. Original independent16 and new independent inputs were
neither read nor changed.

The provisional API was published in
`/tmp/safe-bash-owned-output-direction-prototype-api.txt` before source edits.
Its initial design and subsequent narrow refinement are preserved separately.
V2 changes only three temporary source files: `src/contracts/output.ts`,
`src/commands/network/body.ts`, and `src/commands/network/curl.ts`. Root exports
remain exactly the temporary exports inherited from v1; no new barrel changes.

## Two boundaries

**Explicit child operations.** `parent.child(destination)` creates a child and
registers its close through the parent's existing `registerCleanup` before
returning it. Only the root operation registers with invocation cleanup.
Parent close synchronously closes descendant admission, then awaits registered
cooperative cleanup through three levels. Normal close does not manufacture an
abort reason. Parent abort forwards the same first reason through the child
signal chain. Child close/abort does not terminate its parent or siblings.
Independent file/stderr work stays outside that stdout operation.

`close()` shares one promise; cleanup/release executes once. Late child creation,
cleanup registration and acquisition are refused. Opaque acquisitions already
started are still **not** awaited by close: a resource delivered later is
released and a late rejection observed. D7 explicitly proves that normal close
can finish while those opaque promises remain pending, and then resolves them
under fixture control. There is no claim that arbitrary opaque work is drained.
Constructing another unrelated operation on `parent.output` is still opaque;
the explicit child method, not wrapper inference, establishes parenthood.

**Borrowed curl preparation.** A private next-only view never forwards return
to the borrowed owner iterator. Stdin-dependent transfer preparation uses the
caller/transfer-timeout lifetime, before stdout-owned transfer enrollment.
The pending read is not raced against output closure. Upload/data parts using
stdin are collected under the existing `maxUploadBytes` bound; `-w @-` retains
the existing `maxBufferBytes` bound. Once preparation finishes, only owned bytes
are passed to the transfer. No read lease, rollback, stage autowrap, or
demand-before-start rule is invented.

This trades streaming stdin upload for bounded prebuffering and later request
start. It can require upload-sized memory in addition to existing replay/cache
and collection copies. A borrowed read that never resolves can delay this phase
until caller/timeout handling; output closure alone does not provide prompt
completion. Caller/timeout cancellation retains existing behavior, not a promise
to stop or drain the underlying opaque host promise. File-only bodies still
stream. R1 preserves early enrollment for non-stdin format/query preparation;
body-parse errors retain their original position after format and URL processing.

Necessary `-o` body files and `-D` header files remain transfer-owned rather
than stdout-owned. The mixed upload and writeout cases complete those files and
verbose stderr even after stdout closes. Stdout publication can then report
141 without cancelling that independent work.

## Frozen author cases and limits

Eight logical cases, no additions or fixture corrections after the first freeze:

| Case | Concrete evidence |
| --- | --- |
| D1 | Actual pending curl `-T -`, mixed `-o/-D/-w/-v`, loopback PUT bytes, file/header/stderr effects, delayed completion, owner/sibling retention |
| D2 | Actual pending `--data-binary @-`, closed stdout does not cancel shared read; request never starts after preparation meets closed output |
| D3 | Actual pending `-w @-`, mixed files and verbose stderr survive; writeout alone meets closed stdout |
| D4 | Three-level output abort, same reason, late admission refusal, registered resource release, public settlement waits for controlled descendant cleanup |
| D5 | Parent normal close synchronously refuses descendant admission, waits cooperative cleanup, keeps signals un-aborted, shares close completion |
| D6 | Child-only closure leaves parent/sibling usable, independent file/stderr intact, genuine status7 preserved by pipefail |
| D7 | Opaque late acquisitions are explicitly not drained; controlled fulfillment releases once and controlled rejection is observed |
| D8 | Descendant cleanup failure surfaces unchanged, first EPIPE stays on operation, later caller reason wins public exec |

D1-D3 use real Shell/registry curl execution and Node loopback transport, not a
proxy for untouched stdin. Head waits until the borrowed `next()` is actually
pending. After head returns and event-loop turns, exec remains unsettled and
the owner iterator has not been returned. The fixture then resolves that read.
The owner and sibling subsequently consume exact remaining frames through real
Shell commands, without return until explicit owner close.

The host supplies one-chunk borrowed frames over a single owner iterator. This
explicit framing makes ownership of consumed bytes measurable; it is **not** a
new core API or a proof of arbitrary concurrent-reader fairness. Curl-consumed
bytes are not rolled back. In D2 those bytes are consumed for preparation but
not transmitted because stdout is already closed. The conservation assertion
accounts for curl's consumed frame plus the exact owner/sibling frames, not a
promise to deliver aborted curl data to another consumer.

## Results, without merged denominators

| Cohort | Historical baseline | Fresh v1 replay | V2 r0 | V2 r1 sealed |
| --- | --- | --- | --- | --- |
| Original first-read5 | 0/5, preserved | 1/5 | 1/5 | 1/5 |
| Separately adapted5 | Not baseline | 5/5 | 5/5 | 5/5 |
| Old57 controls | Preserved | Not rerun here as v1 | 57/57 | 57/57 |
| Old9 review controls | Preserved | Not rerun here as v1 | 9/9 | 9/9 |
| Old author12 | Not baseline | Preserved v1 12/12 | 12/12 | 12/12 |
| New author8 | Not baseline | Not executed on v1 | 8/8 | 8/8 |

Old57 = head-zero1 + remote19 + byte-IO28 + shared-lifecycle5 + streaming4.
The original-five runner also includes head-zero: its 2/6 report means original
1/5 plus that separate passing control, not 2/5. C9 within the nine controls is
the preserved synthetic non-product demand-cycle example. All 14 old test files
remain byte-identical. Old control executable content changes only in temporary
path bindings. The original adapted delta remains in the immutable v1 evidence.

The native five are the preserved GNU Bash 5.3-on-Darwin reference results,
authenticated in `native-preserved.json`; they were not rerun or counted as new
cases. Historical baseline0/5 is preserved and authenticated, not rerun here.
No Linux/provider/native-generalization claim follows from these cohorts.

Both v2 revisions pass the copied scoped build and typecheck. The sealed
compiler inventory contains 358 actual files, including the new author fixture
and existing development declarations. It does not certify the live repository's
full TypeScript inventory. Node and existing TypeScript/tsx/esbuild tooling are
hash-authenticated; no runtime dependency was added.

The final staged diff check reports one extra EOF blank line in the inert
`restore-v1.mjs.data` capture. Those are the exact bytes of the reconstruction
script that ran; they are preserved rather than silently reformatted. This is a
recorded artifact-format warning, not a product test failure or a clean-diff
claim. `diff-check.json` retains the exact check result.

## Reasons and remaining failures

First operation reason wins; an already-aborted caller wins enrollment. Later
caller cancellation still wins public exec via the existing invocation contract.
Normal parent close is not output abort. Genuine command failures retain their
status; ordinary rightmost-nonzero pipefail remains. Cleanup errors are surfaced,
not swallowed; close is not a general exception-precedence combinator for
arbitrary host try/finally code. The unchanged v1 tests plus D6/D8 establish the
bounded combinations exercised, not every possible competing error ordering.

`DIAGNOSIS.md` explains each original failure with fresh v1 raw replay and exact
versioned source lines. Only the local custom producer times out at 1200ms.
WebDAV, curl-body and curl-headers fail the stage-aborted assertion at line103;
their later cleanup assertions are unreached. Those three assertions logically
require stage cancellation, which conflicts with this owned-operation profile.
Inputs were not rewritten and product behavior was not distorted to satisfy them.

## Attempts, sealing and replay

R0 source and all first-run outputs remain intact. One source-only refinement
restores non-stdin early enrollment; no author fixture correction occurred.
Source evidence commits `98462779` and `630bf76f` are separate from author freeze
commit `cabb9519`. Reconstruction-harness failures and its exact corrective delta
are retained separately; they do not count as source-fix or author-case credit.

`handoff.json` lists all source/test/compiled/compiler-input hashes, API/patch
identities and tool identities. `restore-v2.mjs.data` reconstructs from the old
inert archive + v1 patch + new v2 patch, authenticates the intermediate v1 build,
then reproduces the final build and compiler inputs without any live-source
fallback. `RECONSTRUCTION.md` gives commands and the separately retained harness
corrections. `ARTIFACTS.json` authenticates this directory except itself.

The primary candidate is read-only, including its directories, at
`/tmp/safe-bash-owned-output-direction-prototype-PMLamJ/candidate`.
Its verified temporary import is `dist/index.js` or `dist/contracts/output.js`.
Do not run build commands against the sealed read-only candidate; reconstruct
first when a writable preseal compilation is needed.

All 44 product/diagnostic supervised runs observed normal child close, no
remaining process group, and no outer deadline/output kill. Authored loopbacks
reported zero sockets. Reconstruction child closure is recorded separately.
No watchers or stopped processes are left. All authored opaque gates are
explicitly resolved/rejected; this is not a claim about arbitrary opaque hosts.
Root must observe this leaf's actual CLOSED before independent execution. No
self-certified actual closure, production acceptance, or 72-hour claim is made.
