# SafeJS language completeness

Objective: resolve every item in the SafeJS README's “Gotchas” and “What's
intentionally limited” sections. Ship each item as a separate conventional commit
on main and verify its GitHub release before shipping the next item. Do not claim
language completeness from passing existing tests alone.

## Delivery checklist

- [x] Mutable closures: accept shared mutable lexical captures in lint, verify
      read/write, shadowing, default parameters, per-iteration bindings, async branches,
      and snapshot/restore behavior.
- [ ] Function syntax: lint declarations and expressions, including default
      exports, with the same semantics and diagnostics as runtime. Native-JavaScript
      audit also found missing ordinary-function `arguments` bindings; include their
      strict-mode semantics and arrow inheritance in this item.
- [ ] Markdown: handle multiple executable blocks explicitly rather than quietly
      ignoring code; verify fenced-block boundaries and actionable errors.
- [ ] Snapshot evolution: provide an explicit, validated migration path without
      silently restoring incompatible execution state or repeating side effects.
- [ ] Randomness: make default randomness resumable and deterministic without
      requiring callers to remember an extra option.
- [ ] Promise construction: implement sandboxed executors, settlement, chaining,
      rejection handling, budgets, and snapshot behavior.
- [ ] Agent failures: provide explicit checked/unchecked result handling with
      CLI/SDK parity rather than an implicit unrecoverable orchestration failure.
- [ ] MCP: provide usable transport integration without requiring custom glue.
- [ ] Environment: make capability configuration explicit and missing/denied
      variables distinguishable without granting ambient host access.
- [ ] Budgets: support an explicit recoverable checkpoint/result policy without
      letting scripts bypass host resource limits.
- [ ] Remaining lint/runtime syntax parity: var, switch, this, and supported new
      expressions, including Map and Set; retain host-escape protections.
- [ ] Classes and prototypes: implement language-level objects and inheritance
      inside the sandbox, never exposing host prototypes.
- [ ] Generators: implement async generators and resumable suspended generators.
- [ ] Regular expressions: support backreferences, lookaround, named groups, and
      Unicode properties while preserving enforceable execution budgets.
- [ ] Network/process modules: provide explicit opt-in capability-scoped modules
      rather than requiring every caller to implement their own.
- [ ] Multi-file imports: resolve source modules, bindings, cycles, errors, and
      snapshots consistently, keeping host access capability-controlled.

## Validation and release gates

The user additionally requires thorough stress testing via varied scripts, not
just acceptance examples. This is part of the goal for every item. Compare
supported language behavior with native JavaScript using deterministic,
reproducible script matrices. Exercise interactions, repeated mutations,
asynchronous scheduling, checkpoint/restore, host failures, resource exhaustion,
and sandbox escapes. An unexpected mismatch blocks that item's release until it
is understood and fixed. Keep fast regression coverage in tests and manual QA
steps in markdown; do not replace QA with a new automation script. Record the
actual cases and results, including remaining gaps, rather than claiming
perfection from a green suite.

For every item: add failing regression tests first, implement the change, run
focused tests and the SafeJS suite, typecheck/lint, and inspect CLI screenshots
when output or CLI behavior changes. Unit tests use memfs and mock external
services. Update existing documentation by removing obsolete restrictions; new
README content requires permission. Keep the complete checklist until all items
have direct evidence. No blanket staging, no skipped hooks, no local publishing.

The private SafeJS workspace ships in poe-code through the root Release workflow.
Record commit, workflow conclusion, and published version for each item here.

## Initial audit

- Runtime already implements mutable lexical captures and per-iteration scopes;
  the AS002 lint rule still prohibits them.
- Release run 32991576445 failed in an unrelated experiment-ralph ordering test.
  Recheck the release gate when shipping; do not bypass it.

## Releases

### Mutable closures — released in poe-code 4.0.58

- Removed the obsolete AS002 rule; legacy suppressions remain recognized.
- Regression coverage exercises sibling writes, loop captures, parameter defaults,
  shadowing, asynchronous branches, and checkpoint restore.
- SafeJS and agent-harness suites: 3,077 passed, 39 skipped.
- Workspace build: 67 successful tasks; root typecheck passed.
- CLI screenshot inspected: `harness run /tmp/safejs-mutable-closures.md --yes`
  completes successfully with the shared mutable count of 2.
- Updated the SafeJS skill template and ran `npm run sync-skills`.
- Commits: `486b9f1f` and `9e5cb5a5`.
- GitHub Release run `33000545959`: success. Verified npm `latest` is `4.0.58`
  and GitHub release `v4.0.58` was published on August 26, 2026.
- Pre-push full repository suite: 18,557 passed, 41 skipped. Hooks were not bypassed.
- Stress follow-up: eight script families at widths 1, 7, and 24 compare directly
  with native JavaScript. They exposed rejection of arrow reassignment; fixed
  assignment-expression parsing, including chained/logical assignments,
  destructuring defaults, conditional alternates, and yielded arrows.
- Added 14 parser regression cases and four closure checkpoint/restore scenarios.
- Expanded SafeJS and agent-harness suites: 3,119 passed, 39 skipped.
- Opt-in adversarial/parser fuzz run: 9 passed, 5 skipped. The skipped Test262
  cases remain explicit gaps, not evidence of full language conformance.

### Ordinary functions — implementation verified, release pending

- Lint visits function declarations, expressions, default exports, parameter
  defaults, and yielded expressions. Hoisting, recursion, named-expression scope,
  imported bindings, and async diagnostics have direct regression coverage.
- Removed obsolete AS012 comparator restrictions. Ordinary functions and
  numeric-coercible comparator results now work through the public API.
- Native comparisons exposed missing `arguments`. Added strict, unmapped
  invocation-local objects, lexical arrow capture, iterable/indexed access,
  mutation, host-boundary copies, and allocation/depth accounting.
- Snapshot tests preserve aliases, cycles, non-enumerable data, descriptor flags,
  property order, frozen objects, and argument bindings in restored closures.
  Corrupt snapshot metadata is rejected before restoration.
- Four deterministic script families run at widths 1, 6, and 12 against native
  strict JavaScript. Declaration/expression recursion must hit call-depth limits.
- SafeJS and agent-harness suites: 3,200 passed, 39 skipped, followed by a passing
  14-case function stress suite including two additional budget regressions.
- Opt-in adversarial/parser fuzz: 9 passed, 5 skipped. Root typecheck passed.
- Updated the skill template and ran `npm run sync-skills`.

#### Manual CLI stress verification

Create three harness pairs with frontmatter `kind`, `version: 1`, and `width`.
Use ordinary default function entry points, async for the concurrent case.
Adapt the corresponding bodies in `src/lint/function-syntax.stress.test.ts` to
read `frontmatter.width` instead of the test's local `width`:

1. Factories: width 64, 64 independent counters initially 0 through 63, each
   incremented by every round from 0 through 63. Sort descending with a named
   ordinary comparator. Assert 4,096 mutations, endpoints 2,079 and 2,016, and
   total 131,040.
2. Concurrent async calls: width 128. Each call captures its own `arguments` in
   an arrow, awaits twice, and increments `arguments[0]` by 128 without changing
   the formal parameter. Assert every row is `[index, index + 128, 1]`.
3. Delegated generators: width 1,000. Delegate sequences starting at 10 and 20,
   reading the starting value from `arguments[0]`. Assert 2,000 values and
   endpoints 10 and 1,019.

Executed these together using `npm run screenshot-poe-code -- harness run` with
the three `/tmp/safejs-functions-{factories,async,generators}.md` paths and `--yes`.
Inspected the screenshot: all three harnesses passed with results 131040, 128,
and 2000 respectively. No LLM calls or external services were needed.
