# R3 held boundaries: source/data diagnosis, not execution

2026-08-28. Scope is exactly15 original failed canonical IDs: six structural
signals, three directory-mode cases, two Node-version prerequisites, one tac
native capture, one socket setup, one npm route, one env-S header holdout.
No failed row is deducted, rescored, skipped or converted to a pass.

Authority: fixed f5e9fc49b6abb38e180cc9de16c95fced102ff75, original R3/c23a8de8,
and raw TAP details authenticated against the earlier failure index. Source
references and excerpts here are **f5**, not current HEAD. Source43777899 is
examined only for two already-authored helper overlaps, not injected into f5.
All new files are docs/JSON in this directory; no source/expectation changes.
Git object reads, local primary-document reads and JSON/hash analysis only;
no subject native utility, product, compiler, test, build, private or network
execution. Retained roots/captures were not cleaned or modified.

## 1. Six structural-signal failures: concrete incompatibility, contract question

IDs41671/41692/41713/41734/41755/41776, reasons undefined/null/false/0/empty
string/Error(cancelled). `inactive-prefix.test.ts:179` defines a structural
EventTarget implementing AbortSignal, initially not aborted. The mocked third
Budget.yield aborts it; the assertion requires exact reason identity and then
checks third-checkpoint/no-write/no-regex/no-inactive-encode behavior.

`helpers.ts:run` passes that exact object to createExprCommand.execute.
`expr/index.ts:16` enters withRegexSession before evaluating any expression;
`regex-execution/client.ts:43` opens a session; its constructor at271 calls
native AbortSignal.any with the structural object. The captured TypeError is
therefore source-consistent with rejection **before the third checkpoint**.
The subsequent no-write/no-worker assertions were unreached, not proven.
The Error(reason) case also fails, so this is not just falsy-value handling.

CommandContext says AbortSignal (TypeScript structural typing); command.md
requires actual caller-reason identity but does not explicitly promise every
hand-authored AbortSignal-shaped object is accepted by native APIs. This is a
proven f5 compatibility failure for the fixture input, **not yet proof that
genuine native-signal cancellation is broken**, nor license to waive the input.
The fixture's exact-undefined reason deliberately exceeds native abort()'s
usual default-reason path; do not silently replace it with a DOMException.

Minimum owner decision: explicitly resolve supported signal provenance before
changing production or expectations. If structural signals are supported,
review a composition mechanism that preserves original caller reason and
listener cleanup without native brand rejection; no fix authored here. If the
supported contract is genuine native signals only, any versioned fixture
correction must separately preserve exact-falsy evaluator tests and state the
unsupported surrogate boundary. Do not call a shape check a security sandbox.
Future bounded reviewer recipe: unchanged six inputs plus a genuine native
AbortController neighbor, trace session-open/checkpoint/writes/worker acquisition
and verify original reason priority after cleanup. No replay was run.

## 2. Three directory-mode failures: NOT the regular-file eligibility exception

**46530** (`chmod-controls.test.ts:17`) and **47489**
(`permission-profile/qualification.test.ts:18`) fail in
`fixtures.ts:setMode`, before that invocation's native/product comparison.
Both begin their directory sequence requesting06755. The helper wraps several
possibilities—chmod rejection, exact-mode mismatch, or identity/ownership
validation—in the same outer error. The captured TAP omits its cause and does
not record which loop iteration/mode failed. Thus06755 is the source's first
request, **not independently recorded syscall-target/cause telemetry**.
Primary-group chown qualification exists in f5 already; don't prescribe that
existing repair again or infer that group membership guarantees setid authority.

**46642** (`native-differential.test.ts:40`) is one failed aggregate assertion
with32 captured directory mismatches among384 attempted transitions. All32
record native1 versus MemoryFS/command0, unchanged host mode versus setid-bearing
virtual mode. There are16 `ug+s` and16 `u+s,g-s,o=t` entries; exact values are in
DIRECTORY-MISMATCHES.json. The loop records no native stderr in the failure
objects, so EPERM/system-call cause is **not** recovered from these rows.
The source initializes only0777 permission bits, calls qualified setMode, runs
GNU9.7 then the MemoryFS command, and compares mode/status. This is a real
observed native-versus-virtual divergence; it does not alone establish a parser
bug. Memory chmod stores the requested bits; the command computes the stated
symbolic bits. Host-specific refusal must not become fabricated MemoryFS denial.

The earlier NA2755/6755 profile is **regular-file evidence only**. It does not
cover these directory operations, Node APIs, symbolic changes, or an entire
384-transition test. No new eligibility waiver is proposed. Minimal next source
instrumentation, only with ROOT approval: retain exact requested mode/cause,
before/after identity/mode and native stderr per failing row. A separately
approved finite directory-authority replay would need the same fence and no
elevation. Otherwise retain these as unresolved authority/profile failures;
never relax exact-mode checks or force host authority into virtual semantics.

## 3. Two Node22 profile prerequisites: reached guard, not chmod outcomes

47423 and47452 target Darwin/GNU9.7 **Node22.22.2/libuv1.51.0** characterizations.
The fresh gate used Node24.11.1, and `requireDarwinProfile():18` rejects that
version before libuv validation, temp-directory setup or either chmod case.
Their later bodies use an external /tmp profile root and strict host/group
assumptions; switching the interpreter would not prove the rest is gate-admitted.

These are mismatched explicit profile prerequisites, not current virtual chmod
failures or Node24 semantic characterization. Keep both raw failures. Minimal
future policy decision is how to retain the exact Node22 profile alongside a
separately defined current-driver profile without masking versions, filtering
canonical tests, widening scratch permissions or crediting unexecuted bodies.
No automatic historical-test exclusion or Node22 reroute is authorized here.

## 4. Two existing repair overlaps: no duplicate patch

**58752 tac**: `stream-inspection/native.test.ts:42` compares a fresh native
capture array with pinned captures. GNU9.7 tac's stdin path emits temporary-file
creation failure under `/var/tmp/cutmp...`, status1/empty stdout, versus expected
reversed bytes/status0. This is native-oracle work, not the product invocation
from neighboring frozen-output tests. `oracle.ts:27` passed a fresh env omitting
TMPDIR. Source43777899 already adds confined separate scratch/TMPDIR and awaited
cleanup while retaining argv, input and expected bytes. Its synthetic routing
proof is **not** actual tac success. No new patch or permission expansion needed
in this diagnosis; next actual native check remains separately authorized.

**109526 npm**: `controls.test.ts:197` calls bare npm; f5 helper line29 spawn
returns ENOENT before the generated fixture script runs. That test already
supplies explicit `--test-reporter=tap` at f5. It is not another reporter defect.
Source43777899 already routes exact authenticated npm-cli through current Node,
preserving args/cwd/env. Subsequent script5-pass/7-test2-fail negative assertions
remain unexecuted in R3 and unproved by the synthetic dispatch control. No second
route repair is proposed, and old f5 remains failed.

## 5. Socket: setup EINVAL, not proven permission denial

**99469**: real fixture creates an owned root, then Server.listen(root/socket)
rejects EINVAL before any stat/read/write/readdir ENOTSUP assertion. Captured
UTF-8 path is110 bytes. The installed pinned Apple SDK `sys/un.h:79` declares
sun_path[104]; this gives a concrete pathname-length hypothesis, not proof of
the exact Node/libuv/kernel error branch. No source snippet/receipt here proves
EPERM, a network-rule denial or an allowed bind under a shorter pathname.
The actual RealFS source rejects special node types; that branch was not
exercised by this failed setup. The server.close finally is installed only
after listen succeeds; raw bind failure is not a dynamic cleanup proof.

Minimal proposal, **not executed or patched**: first record requested pathname
bytes and the actual bind error/cleanup under the same admitted owned namespace.
If separately approved, use a shorter unique fixture name/path inside that
same root (no outside tmp or permission change), with failed-listen cleanup
registered before acquisition, then retain all four original typed ENOTSUP
assertions. If the unchanged fence refuses bind, report the missing capability;
do not bypass it or infer support from SDK size alone.

## 6. env-S: stale rejection input, not a GNU-native output oracle

**112555** is a grouped strict-header case. Invalid UTF-8 checks precede four
headers: `/bin/bash` with CR, `/bin/bashx`, `/bin/bash --`, `/usr/bin/env -S bash`.
Captured return0 versus126 is at the shared header assertion; raw telemetry
doesn't label the active header. Frozen source rejects the first three spellings
and explicitly accepts the fourth via envShebang. Its exact virtual argv is
`env ["-S bash","./invalid"]`, then `bash ["./invalid"]`, not separate
`env ["-S","bash"]` before script insertion. This identifies the fourth as
the source-supported explanation, not a newly observed per-header trace.

Frozen env-split parses the attached S argument `" bash"` into `"bash"`.
Execution forwards through the existing literal invoke/replaceEnv path.
The file body is `say forbidden`; **say is the fixture's registered command**,
not an ordinary GNU Bash command. Source predicts virtual stdout `forbidden\n`,
status0. No such stdout is captured in the failing assertion and no native
full-script comparison was run, so do not claim GNU executes this exact body0.

Primary local GNU9.7 manual (hash39b12675...) at18146/18235 describes -S splitting
the single shebang optional argument and forwarding the script operand. It
supports the argv policy, not macOS/Linux kernel equivalence or this fixture's
custom say output. No GNU utility was executed. Minimum versioned proposal:
retain all invalid UTF-8 and first-three-header rejection assertions, separate
the supported -S header into an explicit positive with exact virtual output and
argument observation. A native argv witness must use an independently declared
portable printf body, not silently substitute the old body. ROOT must approve
exact assertion hunks; none are changed now.

## Handoff and limits

CROSSWALK.json preserves all15 IDs/names/statuses and raw-detail hashes, plus
classification, minimal source locations and proposed owner action. SOURCE-
BINDINGS.json binds reachable f5 objects and the exact two437 repair overlaps;
local SDK/manual inputs are separately hash-qualified. CAPTURES.json retains
the15 original details without rerunning. No blanket current-HEAD exoneration:
later accepted shell cancellation helpers do not change f5's eager native
signal composition, and unrelated later modules don't repair these fixtures.

No new broadly supported product defect is established by this source/data-only
review. The six structural inputs show a real concrete API-composition mismatch
whose support contract needs disposition;32 directory subrows show real but
authority-qualified divergence. Other rows are pre-body guards, setup/route
failures or the source-supported stale header expectation. This conclusion
does not declare production correct, waive any row or claim a successful fix.

Keep original R3 **19425P/132F/7skip,6/14**, integrity/cleanup false. This review
adds zero test/native/product/compiler/private executions and zero pass credit.
Different reviewer can audit these finite source/data arguments before any
author repair/reproducer grant; no new gate GO or consumed-attempt reuse.
