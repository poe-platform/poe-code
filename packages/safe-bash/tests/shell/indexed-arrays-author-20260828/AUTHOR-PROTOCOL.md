# Bounded author test protocol

Sealed 2026-08-28 before production edits or product/author execution. Expected
cases are authored from the current root profile, not hidden executor vectors.
Each attempt retains inputs, actual outcomes, process status and failure details;
no timeout increase or expectation correction is silent or retroactive.

## Isolation and execution bounds

1. Authenticate the selected DOTGLOB receipt and reconstruct its exact 265 build
   inputs. Overlay only committed owned source/modules and owned author tests.
   Never copy all HEAD, the repository, AGENTS, blocked probes, or live product
   fallbacks. Existing unchanged modules may be build inputs, not held executions.
2. Use unique author-owned attempt directories. Before/after source/package
   snapshots include new entries, not just modifications of original files.
   Any development node_modules link is explicit and outside the append-proof
   source guarantee. Never install runtime or development dependencies.
3. Bound metadata child processes to10s each and the authentication operation to60s.
   Build/typecheck/package phases each have120s, focused runtime cohorts60s each,
   per-case public execution5s, abort/backpressure cases2s. Public cap workloads
   get a separately labeled60s cohort, not an unbounded resource experiment.
   At most one product cohort runs at a time; no watcher, SIGSTOP, native guest
   execution, detached child, timeout relaunch or competing full suite.
4. Track launched children synchronously; on deadline terminate and await close,
   with bounded escalation and explicit signal/result evidence. A timeout is a
   failure, not a pass. Release owned test resources and settle all processes.
5. Inspect every existing regression's transitive helpers for child_process/native
   execution before admitting it. Excluded native fixtures are not claimed as
   passes. Scope regression choices to changed shell behavior, no foreign fixes.

## Author semantic cohorts

- Grammar and quote contexts; assignment-only element/compound/append forms;
  syntax refusal across the whole admitted unit, including inactive branches;
  ordinary quoted argv; no script-file/shebang preflight relaxation.
- Sparse maximum, canonical zero/max indices, zero-field RHS, literal domain
  errors, static certain later overflow before all RHS, uncertain overflow after
  that RHS once, explicit cursor resets, cached maximum deletion.
- Distinct absence/scalar-unset/scalar-empty/indexed-empty/missing-zero/empty-zero;
  staged reads see live old target; exact RHS side effects, no rollback/retry;
  readonly, same-value/ABA/stale and caller-versus-escaping priority.
- Every actually supported bare scalar operator through zero, including lazy
  inactive alternates, assignment/removal/replacement/length behavior; explicit
  indexed operators refused; unsupported scalar forms not newly enabled.
- Repeated quoted/unquoted @/* aggregates splice, never Cartesian; sparse numeric
  order, prefix/suffix, zero-member fragments, empty/Unicode IFS and empty fields.
- Exact13 controls; exported conversion and export/prefix failure phases; typed
  local save-once/absence/readonly restoration; selected-only listing refusal;
  read/getopts/for preserve already-consumed effects and earlier writes.
- Source/substitution/subshell/pipeline/function/invoke, shared/cloned/fresh exec
  boundaries, whole-state snapshots including dotglob and STACK Symbol ownership.
  Typed middleware/env transactions and scalar A/B/write-B restoration unchanged.
- Indexed arithmetic bracket and bare access refuse without scalar LET regression.

## Mechanical and package cohorts

- Test real public caps separately from lowered private unit profiles. Exercise
  feasible default B/F boundaries with bounded workloads; label unmeasured real
  boundaries explicitly. No synthetic profile certifies public capacity.
- Loaded private tests cover all seven formulas, exact refusal ordering, shared
  tentative ticket cursor near MAX_SAFE, failed atomic reservation, no cumulative
  refund/reset, precomputed deletion, last-observer retirement and unset ABA.
- Instrument actual owned helpers for dependencies, cleanup credits, overlapping
  close single-flight, restoration before temporary publication, snapshots and
  peak ownership. Synthetic reference graph counts remain unit data, not claimed
  counts of the whole runtime. Audit every actual state writer/clone path.
- Actual source, installed and physically moved strict public consumers execute
  Shell workflows. Package root exports stay unchanged; import guards and loaded
  hashes exclude source fallback and out-of-package runtime resolution. Verify
  package inventory, package SHA256, selected source/blob/tree identities and zero
  runtime dependencies. Source build/typecheck success is not runtime acceptance.
- Exercise binary VFS pipelines, awaited backpressure, cancellation, and producer
  buffer reuse where new array-owned byte IO actually exists. Existing input
  Budget storage E and opaque host retention are explicitly outside private caps.
- Load and run transformed product mutants under bound consumers: static planning,
  RHS-once/final stale guard, zero-view laziness, repeated splice, snapshot epoch,
  atomic shared ticket admission, cumulative nonrefund and observer retirement.
  Each control must demonstrate consumer rejection/failure after actual mutant
  execution, not preload rejection. Preserve undetected/invalid mutants honestly.

## Handoff

Commit docs before source. Commit coherent source/tests atomically with explicit
owned paths; provide the exact source candidate promptly to root/Plato. Commit
evidence separately. Final candidate receipt records counts by cohort/layout,
all attempts/failures/limitations, capsule and package identities, process
settlement and scoped status. Independent execution is a separate root task.
