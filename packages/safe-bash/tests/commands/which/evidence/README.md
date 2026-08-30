# WHICH author v2 evidence

Candidate implementation commit:
`0902f3c541c8e9a79771f55cb5c9b78c6b6eb09b`.
This is implementation-author evidence, not Poincare's independent acceptance.

## Binding

- Independent freeze `c5cf2abb49cf7fc0e7ac990ea913617a501cf3ba`, parent
  `5687fe0afe36749a9ec6527357acbb2eec518e4f`, retains 28 public families.
- `FREEZE-v1.json` is the manifest with SHA-256
  `2a67769edf82220bd576ccb8830fa19c2e0509937db702d0a23d054d3447b392`.
  `FREEZE-v1.md` is the separate public summary, SHA-256
  `e0fa4f057eb59fbb3ea97cd84069d6dd36b6834531a92e4f44f471c9e39cbc1b`.
- Authorization combines `5c34372be6aedd179123ceab2663c7d52f207ed1` and
  `c82a7fc9eac4aecd764ffb91d0b7f91f0e452dbd`. The policy documents and retained
  primary-source data are unchanged. All 30 named manifest inputs matched at
  freeze/candidate/live: 90 hash comparisons, not fixture execution.
- Hidden case/assertion contents were not read. `SEAL-v2.json` records exact
  policy, implementation, tests, transitive source, package/config and build-tool
  input hashes. All 43 successful snapshot inputs match the committed candidate.

## Checks

- `node --import tsx --test tests/commands/which/*.test.ts`: 32 author tests,
  32 passed, no failures/skips/TODOs. The first runtime run also passed 32/32;
  the final captured run is `author-focused-final.json`.
- `node tests/commands/which/verify-isolated.mjs --capture`: scoped source/test
  strict typing, isolated source/declaration build, moved strict direct-module
  type consumer, and four moved runtime tests all pass in `isolated-success.json`.
- Actual tools: Node `v22.22.2`, TypeScript `5.9.3`, Darwin arm64. The success
  receipt binds 128 compiled output files, 178 consumer type-closure entries and
  the exact generated configurations. The seal adds hashes for 166 compiler
  library/Node type input files. These counts are inventories, not test counts.
- The moved runtime has no source directory or source fallback. Its load guard
  verifies allowlisted compiled JS and the copied driver against captured hashes.
  Direct readonly lookup, Shell byte piping, backpressure/owned chunks and exact
  cancellation/sink failures are exercised. This is an internal-module import,
  not root/package-subpath availability or default command registration.

## Preserved failures

`original-preparation-and-resolution.json` preserves the earlier author stop
caused by attributing the user's manifest digest to the Markdown summary. The
separate provenance receipt resolved the original authorization, without a new
hash or changed policy. Original `/tmp` receipts were not overwritten.

`isolated-initial-author-getter-failure.json` retains four owned test-getter
typing errors: throwing accessors inferred `void`; explicit `never` return
annotations corrected them. Product implementation was unchanged.

`isolated-initial-darwin-path-guard-failure.json` retains the first guarded
runtime failure: Node canonicalized Darwin `/var` to `/private/var`. Canonicalizing
the unique scratch root corrected the guard without weakening the allowlist.
Its prior typing/build/type-consumer phases had passed; its runtime did not.

`snapshot-deltas-and-generated-inputs.json` preserves differing historical
snapshot source/harness bytes and generated configs against the committed
candidate before temporary-directory cleanup. The later provider-budget test
strengthening is retained as a test-input change, not called identical earlier
test coverage. No product source correction was needed after the first run.

## Limits

No whole-project test/typecheck/build gate was run, and no foreign failure was
fixed or waived. No native which binary, deployed provider, independent frozen
cohort or public/default integration is certified. FreeBSD source provenance
does not qualify a native runtime. Logical budgets do not measure RSS, access is
not an execution/identity lease, and opaque work is not forcibly preempted.
Snapshot postchecks cover enumerated original files, not newly appended entries.
All temporary work is author-owned; `cleanup.json` records its final disposition.
