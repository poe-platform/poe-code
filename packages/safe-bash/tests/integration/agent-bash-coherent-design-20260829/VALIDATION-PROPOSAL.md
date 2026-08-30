# Maintained regression placement and future validation

## What was actually inspected

The **selected Node-base package.json**, blob
`623d2493b94afa7752d87232c8eb62fb61a2370f`, defines `npm test` by globbing
`tests/**/*.test.ts`, then launching Node's test runner with the entire result.
Its one specific historical exclusion does not make that discovery curated.
Appending one file to `npm test` does **not** prevent the initial broad glob.
Do not run that script for this scoped composition: it can discover unrelated
XAN/YQ/native/fullgate/review tests in a larger checkout.

Likewise, selected `build` uses the build config, while `typecheck:all` has broad
current-consumer routing. Neither should be treated as a narrow smoke selector.
The shipping package input is authenticated here; current worktree scripts and
their entire test closure were not certified by that fact.

No specific existing normal test file has been independently checked as a safe
home in this design. Existing explicitly invoked public-node.mjs and module
focused-v5/worker-v5 scripts are useful authenticated recipe inputs, but remain
versioned evidence, not a substitute for maintained regressions. A separate live
metadata scan hit its bound; no larger scan or test discovery was attempted.

## Recommended maintained split (future edits only)

**Basic maintained test:** propose `tests/integration/agent-bash-smoke.test.ts`
using normal node:test/assert, public API, MemoryFileSystem, controlled VFS and
an inert recording provider stub. Eight small families:

1. Exact explicit default-name set/80, optional Node registration and replacement.
2. Supported strict option state, positional preservation and ordinary flags.
3. Lazy conditional quote/pattern semantics and reached unsupported diagnostics.
4. Ordinary pipes plus ordered `|&`/`&>` effects and writer ownership.
5. Nounset fails before provider preparation; no guest/Worker implied.
6. Scalar arrays/functions/source/LET interaction without aggregate-u recovery.
7. Raw diagnostic-sink reason and registered cleanup precedence with independent
   controlled release; no opaque-provider cleanup guarantee.
8. Read-only VFS and mocked transport authorization/effects, no real network.

Use a **literal explicit path invocation**, not a glob:

```text
<authenticated-node> --import <authenticated-tsx> --test --test-reporter=tap tests/integration/agent-bash-smoke.test.ts
```

Resolve the runner's own tool/import closure before execution. This is a proposed
command shape, not an executed command or permission request. A future dedicated
`test:agent-bash` package script may wrap exactly this list, with no forwarding to
the broad default test script. Package changes require separate authorization.
The ordinary `.test.ts` file can also serve normal canonical discovery later;
the narrow command never discovers other tests. Keep engine work out of it.

**Explicit PUBLIC-engine integration:** propose a separately selected
`tests/integration/agent-bash-public-engine/run.mjs`, outside `.test.ts` automatic
discovery. Bind the existing PUBLIC static adapter and engine hashes before any
Worker. Missing/unbound engine is an explicit failed prerequisite or unexecuted
qualification, not a successful empty suite. Reuse accepted Node scripts' engine
staging, not native Node evaluation, private source reads or optional host loads.
Strict consumer templates should be `.ts.fixture` staged byte-identically into
an explicitly classified current consumer group, not loose historical `.ts`.

**Concrete next placement step:** read a short, root-approved explicit list of
normal shell/plugin/integration test files and their helpers to decide whether
one is a better home than the new smoke file. Do not repeat the capped broad
live-src scan. Freeze that maintained selector's complete input closure and
negative "unrelated test not discovered" control before authoring/execution.

## Future combined validation, requiring a new ROOT grant

1. Accept Unit4 or select its reviewed successor. Recompute this exact source
   inventory/tree if any byte changes; do not use HEAD or absent derived objects
   as authority. Bind docs changes separately if requested.
2. Preseal tools, compiler/installer closure, engine emitted closure, fixtures,
   exact argv/env, scratch ownership, capture/output limits and expected IDs.
   Tool metadata is not dynamic descendant attestation. Current design grants
   no Worker or product runtime permission.
3. Fresh compact selected materialization, no instruction-file snapshots and no
   stale dist. One production build, full emitted manifest, full package with
   README and metadata, offline install with scripts disabled, physical move.
   Authenticate every installed/moved member, not just runtime projection.
4. Source-built, installed and physically moved layouts run the same 18 new
   workflows. Reuse 61 module +24 public Node rows under their exact accepted
   recipe; retain unsupported/refusal classifications. Propose retained core
   subsets 48 redirection +67 conditional +35 resolved Unit4 rows, avoiding a
   gratuitous rerun of every archived author/reviewer cohort.
5. That proposed selection is 253 identities/layout, 759 total (18+61+24+48+67+35
   times three). This is arithmetic for a **future selection**, not admission,
   execution, pass count or an assertion that every fixture version is ready.
   Confirm the exact 67/35 version maps and exclusion reasons in the executable
   preseal before any run. No native GNU case is credited by these rows.
6. Six type groups: positive and negative in each layout; target 12 negative
   categories (provider required; unknown grants; invalid replace; private
   imports; bad AST discriminant; unsupported engine shape, with finite variants).
   Exact diagnostics/counts require executable preseal, not this proposal.
7. Four loaded mutation/restoration roles: conditional lazy evaluation,
   read-sensitive arithmetic, optional Node registration, and an existing accepted
   Node host-boundary mutation. Four binding refusal classes: missing module,
   changed bytes, private export and stale-base runtime substitution. Mutant
   source sites/probes must be frozen before GO; no production edits here.
8. Observe resource counts and cleanup separately: known OS children, loader
   admissions, Node/regex Workers, guest entries, active operations and registered
   cleanup. Absence of a close event alone is not proof of a live leak; disposal
   alone is not opaque-provider finalization. Preserve failures and unknowns.

Proposed ceiling for ROOT to consider: **60 minutes total**, 112 known owned OS
processes peak4, 256MiB capture/1GiB scratch, case30s/build120s, 40 fixed internal
loader admissions, 192 explicitly authorized Node Workers and at most8 qualified
RegexWorkers for retained regressions only. These are proposed ceilings, not
measured census or permission. Count the exact accepted recipe's demand first;
if it cannot fit, request a smaller selection or explicit revised bound before
launch rather than silently increasing limits. Safety/capture/integrity/unknown
retirement/cap failures stop; ordinary assertions aggregate only after safe cleanup.

No live network/private engine/native oracle/wholegate or XAN/P2 execution enters
this plan. A selected snapshot's success cannot establish current HEAD's default
`npm test`/`typecheck:all` is green. Report source, package, tool and fixture
identities and limitations separately, with different independent review before
ROOT composition acceptance.
