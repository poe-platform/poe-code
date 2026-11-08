# ERE budget/API/error decisions — additive source-only clarification

2026-08-29. ROOT conceptually ratified profile choices1–3 and5–6; no implementation
GO. This supersedes the original design's suggestion that every private regex
resource failure could become ShellLimitError. Original proposal/evidence remain.
No runtime, native oracle, Worker, compiler, engine or network activation here.

## 1. Actual public keys and accurate mapping

Frozen `src/shell/types.ts:18–27` has exactly these eight ShellLimits keys:
`maxOutputBytes`, `maxCommands`, `maxLoopIterations`, `maxSubstitutionDepth`,
`maxSourceBytes`, `maxExpansionFields`, `maxExpansionBytes`, `pipeHighWaterMark`.
`ShellLimitError.limit` is `keyof ShellLimits`, not an extensible free-form label.
`runtime.ts:36–45,69–101,3749–3753` supplies defaults and actual charging sites.

| Proposed resource | Accurate existing public mapping / proposed channel |
| --- | --- |
| Existing LHS/RHS word expansion bytes | Preserve existing `ShellLimitError(maxExpansionBytes)` from actual expansion. No substitute error or new counting rule. |
| Existing expansion fields | Preserve `maxExpansionFields` only when the existing expansion actually produces fields; regex groups or stored capture indexes are not argv fields. |
| Pattern<=min(B,65536), subject<=min(B,1048576) | A private regex input-admission ceiling. Crossing that ceiling is private profile-limit/status3, unless ordinary expansion has already thrown a genuine public error. An input ceiling derived from B does not make every refusal a public byte-limit violation. |
| Matcher work<=min(50000000,32B) | No fitting ShellLimits key. Private profile-limit/status3, resource `work`. Not `maxLoopIterations`, `maxCommands` or `maxExpansionBytes`. |
| State admissions<=min(65536,8F) | No fitting key. Private profile-limit/status3, resource `states`. Not expansion fields. |
| Cumulative allocation units<=min(4000000,8B+128F) | No fitting key. Private profile-limit/status3, resource `allocationUnits`; logical units are not public output/expansion bytes or RSS. |
| Capture-byte sum<=B and capture slots N+1<=F | New private capture admission, resources `captureBytes`/`captureSlots`, status3. Storing an indexed binding is not ordinary word/argv expansion. |
| Existing private ArrayLedger reservation failure | No public key. The ordinary array-command route diagnoses ArrayFailure/status1, but conditional.ts integration currently wraps unexpected errors via NounsetDiagnosticFailure/Flow. A new capture writer therefore needs a narrowly identified owned-publication failure route; status1 is not automatic merely from reusing ArrayFailure. No fabricated ShellLimitError or blanket catch. |
| Diagnostic output | Actual writes remain charged by existing output sinks; genuine `maxOutputBytes`, raw sink failures and caller/control precedence apply. |
| Script source, substitutions, shell loops/commands | Preserve their existing named limits at their actual sites. Do not charge regex AST depth/nodes, VM loops or requests to these unrelated keys. |
| pipeHighWaterMark | Existing pipe flow-control setting, not an ERE allocation ceiling. |

B/F name maxExpansionBytes/maxExpansionFields only as inputs to the proposed
private formulas; ROOT still needs to ratify those formulas. Check safe integer
arithmetic and zero ceilings without coercion/clamping upward. Grammar caps remain
4096 nodes/depth64/groups32/interval0..255: profile refusal/status2, not a public
resource error. There is no new ShellLimits key or public error-union change in
the recommended design.

## 2. Recommended private failure channel

Add a non-root-exported `EreProfileLimitError` with a finite resource discriminator
for patternBytes, subjectBytes, work, states, allocationUnits, captureBytes and
captureSlots. Recognize local instances or an exactly validated Worker reply,
never an arbitrary provider object's name/code. At the conditional-command
boundary, emit a bounded profile-limit diagnostic and return status3. Throw it
through boolean evaluation so `!`/`&&`/`||` inside `[[ ]]` cannot turn an exhausted
matcher into a boolean success or suppress it. Surrounding shell status/errexit
rules continue to apply normally; this is not a new global abort policy.

This follows a real bounded-command precedent, not a generic rule:
`expr/internal.ts:26–28` defines ExprError(exitCode2|3), and
`expr/index.ts:54–68` maps syntax/unsupported to2 versus private match limits and
execution failures to3. Separately inspected accepted Node module
`a2f3983da537b95bed65b8bc727ab93bc7e98ca3` exports NodeProfileError and uses2 for
profile refusal (`node/types.ts`, `node/index.ts:112–129`). Therefore Node does
**not** establish a universal status3 or ShellLimitError policy. ERE's proposed3
must be explicitly approved; it is not a GNU regex exit-status observation.

Genuine ShellLimitError, caller/control reasons, unexpected host errors and sink/
cleanup rejection retain their actual identities. Worker crash, protocol violation,
startup/request timeout or retirement failure are not invalid-regex/status2 or
no-match/status1; preserve the execution/cleanup error channel. No fake MATCH code.
Do not mutate the existing RegexErrorCode union to squeeze in unrelated resources.

## 3. Shared invocation-root consumption, not job reset

One private ERE ledger belongs to the existing invocation root; internal invokes,
pipeline branches and nested conditionals reserve from it. A fresh independent
public Shell.exec retains the existing fresh-root boundary. No parent Budget
counter or caller signal is reset or weakened. Live temporary ownership is freed
only after actual retirement; cumulative work/state/allocation consumption is not.

The original successful reply's steps/allocatedUnits alone was insufficient to
account state consumption and failed jobs. Required amendment: every semantic
reply, including syntax/profile failure, carries exact bounded usage for steps,
state admissions and allocation units. Root reserves a non-overlapping grant
before dispatch, validates usage, and releases only proven unused credit. On
timeout/crash/malformed reply, unproved credit is not refunded (conservatively
consume the grant); actual buffer/job retirement remains independently awaited.
Serial root admission is simplest initially. Any future concurrency must use the
same reservation ledger, not copy remaining counters per child. Internal retries
are not authorized. Checked reservations must precede input/reply copies and
capture staging; a fresh worker must not restore the invocation's spent budget.

## 4. Public versus internal protocol facts

- Frozen `src/index.ts:5` explicitly exports RegexExecutionOptions. It is also
  reachable through StandardCommandsOptions.regex, AgentCommandsOptions.regex,
  ExprCommandsOptions.regex and SearchOptions.regex. It has eight numeric policy
  fields: requestTimeoutMs, startupTimeoutMs, maxWorkers, maxQueuedRequests,
  maxQueuedBytes, idleTimeoutMs, workerOldGenerationMb, workerStackMb.
- Those options contain **no custom regex-executor/factory hook**. The public
  `execute?: CommandHandler` is command dispatch, not a RegexExecutor injection.
  Do not make builtin matching depend on that callback or silently reinterpret
  public aggregate options as ShellOptions.
- RegexExecutor/RegexSession, Descriptor/Request/Reply and ExprMatchDescriptor/
  ExprMatchResult are exported from internal source modules, but are not root
  re-exports or declared regex-execution package subpaths in the frozen package.
  Their declarations/files are nevertheless shipped, and the public options
  reference protocol declarations. Thus adding internal exports is observable
  package/declaration change, **not an assertion of absolute privacy**. Absolute
  file consumers/custom subclasses are possible, though not a declared injection API.
- Recommendation: preserve RegexExecutionOptions, existing Descriptor/Request/Reply,
  RegexErrorCode and all expr input/output shapes byte-for-byte. Add a distinct
  internal ERE descriptor/reply module and separate session method/overload later;
  combine operations only in a private dispatch union. Old custom direct users
  must not receive ERE requests from an unchanged existing method. Root exports,
  manifest exports and supported command options stay unchanged.
- Later integration needs declaration-diff and actual moved-package import/type
  checks. No such runtime/compiler checks were run here; source reachability is
  not packed-consumer proof or an assurance that changed internal files are invisible.

## 5. Invalid syntax versus unsupported profile

Pinned GNU5.3.15 `lib/sh/shmatch.c` calls regcomp with REG_EXTENDED. Compile
failure returns2 before capture-array lookup/flush. `execute_cmd.c:4095–4103`
then diagnoses invalid regular expression using the actual pattern and optionally
regerror's text. It does not establish a portable libc diagnostic string. The
source comes from the previously authenticated tree; no native execution here.

Proposed distinct categories, both with budgeted status2:

- `syntax`: malformed ERE within the admitted grammar, such as an unclosed group
  supplied through an expanded operand or a reversed interval. Diagnose invalid
  regular expression; preserve prior BASH_REMATCH. Whole shell-grammar failures
  remain ShellSyntaxError, including syntax in unvisited branches.
- `unsupported`: valid native constructs excluded by this bounded profile,
  unsupported encoding/locale, backreferences, captured nullable repetition and
  private grammar ceilings. Diagnose unsupported ERE profile (with a finite
  reason), **not** a fabricated GNU invalid-regex message. Preserve captures.

Neither diagnostic has frozen native bytes. For inputs combining malformed and
unsupported constructs, recommend deterministic token-order classification: the
first reached parser/admission fault wins; do not scan ahead pretending to prove
native invalidity after encountering an excluded construct. Skipped regex operands
do not expand, compile or publish. Genuine resource errors and private status3
remain separate from both categories. Readonly diagnostic/retain-match-status
behavior remains the conceptually ratified5.3 source profile, not invalid syntax.

## 6. First implementation window: standalone engine only

Proposed disjoint production paths, only after explicit ROOT GO:

```text
src/commands/regex-execution/ere/types.ts
src/commands/regex-execution/ere/errors.ts
src/commands/regex-execution/ere/limits.ts
src/commands/regex-execution/ere/syntax.ts
src/commands/regex-execution/ere/matcher.ts
tests/commands/regex-execution/ere/**
```

No edits to expr, current protocol/client/worker files, parser/runtime/shell, public
barrels/contracts/manifests or accepted fixtures in this first window. Engine
accepts bounded admitted bytes/literal-origin information and an explicit private
usage allowance; returns complete spans or typed syntax/profile/limit outcomes.
It neither acquires a Worker nor publishes BASH_REMATCH. The future adapter owns
root reservations, Worker enrollment and exact reply validation; the future runtime
owns expansion/capture transactions after N14 acceptance. Standalone engine results
must not be promoted to integration, cleanup, root-sharing or public API acceptance.

Future tests: all admitted capture positions, earliest/longest ties, repeated-group
resets, anchors/newlines, quote fragments, syntax versus profile refusals,
zero/boundary/one-over allowances and usage on failures; discriminator mutants for
first-alternative selection, missing captures, history collapse and budget reset.
Use existing32 reference programs/8 host protocols as UNRUN obligations; future
native execution needs its own GO. No Worker/native/compiler tests are authorized
by this source-only document. N14 and all accepted features remain undisturbed.

**ROOT decisions remaining:** ratify private-limit/status3 and exact finite resource
names/formulas; approve the failed-reply usage/no-unproved-refund rule; approve the
internal-only additive API strategy and engine-only scope. No public type change is
recommended. If ROOT instead requires public distinguishable typed rejection for
each private counter, that needs an explicit exported error/API proposal rather
than misusing keyof ShellLimits.
