# WeakRef public integration

## Scope

The committed builtin installer lacks WeakRef. Its private weak storage,
structured-clone rejection, symbol registry and job-kept-target infrastructure
are already committed; the jobs implementation and lifecycle tests were checked
against HEAD (ee5e40). Reconcile the existing public constructor/deref factory,
builtin binding and linter entry without including FinalizationRegistry,
Temporal or snapshot wiring.

Construction validates the target before reading newTarget.prototype, selects
the constructor realm's fallback prototype, records private weak state and keeps
the target through the current guest job. Dereference validates the private
receiver and keeps a live target through that job. Job release removes those
temporary budget roots. No arbitrary-symbol strong-retention fallback is added.

## Qualification

- Node 22 public WeakRef, budgets, jobs, weak prototype realms and graph clone
  checks: 24 tests across five files pass (5711d8).
- Node 18.20.8 object-target budget and job checks: nine tests pass without
  skips (ed9905). This does not cover unsupported arbitrary weak symbol targets.
- Job-kept-target lifecycle plus execution/lint parity: eight tests pass
  (b69228), including shared targets, suspension, async-prefix ownership and
  cleanup across budgets.
- Public factory/test scoped lint passes (13f78f); final linter-file checks
  (79f9d1) and package TypeScript (049a91) pass.

The realm/replay checks exercise some still-uncommitted snapshot integration.
These are working-tree results, not proof of an independently complete committed
release. Node 18 unique-symbol targets remain a known portability limitation.
README status distinguishes local public API support from unreleased snapshot
and finalization work. No push, release or full-conformance claim.
