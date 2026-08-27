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
  getters/setters, cycles, and retained closures. Cancellation remains fatal.
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

## Evidence

### Reference evaluation prerequisite — release pending

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
