# Current actual SafeJS review — August 27, 2026

This opt-in investigation runs unchanged existing cases against regular-file
copies of the actual current private engine and a clean packed snapshot of
current committed `virtual-bash`. It never installs, builds, patches, creates
worktrees/symlinks or writes source/output in the private repository. No private
engine is vendored here; only harness code, hashes and observations are retained.
The old proposal remains unapproved and is not applied by this runner.

## Run explicitly

With development tooling already cached in the two repositories, choose a new
evidence directory outside the private checkout:

```sh
node tests/integration/safejs-current-20260827/run.mjs \
  /Users/kjopek/Workspace/poe-code /tmp/safejs-current-new-review
```

The private path is required, never an implicit runtime dependency. The script
captures private HEAD/status/index, metadata and every non-build/cache engine
file before/after. All git reads use `GIT_OPTIONAL_LOCKS=0`. Changed upstream
state is recorded as drift, not attributed to the reviewer or silently ignored.
The product is archived from the committed HEAD captured at invocation;
unrelated dirty product changes are recorded but excluded from this frozen build.

Only temporary regular-file copies are used for engine, fixtures and cached
development tooling. Native `tsc` builds the copied product; offline npm pack/
install creates the actual consumer package with lifecycle scripts disabled.
No package is downloaded. Missing required tooling fails the harness. Node,
TypeScript and copied tool versions/hashes are recorded. Child HOME, temp/cache
directories and npm configuration are isolated. Owned temporary trees are removed.

## Unchanged fixtures, built imports

The current committed command/bridge tests, original nine desired-behavior
cases, action-abort case, nine proposal invariants and eighteen proposal reason
cases are copied byte-for-byte. Hash comparison with `fa6c095` distinguishes
unchanged behavioral files from later proposal probes/documentation.

A loader redirects existing fixture `src/**/index.js` imports through the
installed package's public `virtual-bash` root; other existing internal helper
imports resolve only installed `dist` files. No product source is executable.
A regular-file `.d.ts` mirror of packed declarations supports the two unchanged
in-memory TypeScript fixtures' relative paths; it contains no implementation.
An additional strict consumer imports the actual public root directly.

Every loaded engine file must be inside the one selected copy and match its
frozen hash. Runtime imports outside the temporary root, alternate engine paths
and product-source fallback are rejected. Deliberate private/product-source
negative controls prove these guards. The guard supplies unchanged copied
TypeScript CommonJS bytes directly to avoid the observed Node22/tsx mixed-hook
null-source failure; this affects cached test tooling only, not engine/product.

## Classification, not a green aggregate

`report.json`, per-cohort cases/logs and import traces preserve every outcome.
Conventional tests are classified by the unchanged no-engine cohort and explicit
known-defect labels: actual guest behavior, fixture/configuration, structural
typing, or defect characterization. A characterization passing means the defect
is present; a stale characterization failing may mean upstream fixed it. Both
remain visible beside the unchanged positive desired cases.

The no-engine run retains all explicit skips. **62 skipped tests are not actual
engine acceptance.** Proposal reason-envelope/invariant assertions are measured
separately; running them neither approves their contract nor imports the proposal.
The paired strict type review retains all baseline engine diagnostics and reports
new diagnostics from the public adapter assignment separately. Whole-package
upstream typechecking uses the original copied configuration and reports missing
workspace declarations rather than creating stubs or claiming a clean build.

Exit0 means the bounded investigation and evidence capture finished; inspect
each cohort status and `behavioralAcceptance:false`. It does not mean all tests
passed, the proposal is approved, replay is durable, or the product goal is met.
The final review and minimal next-author blockers are recorded in
`docs/integration/2026-08-27-SAFEJS_CURRENT_REVIEW.md`.
