# SafeJS classes and owned prototypes

Status: in progress. This is the class/prototype item in
`safejs-language-completeness.md`, not a replacement for its full checklist.
No class or prototype support is complete merely because a prerequisite ships.

## Required end state

- Classes work as declarations, expressions, and exports, with lexical bindings,
  temporal dead zones, strict execution, constructors, and instance/static members.
- Inheritance supports constructor and instance prototype chains, `super`,
  `new.target`, derived-constructor initialization/return rules, and bound constructors.
- Methods, accessors, computed names, instance/static fields, private names/brands,
  and static initialization blocks preserve source evaluation order and receivers.
- Ordinary constructors and classes share object operations: prototype lookup and
  mutation, descriptors, extensibility, `instanceof`, `in`, own/inherited enumeration,
  deletion, destructuring, spread, and object/array builtins.
- Intrinsic prototypes belong to each sandbox execution. Neither native prototypes
  nor closure implementation fields become script-accessible capabilities.
- Budgets account for prototype edges, descriptors, private state, constructors,
  getters/setters, cycles, and retained closures. Budget/reentry failures remain
  fatal. Cancellation revokes host operations while allowing local cleanup,
  preserving the existing `CHECKPOINT_REPLAY.md` contract.
- Checkpoint, replay, migration, host crossings, and lint understand the same object
  model. No silently discarded prototype/accessor/private state; incompatible replay
  semantics require an explicit marker and migration, never a hash/marker rewrite.

## Implementation order

1. Correct existing reference reads/writes before introducing accessors. Compound
   assignment reads once before its RHS; simple assignment does not read; logical
   assignment only writes when selected. Failed writes occur after RHS evaluation.
2. Introduce a shared sandbox-owned object model and per-run intrinsic realm.
   Explicit metadata must hide native implementation properties and retain graph
   edges through memory accounting and serialization. Accessors call interpreted
   closures through the budgeted execution path, never native JS getters.
3. Route all property consumers through that model, including calls, coercion,
   patterns, object builtins, array methods, enumeration, and host conversion.
4. Add class AST/parser/static validation and runtime construction together with
   ordinary function prototype properties. Add lexical home-object/private-name
   environments and derived `this` initialization rather than parser-only support.
5. Validate the entire public execution surface, then release the completed item.

## Audit findings

On August 27, 2026 the interpreter has own-data-property lookup, frozen closure
property bags, special builtin dispatch, and no class AST. Object globals are a
record rather than a callable constructor. `__proto__` literal setters are ignored;
`in` is unsupported, and ordinary `instanceof` rejects constructor prototypes.
Destructuring and object/array helpers also bypass a shared property model.

The first audit found a prerequisite correctness bug: member compound assignment
reads the old value after its RHS, and lexical assignment rejects constant writes
before evaluating the RHS or checking logical short-circuiting. These bugs would
also multiply getter calls and misorder setters once accessors are introduced.

## Validation gates

- Write native-comparison regressions before each behavior change. Include abrupt
  completion, base/key/receiver identity, nested writes, aliasing, and await boundaries.
- Run independent generated script matrices for ordinary functions, async functions,
  top-level execution, inheritance depth, descriptors, private state, and constructors.
- Exercise JSON checkpoints and repeated restores, failed runs, cancellation,
  budget exhaustion, process termination, and reconciled host effects. Verify effect
  counts, not just returned values.
- Probe native prototype/Function/process escapes, cross-run pollution, corrupt
  serialized graphs, cycles, and long chains. A conformance gap remains open until
  fixed and directly revalidated; passing an existing suite is not completeness.
- Run focused tests, SafeJS/agent-harness suites, typechecks, build, installed-consumer
  checks, stale-artifact audit, and relevant visual CLI checks. Verify every release
  workflow and exact published package identity before recording release success.

## Object-model integration audit

- The existing no-`eval`/no-dynamic-`Function` capability policy remains in force.
  Owned function prototypes must not turn a `.constructor` chain into a native
  execution escape. Adding classes is not permission to expose host intrinsics.
- Use explicit object metadata for sandbox prototype edges and descriptors; native
  getters cannot implement source accessors because interpreter calls are async
  operations. Function property storage must remain separate from native closure
  wrapper fields (`call`, `construct`, cancellation metadata, and brands).
- `run.ts` creates fresh builtin bindings, but `values.ts` passes branded closures,
  generators, promises, and regex values through copies. Realm ownership and
  host-capability crossing need deliberate handling; a shared mutable prototype
  table attached to those wrappers would create cross-run pollution.
- `measureSandboxData` currently walks array elements, collection contents, and
  captured closure values, not a general descriptor/prototype graph. Include named
  array properties and newly introduced graph edges in the ownership/budget work.
  Intrinsic baseline allocations must not charge every script for the whole builtin
  realm, while script additions/replacements on intrinsic prototypes must be charged
  even when no user binding points at them.
- `patterns.ts` still resolves/writes member targets separately. Assignment defaults
  must capture their target reference before evaluating a default initializer.
  Getters, object rest/spread, and pattern source reads must use the same operations
  as direct member expressions rather than native object reads/writes.
- `iteration.ts` currently adapts native iterators and sandbox generator channels.
  Owned iterator methods must invoke source closures through interpreter control,
  not pass a source property to native `Reflect.apply`.
- `snapshot/replay-data.ts` currently records physical own data descriptors and
  rejects accessors/custom host prototypes. Extend that protocol deliberately for
  owned objects, aliases, cycles, private state, and registered source capabilities;
  do not relax the rejection of arbitrary host prototypes/accessors.

## Evidence

### Reference evaluation prerequisite — released in poe-code 11.0.0

This prerequisite does not complete classes, prototypes, descriptors, or all
property consumers. Computed-key coercion, binary-expression coercion, pattern
references, accessors, intrinsic ownership, and class construction still belong
to the shared object-model work above.

Corrected lexical/member assignment and update expressions:

- Capture the member's old value before its RHS, including awaited RHS calls,
  without reevaluating the base/key or reading for simple assignment.
- Check logical short-circuiting before a constant write; report unresolved,
  constant, TDZ, and primitive write failures at the relevant read/write operation.
- Coerce captured operands through budgeted source methods after RHS evaluation;
  updates coerce before writing. Failed primitive conversion throws instead of
  silently substituting a default string.
- Preserve existing own-data-property flags rather than recreating descriptors.
  RegExp numeric `lastIndex` assignments/updates use the same captured-read path.
- Accept all numeric data values in checkpoint graphs. Stress found that generic
  validation incorrectly rejected large finite integers. Structural cursors and
  identities still require safe integers at their dedicated validators.
- Emit `jobs-v6`; implicit restore of earlier semantics fails before host effects.
  Explicit migration accepts `jobs-v1` through `jobs-v6` and retains ancestry.

TDD evidence: the initial reference suite exposed 31 failures, the coercion/primitive
extension exposed 37, the marker test exposed one, and large-number replay exposed
five. The focused suite now contains 99 passing cases. Existing unsafe-integer
validation coverage now targets an actual clock cursor, not arbitrary user data.

Independent ad-hoc scripts retained outside the repository:

- `/tmp/safejs-references-matrix.mjs`: 1,152 native-comparison executions, 2,304
  completed restores, and 12,795 original effects with zero repetitions. Seven
  expression families cover 16 operators, three entry forms, three widths, await
  boundaries, plus 48 concurrent executions.
- `/tmp/safejs-references-failures.mjs`: 288 budget failures and 576 recoveries/
  completed restores; 72 aborts, 180 coercion-error/fallback cases, and 64 concurrent
  isolation checks. Zero repeated effects or fatal-error escape callbacks.
  Abort checks concern revoked host capabilities, not a prohibition on local
  computation/cleanup after cancellation; the latter is explicitly permitted.
- `/tmp/safejs-references-crash.mjs`: 18 actual SIGKILLs, 18 subsequent budget
  failures, 36 successful restores, 12 external reconciliation receipts, and 72
  terminated child processes. Covers a pending effect, a plain await, and an effect
  suspended inside a source callback. Every durable effect occurs once.
- `/tmp/safejs-references-cli.mjs`: 15 root/standalone scenarios, 54 child processes,
  24 restores, and 15 rejected legacy-marker checkpoints. No repeated filesystem
  effects. Root budget errors use exit 1; standalone budget errors use exit 3.
- `/tmp/safejs-references-legacy.mjs`: 36 actual poe-code 10.0.4/jobs-v5 snapshots
  cannot resume implicitly, then explicitly migrate and replay without repeating
  old effects. The separate historical migration matrix passes 90 genuine
  snapshots from five published versions spanning jobs-v1 through jobs-v5.

The stress harness itself required corrections: public snapshot serialization uses
`dump({snapshot})`, pending-process fixtures need a live event-loop handle, aborts
may preserve the AbortController reason, root/standalone exit codes differ, and
the filesystem fixture expects a real newline. Failed harness attempts are not
counted as successful runtime validations.
An additional cancellation probe showed that native JavaScript without a signal
is not an oracle for a canceled run's completion result: local cleanup is permitted,
but a canceled invocation can still reject. The abort matrix asserts the actual
host-capability revocation contract, not successful completion after cancellation.
Source-call promise ownership across entry forms remains part of the object-model
integration audit, rather than evidence of universal cancellation conformance.

Regression scripts also pass: migration (810 cases, 1,620 restores, 1,350 expected
failures), recovery (138 budget cases, 27 ordinary failures, 468 restores, 48
concurrent cases), and fatal promise isolation (360 cases, zero escaping effects).
Opt-in adversarial/parser fuzz: nine pass, five explicit conformance skips remain.

Fresh packed consumer: `/tmp/safejs-references-consumer.Ma5Er9/project`. The actual
CI SDK smoke now includes reference capture, constant short-circuiting, large-number
replay, and the current marker. Its extracted consumer execution, strict public
declarations, shared index/core runtime, crash/failure/CLI matrices, and historical
migration checks pass without workspace runtime symlinks.
The 1,152-case matrix also passes independently under Node 18.18.2, 22.22.2,
and 24.14.0 against that installed package; those are repeat validations of the
same cases, not three times as many independent scenarios.

Final repository suite: 21,237 pass, 41 skip, across 928 passing test files and
three skipped files. Run TTY-dependent tests with `TERM=xterm-256color`; the first
full run used `TERM=dumb` and five readline lifecycle cases failed. Their focused
rerun and the complete correctly configured run pass without changing terminal
code. Root types, changed-file ESLint, new-file formatting, and all 17 package
lint rules pass.

Inspected CLI images: `screenshots/safejs-references-root.png`,
`screenshots/safejs-references-standalone.png`, and
`screenshots/safejs-references-budget.png`. Both successful frontends report 14;
the rejected constant write records its RHS before TypeError; the budget image
shows the expected failure. Visual fixtures remain under `/tmp`, not in source.

Cleanup audits still find all 153 obsolete output files and six obsolete
directories absent in both workspace and packed consumer. All five binaries
exist; all 19 consumer symlinks stay inside that consumer. Unrelated terminal-pilot
font assets remain untouched. No class/prototype completion claim follows from
these bounded results.

Final build gate: 67 forced workspace builds succeed, followed by the normal
cache-hit build and root bundle generation. The 153-file/six-directory cleanup
audit passes after each build. No validation processes were using workspace dist
while those builds ran.

### Registry release receipt

- Code commit: `d94439542182ced254ed867f08dc377ba37256a6` —
  `fix(safejs)!: preserve assignment reference evaluation`.
- GitHub Release run `33068025742`: success; release job takes 9m2s. Build,
  signature audit, package rules, full tests, SDK/CLI smoke, publication, and
  post-job cleanup all pass. Pre-commit and pre-push hooks were not bypassed.
- npm publishes `poe-code@11.0.0` on August 27, 2026 at
  `2026-08-27T11:44:09.960Z`; GitHub tag/release `v11.0.0` follows at
  `2026-08-27T11:44:11Z`. npm `gitHead` and the tag both identify the exact code
  commit above. This is a major release because older execution markers require
  explicit migration, not implicit replay under changed reference semantics.
- Fresh exact registry installation: `/tmp/safejs-references-published.5h0OEo`.
  Re-ran the same 1,152-case/2,304-restore matrix on Node 18.18.2, 22.22.2, and
  24.14.0. The 288 budget, 72 abort-capability, 180 coercion, 64 isolation, 18
  SIGKILL, 15 CLI, 36 actual-10.0.4, and 90 older historical snapshot cases pass.
  Counts describe the same scenarios repeated against the published artifact,
  not additional independent coverage. No native effects are repeated.
- The installed package also passes the 810-case migration matrix and recovery
  regression (138 budget cases, 27 ordinary failures, 468 restores, 48 concurrent
  runs), the actual current CI SDK smoke, strict public types, and index/core
  identity checks. Evidence remains in `/tmp/safejs-references-published-*`;
  the successful abort/coercion log is `safejs-references-published-failures-final.log`.
- Registry cleanup audit: 153 removed outputs and six obsolete directories remain
  absent, all five binaries exist, and all 19 symlinks are internal. No global
  installation or skill mutation was needed. User font assets remain untouched.
- Only this prerequisite is released. The full class/prototype requirement and
  all remaining checklist items stay open; the overall goal remains active.
