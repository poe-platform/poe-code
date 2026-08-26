# SafeJS language completeness

Objective: resolve every item in the SafeJS README's “Gotchas” and “What's
intentionally limited” sections. Ship each item as a separate conventional commit
on main and verify its GitHub release before shipping the next item. Do not claim
language completeness from passing existing tests alone.

## Delivery checklist

- [ ] Mutable closures: accept shared mutable lexical captures in lint, verify
  read/write, shadowing, default parameters, per-iteration bindings, async branches,
  and snapshot/restore behavior.
- [ ] Function syntax: lint declarations and expressions, including default
  exports, with the same semantics and diagnostics as runtime.
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

### Mutable closures — implementation verified, release pending

- Removed the obsolete AS002 rule; legacy suppressions remain recognized.
- Regression coverage exercises sibling writes, loop captures, parameter defaults,
  shadowing, asynchronous branches, and checkpoint restore.
- SafeJS and agent-harness suites: 3,077 passed, 39 skipped.
- Workspace build: 67 successful tasks; root typecheck passed.
- CLI screenshot inspected: `harness run /tmp/safejs-mutable-closures.md --yes`
  completes successfully with the shared mutable count of 2.
- Updated the SafeJS skill template and ran `npm run sync-skills`.
- Initial implementation commit: `486b9f1f` (not yet released).
- Stress follow-up: eight script families at widths 1, 7, and 24 compare directly
  with native JavaScript. They exposed rejection of arrow reassignment; fixed
  assignment-expression parsing, including chained/logical assignments,
  destructuring defaults, conditional alternates, and yielded arrows.
- Added 14 parser regression cases and four closure checkpoint/restore scenarios.
- Expanded SafeJS and agent-harness suites: 3,119 passed, 39 skipped.
- Opt-in adversarial/parser fuzz run: 9 passed, 5 skipped. The skipped Test262
  cases remain explicit gaps, not evidence of full language conformance.
