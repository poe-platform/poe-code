# R3 held boundaries — policy disposition, no implementation or probe GO

Friday, August 28, 2026. Independent SOURCE/DATA-only review. Exact fifteen
original failed IDs and full commit/evidence bindings are in `BINDINGS.md:1`.
All product/test citations below resolve at **F =
f5e9fc49b6abb38e180cc9de16c95fced102ff75**, unless another bound symbol is named.
This review does not accept implementation, exonerate product, remove adversarial
cases or rescore R3. Every dynamic follow-up described below is **UNEXECUTED**
and needs separate, finite ROOT authorization; no permission widening is implied.

## 1. Six signals: public provenance decision remains necessary

**41671, 41692, 41713, 41734, 41755, 41776.** The captured rejection names
`signals[0]`, `StructuralSignal` and `ERR_INVALID_ARG_TYPE`. Construction at
`tests/commands/expr/inactive-prefix.test.ts:179` is an EventTarget with mutable
aborted/reason and custom throwIfAborted, not a controller-created signal.
The loop at line191 deliberately covers undefined, null, false, zero, empty
string and one Error("cancelled") carrying code ENOENT. At line198 it aborts
only at the third mocked Budget.yield, then calls the original checkpoint.

The direct helper `tests/commands/expr/helpers.ts:5` accepts
`Partial<CommandContext>`, defaults to a native controller signal and spreads
overrides unchanged at line13 before direct execute. Public
`src/contracts/command.ts:32` and `src/shell/types.ts:43` say AbortSignal, not a
separately specified structural signal protocol. `src/contracts/command.md:40`
says existing structural **contexts** remain valid and direct hosts may omit
registerCleanup; that does not explicitly define signal provenance either way.
The fixture demonstrates intended surrogate coverage, not by itself a public
guarantee. TypeScript compatibility is not a runtime brand promise.

Important accepted-helper counterweight: the frozen private policy at
`tests/shell/cancellation-stage1-20260827/README.md:38` expressly admits only
native-branded signals or undefined. `src/shell/cancellation.ts:139`, line415
and line465 enforce it; this F helper is blob
`a7742b7f7e81bcd8c1c2a6be35092d8b5f41102f`, accepted source
`fbbe1ef793b7434871403125efbeb46624a8e081`. Its acceptance clarification at
`tests/shell/cancellation-stage1-20260827/accepted-fbbe1ef7-docs/ACCEPTANCE-CLARIFICATION.md:50`
explicitly excludes Stage2/public integration. Thus this is real native-only
policy evidence **for that private helper**, not a retroactive public restriction
or an f5 expr repair. Neither brand use alone nor this bounded acceptance settles
the direct CommandDefinition.execute domain.

Call path: `src/commands/expr/index.ts:16` enters withRegexSession;
`src/commands/regex-execution/client.ts:33` checks the signal, line37 registers
cleanup if supplied, line43 opens, and line271 calls native AbortSignal.any.
Only after open does the expression callback run. `src/commands/expr/internal.ts:62`
calls charge/throwIfAborted. The captures and source therefore locate rejection
before the intended checkpoint, not at cancellation evaluation. Post-rejection
assertions at fixture line205 were unreached. Its jobs observer at line26 counts
matchExpr submissions, not actual workers or a global cleanup census.

**Decision ROOT must make:** does the public direct-command/host signal contract
support these structural EventTarget signals (including exact undefined reason),
or require genuine native signals consistently with the private helper? Record
the scope explicitly; do not interpret the TS type or an incidental constructor
failure as the decision. On the inspected evidence, blanket "invalid fixture"
is not established. If structural support is retained, the incompatibility
needs separately owned composition work preserving identity/admission/listener
cleanup; no patch or acceptance is proposed here. If native-only is ratified,
the fixture owner may propose a versioned successor, not erase these six rows.

### Minimal native counterpart, conditional on that decision

Keep argv `["1","|","length","abc"]`, noFileSystem, throwing stdin iterator,
the original Budget.yield call and observers. Create one fresh AbortController
per row; pass its unmodified signal. Do not pre-abort, replace any(), forge its
prototype/brand, override reason, or stop entering withRegexSession.

| Original ID | Third-checkpoint action / exact expected reason |
|---|---|
| 41671 | `abort(undefined)`; capture **signal.reason after abort**, a native default reason, not undefined |
| 41692 | `abort(null)`; preserve null |
| 41713 | `abort(false)`; preserve false |
| 41734 | `abort(0)`; preserve zero |
| 41755 | `abort("")`; preserve empty string |
| 41776 | `abort(originalError)`; preserve the same Error reference and ENOENT field |

For every row, record that checkpoints1/2 see an unaborted signal. At checkpoint3
assert no writes/jobs/inactive `abc` encoding yet, mark the checkpoint reached,
abort and capture the actual reason **before** calling the original yield.
The rejection predicate must require that reached marker and Object.is against
that captured reason, not a stale pre-abort undefined. For the five explicit
nonundefined inputs also compare signal.reason to the original value. For the
default row assert its native AbortError shape and identity, not a freshly
constructed lookalike. After awaited rejection retain exact checkpoints=3,
writes=0, jobs=[], no `abc` encoding; never move abort earlier to get a pass.

There is **no unchanged native-controller equivalent for an aborted exact
undefined reason**: Node v24.11.1's official source gives both omitted and
undefined arguments a default DOMException (primary sources in BINDINGS).
The default counterpart preserves cancellation timing but changes that value
domain. ROOT must explicitly retain/locate the exact-undefined surrogate
requirement or ratify its unsupported-public-domain disposition separately.
Renaming it to a default-reason test is not six unchanged-input repairs.

Cancellation/cleanup promises stay intact: `src/contracts/command.md:50` requires
registration before acquisition, line84 drain before public settlement and
line101 exact caller-reason precedence. Regex finally awaits the same close at
`src/commands/regex-execution/client.ts:49`; direct helper execution omits the
Shell registration/barrier and cannot qualify public exec/dispose. Preserve
finally, observed late failures and no-effect assertions. No native-signal
success, worker absence or actual settlement guarantee was tested here.

## 2. Two Node22 prerequisites: separate honest qualification

**47423 / 47452** both stop at
`tests/commands/metadata-stress/permission-profile/darwin-profile.test.ts:18`:
expected **v22.22.2**, captured **v24.11.1**, code ERR_ASSERTION. Line19's exact
libuv **1.51.0** assertion is not reached. The earlier Darwin/arm64 checks and
later nonroot, real/effective identity, nonmember group0 and GNU9.7 binary-hash
conditions at line15 are an explicit historical profile, not portable chmod
requirements. Native root setup at line34 uses realpath("/tmp"), not proof of
admission under the gate's owned scratch/fence.

The first body requests directory06755, expects establishment04755, then +2000;
the second starts directory0051 then ug+s (`darwin-profile.test.ts:71`). After
qualification, the bodies assert native status1/exact Operation-not-permitted
stderr, Node/RealFS success with SGID stripped, stable identity and changed
ctime, and MemoryFS retaining requested bits (line81, line87, line106).
Those are **conditional source expectations**, not observations under Node24.
The captured ERR_ASSERTION is not a captured EPERM from either body; neither
actual libuv behavior nor the presumed cause is established by this guard.

Safe owner action after authorization: retain the exact historical recipe and
raw failures, and define a separately named, fully bound Node24 qualification
with its actual Node/code/libuv/tool/caller/root/fence conditions and explicit
not-yet-measured outcomes. Do not broaden the old equality, skip/mask the tests,
substitute Node22/native tools inside the gate, or run either profile here.
Do not move them out of canonical discovery as an undeclared waiver. Any future
discovery/profile split needs explicit root-owned denominator and contract
approval; until then these remain two raw prerequisite failures. Historical
NA regular-file2755/6755 evidence does not qualify these directory bodies.

## 3. Three directories: record missing causes, not an OS explanation

**46530 / 47489** stop at setMode before that invocation's native/VFS comparison.
`tests/commands/metadata-stress/permission-profile/fixtures.ts:52` validates
mode/root/entry identity and ownership, calls host.chmod at line63, validates
exact resulting mode at line65, and wraps any failure with cause at line70.
The captured outer message omits the cause. Primary-group chown/identity
qualification already exists at line44; prescribing it again is not a repair.
`chmod-controls.test.ts:16` starts with06755 but loops; the captured mode/iteration
is absent. `qualification.test.ts:16` starts with directory and requests06755 at
line18. Source control flow is not separately recorded syscall telemetry.

**46642** is **one aggregate TAP failure**, not 32 tests. A
`DIRECTORY-MISMATCHES.json.rows` contains32 subrows from the384-transition loop:
all directory/native1/virtual0, expected host mode equal to initial, versus
setid-bearing virtual mode. Sixteen use ug+s and sixteen u+s,g-s,o=t.
`tests/commands/metadata-stress/native-differential.test.ts:24` seeds only0777
bits; line28 qualifies the initial mode, line30 invokes native, line31 VFS and
line34 stores the mismatch. All32 stored rows were inspected as data, not run.
First iteration7: initial0051/umask0, ug+s, native1/host0051 versus virtual0/06051.
The mismatch record lacks stderr even though `tests/commands/metadata-stress/helpers.ts:27`
returns it. No syscall errno or denial layer follows from exit1 alone.

Smallest source-classified diagnostic delta, only if the helper owner is granted
it: persist a bounded record alongside the original failure, never normalize it:

- Common binding: original TAP ID and loop iteration; directory type; requested
  initial mode, symbolic/numeric argv, umask, cwd/target and owned-root identity;
  exact candidate/helper/tool/Node/libuv/fence profile. No ambient identity probe.
- Setup rows: which existing stage failed (root/entry validation, chmod, poststat,
  exact-mode validation), original cause including name/message/code/errno/syscall/
  path when actually present, and existing before/after dev/ino/type/uid/gid/mode.
  Mark unobserved after-state/cause fields missing; do not fabricate errno.
- Aggregate rows: retain the existing32 row keys and sequence, and add actual
  native stdout/stderr bytes, exit/signal/spawn-error fields, exact VFS result/
  diagnostics and independently recorded before/after identity/mode. Collection
  failure is its own diagnostic, not substituted for the primary failure.

No denied chmod or new eligibility probe is granted. The smallest fresh
diagnostic GO request would name just these three existing cases: the two setup
failures (stop at their original failure, no adaptive retries) and the unchanged
384-loop aggregate, capturing its32 held iterations without treating them as32
independent TAP failures. If authority does not permit those operations, retain
the missing data rather than bypass the fence. Do not add MemoryFS denials,
relax exact mode checks, guess an OS-fence cause or extend FILE-only NA2755/6755.

## 4. Socket: length hypothesis and cleanup gap, not syscall attribution

**99469** A `CAPTURES.json.rows[id].detail` records code EINVAL and error text:

```text
/private/tmp/unified76-os-write-9hZxpj/tmp/unified76-execution-FQM0aw/tmp/virtual-bash-real-ZN0iVJ/root/socket
```

Literal UTF-8/ASCII byte count is110. A `SOURCE-BINDINGS.json.socket` gives the
same path and104-byte SDK sun_path declaration; its SDK hash is retained in
BINDINGS. This is a concrete hypothesis, **not** the Node/libuv/kernel syscall
branch, a proved network denial, or a guarantee that a shorter bind is allowed.
No SDK/private/OS file was freshly probed.

`tests/fs/real/helpers.ts:14` acquires a unique tmpdir root, registers removal at
line15, creates root/root-other and the outside-secret canary. The socket test
creates server at `tests/fs/real/adversarial.test.ts:222`, awaits listen at225
and enters its close-finally only at227. The error precedes all four typed
ENOTSUP checks (stat/read/write/readdir). `src/fs/real/index.ts:31` rejects special
types in source; this failure does not execute that branch or prove cleanup.

Future fixture-owner revision may use a **socket-specific** short prefix `r-`
with the same six-character unique suffix, retain root/root-other/secret, and
basename `s`. Under the observed parent this literal layout is89 bytes:
`<same admitted TMPDIR>/r-XXXXXX/root/s`. XXXXXX is a placeholder for a fresh
owned name, never permission to reuse the retained path. Actual future path
bytes must be recorded; if the fixed admitted parent leaves insufficient room,
stop for namespace-owner authorization, not outside /tmp or a symlink bypass.

Register one idempotent cleanup with the test **before acquisition**, covering
the newly acquired temp root and server and any admitted pending listen, and
share it with finally. Close admission, await listen/error settlement and owned
server closure, then exact owned-root removal; preserve primary listen failure
and separate cleanup errors (including a never-listening server). Do not call
unconditional close and let its error replace EINVAL. Preserve/check the outside
canary before removing only the new owned root. No retained roots are cleanup
targets. This fixes the source lifecycle gap; actual cleanup still needs proof.

Smallest separate GO: one fresh short-path version of this same socket case,
unchanged fence, canary and four typed ENOTSUP assertions (only operand `s`
changes), recording requested bytes, actual listen error/status and cleanup
settlement. Keep the original110-byte failure; a future short-path success alone
does not prove that length caused the old syscall failure. No real bind/network
execution or permission change occurs under this review.

## 5. env-S: proved expectation conflict, not a new native oracle

**112555**: `tests/shell-stress/script-entrypoint/cases.ts:119` has three invalid
UTF-8 tails, each through direct and explicit bash entry; line131 then expects
126/empty stdout/unsupported-interpreter for four headers. The fourth is exactly
`#!/usr/bin/env -S bash`; body is exactly `say forbidden`, no final LF.
The shared assertion at134 captures0 versus126 but not the active header or its
stdout. The fourth-header attribution is source-supported, not new telemetry.

`src/shell/runtime.ts:1393` rejects the first three (bash CR, bashx, bash --) via
the strict Bash regexp but recognizes `/usr/bin/env`. Line1407 goes to
envShebang; line1354 forms **env argv `["-S bash","./invalid"]`**, with one
optional-argument string. `src/commands/env-split.ts:182` takes attached S content
`" bash"`, line75 splits whitespace, line148 expands and line192 preserves the
remaining script operand. `src/commands/execution.ts:85` invokes **bash argv
`["./invalid"]`** through literal invoke with replaceEnv:true. Reserved Bash
dispatch at `src/shell/runtime.ts:1313`/line1340 interprets the loaded VFS script.
`tests/shell/helpers.ts:9` registers say as virtual output with LF. Source thus
predicts `[0,"forbidden\n",""]`, not ordinary GNU Bash execution of custom say.

This is not a new feature inferred solely from implementation. Prior guarded
policy acceptance is bound in
`tests/shell-stress/env-shebang-integration-review/GUARDED_EA409A6B_REVIEW.md:12`
for `ea409a6b49d5c1523e3238f0384048218b559c4c`; the separate eight-fixture
migration review at `tests/shell-stress/env-shebang-eight-migration-review/README.md:28`
retains original inputs and positively accepts split env-S Bash forms. It covers
`5ba1a0f36e77c69b9ebb617c4d2544bf62d473a7`, not this fifteenth-row replay.
`tests/shell-stress/env-split-holdout/README.md:91` explicitly separates literal
single-argument env routing from Darwin kernel routing. Its GNU9.7-on-Darwin
and Bash5.3 identities at line13 are historical profiles, not GNU/Linux or
permission to substitute a host `/usr/bin/env`. No old scores are imported.

Safe minimal proposal for the maintained fixture owner, only after approval:
retain all six invalid-UTF8 entry assertions and all first-three invalid-header
assertions unchanged; separate just the fourth into a positive assertion with
the **same header/body/path/mode/cwd/registration inputs**, exact0, stdout
`forbidden\n`, stderr empty and exact env/bash argv observation through public
middleware. Preserve the original row and failed bytes as historical evidence.
Do not replace say with printf to pretend this is the same native test, weaken
all126 assertions, or call this an unchanged-input native parity repair.

The existing holdout's `holdout.test.ts:8` before/after filter includes shell,
contracts and memory, **not src/commands**. A successor's explicit source identity
must bind the real env execution/split dependencies and fixture helpers too,
and check appended inputs as well as existing-path changes; retain source guards,
do not merely reuse an old runtime hash. Any separately authorized native argv
witness would need its own declared portable body and exact env/Bash/recorder
binary hashes, Node/tool route, argv/env/cwd/fence and source profile; it is not
needed to establish this already-ratified virtual expectation conflict and is
not authorized here. The smallest future dynamic scope is this existing grouped
case with its disclosed one-header expectation revision, not a new native suite.

## Existing overlaps and overall closure

**58752 tac / 109526 npm** remain in the exact ledger. No duplicate helper
investigation or patch: bind S/E and V `V-dir/HANDOFF.md:46`, line81 and line91.
Tac's explicit confined TMPDIR route is authored, but V reports primary-error
masking by cleanup in stream-inspection/oracle.ts:38. Npm's exact CLI/current-Node
route is authored; CLI identity is not transitive npm/Node closure or actual
5-pass/7-test negative-fixture success. V's 0/53 UNEXECUTED independent cohort
and author-only routing evidence cannot certify either held row. Appropriate
repair owners retain those dispositions; this review grants no retry.

L `L-dir/execute.mjs:54` binds owned TMPDIR. Its source guard at line96 checks
additions/removals/content/type/mode; `L-dir/phase-runner.mjs:13` performs verify
before extra guards, line21 records canonical accounting, line25 performs
postverify. D `D-dir/HANDOFF.md:48` and line184 record the post-canonical source
guard failure before later guards; no clean full postguard sweep follows from
earlier admissions. All286 additions remain evidence. Six phase/outer clean
child receipts are not aggregate integrity/cleanup: bindingComplete,
guardsPassed, cleanupComplete and fenceClean stay false; final-sweep UNEXECUTED.
No actual root/private/postguard/cleanup was newly checked here.

**Owner decisions remaining:** public structural/native signal domain and exact
undefined disposition; separate historical/current Node qualification; bounded
directory cause-recording authority; short owned socket fixture/cleanup authority;
exact fourth-header maintained expectation/source-binding revision. Documentation
and fixture proposals are not GO. Fresh diagnostics require individually scoped
authorization after source/profile binding. Raw19425P/132F/7skip,6/14,928 captures
remain unchanged. No fifteen-row rescore, superiority or completion claim.
