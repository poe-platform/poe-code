# Host-function property behavior

## Evidence

During dynamic-import snapshot validation, assigning
`namespace.read.extra={count:0}` to a caller-provided exported function failed
with `Assignment expressions require a sandbox object property`.

The current `setSandboxProperty` implementation routes interpreted functions to
their guest-facing property records, but leaves host closures on the
non-indexable-object rejection path. `createSandboxClosure` freezes host-closure
property records. Reflection already reads those records separately from the
internal native call implementation.

Do not change this during the active dynamic-import full regression run. This
is a separate improvement requiring its own failing tests, implementation,
checks, commit and push.

## Validation and implementation boundaries

- Compare direct assignment, destructuring, deletion, `Object.defineProperty`,
  descriptors and extensibility against native function behavior.
- Cover names, lengths, symbol keys, inherited accessors, cycles and aliases.
- Guest writes must affect only guest-facing properties. A property named
  `call`, `construct` or `properties` must not replace the internal host callback
  or expose native closure state.
- Preserve caller-owned host functions and their property descriptors.
- Account for retained guest data, including data reachable through accessors;
  verify snapshot/replay and repeated restoration.
- Keep unrelated live-host-object policy and native promise-property admission
  unchanged. Do not copy arbitrary host metadata to obtain apparent parity.

A separate suspected function-alias bug was not validated: inspection confirmed
that `wrapCallerInjectedFunction` already checks its seen map before allocating
a closure. Do not change deduplication based on the earlier suspicion.

Fresh built-runtime differential probe on September 8 (Node 22.23.2), after the
shared-scope build and while its source suite remained frozen:

- `fn.extra = 1; return fn.extra`: native 1; SafeJS rejects assignment.
- `Object.defineProperty(fn, "extra", {value:1}); return fn.extra`: native 1;
  SafeJS reports host function properties are read only.
- `[Object.isExtensible(fn), Reflect.ownKeys(fn)]`: native arrow function reports
  true and length/name keys; SafeJS reports false and no keys.
- `fn.call = 3; return fn()`: native 7; SafeJS rejects assignment.
- `delete fn.name`: native true; SafeJS rejects deletion.

The harness catches both returned failures and thrown guest errors. Its first
uncaught run stopped at the assignment failure; the corrected run completed all
five cases. These are validated behavioral gaps, not an implementation yet.

Further controls: `.call`, `.apply` and `.bind` all produce the same sum as
native and must not be treated as missing. `typeof fn.length` and `typeof fn.name`
are both undefined rather than number/string. Comparing the supplied function's
prototype with an interpreted ordinary function's prototype returns false,
versus true natively. Use that comparison rather than referencing the absent
Function global, which tests a different limitation. The copyFunctionProperties
bridge currently admits only own string-keyed data properties whose values are
functions; blindly copying all host properties would expand admission policy.

Source regressions now reproduce 12 failures out of 14 cases in
host-function-properties.test.ts. Passing controls are call/apply/bind and the
post-freeze write rejection; the latter passes because transport properties are
already frozen, not because normal extensibility works. Every case compares
native strict-mode behavior and checks that the caller function remains intact.

Implementation review: guest-facing function properties already live in the
object-model WeakMap, separately from frozen closure call/construct fields.
Host closures currently keep a separately frozen properties record instead.
Unify only the guest-facing property storage and relevant read/write/reflection
paths. Do not mark host capabilities as interpreted guest closures: snapshot
and AST ownership use that classification. Preserve host-call identity, replay
registration and cancellation. Default metadata admission must not invoke host
getters or copy arbitrary native metadata. Existing functionSourceText=false
behavior is also a policy boundary to preserve.

Runtime iteration now uses the existing function-property WeakMap for host
closures without changing their guest/host classification. Property writes,
descriptors, metadata, inherited accessors, freezing and object spread pass the
native comparisons. Native name/length data descriptors are admitted without
invoking host getters; other host metadata remains under the previous policy.

Replay capability lookup now traverses the trusted closure properties accessor
explicitly rather than requiring that internal field to be a data descriptor.
Replay encoding admits property tables only through explicitly identified host
capabilities; arbitrary callable results remain rejected. Trusted run dumps
replay host callable state, while low-level serialization still rejects host
functions without registered module authority.

Additional failing tests caught object spread rejection and deleted name metadata
being recreated during restoration. Both now pass: explicit property records are
restored exactly, including omitted defaults. Two successive JSON restores retain
the module function's property cycle, mutated counter, prototype and deleted name
while reconnecting the replacement callback. The previous frozen-properties
replay test now asserts mutability plus isolation from the original capability.

Latest focused gate: 124 passes in six files, including 16 new property cases,
replay data, dynamic imports, function prototypes and bind ordering. No full
regression/build/lint gate yet. Continue auditing for-in, coercion, reflection,
budget accounting and policy boundaries before committing.

Delivery monitoring: accounting commit 517f79e3b published SafeJS 0.1.441 through
run 34204777868 at 2026-09-08T08:33:49Z. Prototype scoped run 34204805113 and CLI
run 34204805418 remain active; publication is not yet verified for that change.

Enumeration/coercion controls: Object.assign and prototype valueOf already pass;
for-in failed and was fixed to enumerate host closures through their property
tables. The native comparison file now passes 19 tests. Maintained build passed
23 workspaces and four imports. Lint identified obsolete branches/helper code
after host closures joined the normal property paths; those were removed.

Budget gate is not green: 121 tests passed and four failed. The durable snapshot
case now rejects at 19 > 18 before reaching its intended checkpoint; three
retained-root cases reject at 3504/3506/3509 > 3500. Newly materialized host
name/length metadata must not inflate transport overhead, but guest mutations
must remain charged. Do not raise budgets or unconditionally ignore properties
named name/length: a guest could store retained data there. Investigate trusted
initial metadata descriptors, preserving their baseline across capability copies
and charging changed values, accessors and flags. Snapshot restoration must not
allow forged metadata defaults to exempt arbitrary guest data.

Prototype optimization publication is now verified: scoped run 34204805113
published SafeJS 0.1.442 at 2026-09-08T08:38:07Z. CLI run 34204805418 remains active.

Budget regressions now pass without changed limits. Native metadata defaults are
stored privately against property-table identity and transferred from supplied
capabilities during restoration, never accepted from snapshot fields. Accounting
compares the full original data descriptor; replacements, flag changes and
accessors are charged normally. Two new failing tests became green, including
restored changed metadata that must not become a trusted default.

Graph review reproduced property-table alias loss: adopting an explicitly
provided table now preserves aliases rather than cloning it. Further tests cover
both graph-root orders with non-enumerable metadata. Trusted host property tables
can encode their data descriptors, while callables still require explicit
capability identities. A separate failing guard test caught silent dropping of
an explicit table prototype; that state is rejected rather than discarded.

Latest focused gate: 66 passes in five files, including all budget failures,
host-function semantics, metadata and replay-data controls. Build session 15504
and lint session 48191 are active. Before the full gate, add explicit admission
controls for native name/length getters (especially default module exports),
and inspect remaining snapshot/copy paths for metadata and alias preservation.

Admission regression reproduced an implicit native name getter call for default
module exports; ordinary bindings already passed. Binding-name selection now
uses the own data descriptor without executing the accessor. Both name/length
getter controls pass. The host wrapping/replay focused group passed 100 tests;
fresh maintained build passed 23 workspaces and four imports, and lint passed.
Full SafeJS regression has now started with source/tests frozen.

Active full run: session 38144, log
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-host-properties.lFBrN0reYO`.
Built Node 18 checks passed for host-function mutation, deletion, for-in and
unchanged caller function state. No source changes are being made during this
run. CLI validation for the already-pushed prototype fix is still active.

Full run 38144 found validation-order regressions in execution-semantics rejection,
a legacy error-constructor prototype regression, and an old test requiring native
capabilities to remain read-only. Stopped the known-failing process 31324; session
exited 130. This is an incomplete failed gate, not a pass. Preserve version
rejection before host effects and legacy constructor shape. Update only the old
read-only expectation that directly conflicts with the requested guest-facing
mutability, retaining implementation-field isolation assertions. All three local
camera cases passed (4272/3165/2473 ms). Node 18 checks also passed.

Focused reproduction confirmed seven failures across compatibility, legacy error
constructors and the obsolete read-only assertion. Execution-semantics validation
now occurs in the dump envelope before nested runtime state validation, reading
the marker through its own data descriptor. A new regression first failed because
the marker getter executed; it now rejects without executing that getter. Default
prototype synthesis is restricted to guest constructors, preserving legacy host
constructor shape. The revised capability test retains private-field checks and
asserts that guest writes leave the caller function unchanged. All 219 focused
tests across seven files pass. Fresh build and lint are in progress; no commit or
push of this candidate yet.

Fresh build completed all 23 workspaces and four native import checks; lint passed.
Full regression is running as session 37609, log
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-host-properties.Hq5FoLVpMM`.
Source and tests are frozen for this run. Only the two previously documented
experimental weak-collection and host-promise-property files remain excluded.

Run 37609 exposed an explicit-migration regression in run.references.test.ts:
the shared envelope validator must permit inspection of old execution semantics,
even though resume rejects them. Stopped the confirmed failing Vitest PID 34431;
session exited 130. Focused reproduction was 98 passes and one failure. Added a
resume validation option used by restore only; migration inspection remains
permitted, while marker accessors are still rejected without execution. All 240
tests in the six-file compatibility/reference/migration group now pass. Fresh
build session 68783 and lint session 8457 are running. No active full-suite run
until that build finishes. Camera cases in the stopped run passed locally at
3983/3567/2876 ms; this does not resolve the remote CI timeout issue.

Build 68783 passed (23 workspaces and four imports); lint 8457 passed.
Replacement full suite is now live as session 83331, log
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-host-properties.IQs049qUVT`.
Source/tests frozen; same two documented experimental exclusions, no new ones.

Downstream agent-harness gate 92088 passed: 163 tests in 13 files (23.34 s).
Full gate 83331 is still live, with no reported failures at the latest poll and
all three camera cases passing (3684/3128/2639 ms). Fetched remote main advanced
to 061a3e7078e172d789e908fea5eb399d0d4f73a5, five Safe-Bash/documentation commits
after local 9664c440a; integrate those before pushing without losing the user's
three staged Safe-Bash changes. Their protected patch ID remains
d770ec782b2a4ae7e2580e63ded765933890a1c5. Remote release runs 34207154869 (scoped)
and 34207155093 (CLI) are live; schemas 34207154926 succeeded.

Node 18 fresh built smoke check passed after the latest validation changes:
guest property writes, deleted name, for-in keys, original callable invocation,
and unchanged caller function. Full suite 83331 remains live without reported
failures as of 09:01 UTC. Scoped run 34207154869 completed successfully and its
log confirms SafeJS 0.1.443 publication at 08:59:41 UTC; that release contains
remote main, not this uncommitted host-function candidate. CLI 34207155093 remains
in progress.

Full suite 83331 finished with exit 1: 20,227 passes, 37 skips, seven failures;
675 files passed, seven failed, one skipped (422.08 s). Failing cases are the
read-only expectations in date-static-function-properties, number-function-
properties and symbol-descriptors; host prototype visibility in lint/prototype-
access; default arity in methods/function; console shape parity with journaling;
and restore identity in running-state. Do not classify all as obsolete: console
shape and snapshot identity need further investigation. Updated only the first
three obsolete read-only expectations to assert guest mutation with protected
implementation fields/native caller isolation. Focused session 55349 covers
those three files. Source freeze is lifted; there is no live full suite now.

Before eventual remote integration, the user's staged zero-context patch ID is
69df99c443cea05ae0f9e88dae5d20292332d8b8. This compares exact changed lines even
if new adjacent upstream context alters the earlier full-context patch hash.

The three replacement mutation/isolation tests passed (65 tests, three files).
Investigated the remaining four: console plain construction retained an empty
property table while journaling admitted name/length; both now materialize the
same metadata and record trusted initial metadata for accounting. Trusted runtime
envelope validation now permits the same host-function state as trusted dump
replay, avoiding needless portable normalization and preserving snapshot identity.
This exemption does not apply to untrusted/copied envelopes or guest closures.
A copied-envelope regression confirms trust is not transferable. Updated default
arity expectation to zero and prototype test to require the sandbox function
prototype while still hiding native constructor/prototype/__proto__ properties.
The six-file remaining-failure group passed 91 tests; the added trust/metadata/
budget/compatibility group passed 90. Unchanged 18/3500-unit budgets pass.
Build session 4301 and lint 91803 are running; no active full suite yet.

Build 4301 and lint 91803 completed successfully. Full suite 68565 is live at
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-host-properties.2zekWCe4cg`.
Source/tests frozen again, same two documented exclusions only. CLI release
34207155093 is still active at the latest check.

Final full gate 68565 passed: 20,235 tests, 37 skips; 682 files passed and one
skipped (411.16 s). Only the two documented experimental files were excluded.
Fresh downstream gate 12739 passed 163 tests in 13 files (22.29 s). Node 18 built
checks passed mutation, native caller isolation, snapshot identity and rejection
of copied untrusted envelopes. Build, lint and diff checks passed. Camera cases
passed at 4250/3655/2723 ms. No matching open host-function issue was found.

Earlier remote-main CLI run 34207155093 succeeded and published poe-code 14.0.92
at 09:12:16 UTC. Scoped SafeJS 0.1.443 publication was already verified. Neither
release contains this candidate yet. Ready for its own commit and main push.
