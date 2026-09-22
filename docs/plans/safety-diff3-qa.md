# safety-diff3 resource and failure QA

Verify the current dirty candidate without committing unrelated work or publishing
the private command workspace. The requested package-pattern document has moved
to `archive/safe-bash-command-package-pattern.md`; preserve that pending move.

1. Inspect the private manifest, first-party source closure, public facade and
   packaging declarations. Require ESM, empty runtime dependencies, opt-in
   registration and canonical contracts. Check for host executables, ambient
   files/credentials, network and dynamic/native fallback paths.
2. Run the maintained command unit/lint routes and actual memory-VFS Shell
   boundary tests. Exercise pipelines, redirect status, VFS scripts, CLI/SDK,
   symlink aliases, denied capabilities, directory rejection, producer reuse,
   fragment/work quotas, cleanup failures, partial sink output and cancellation
   during metadata admission, input, comparison and owned output. Dispose actual
   Shell invocations while cooperative input is pending; require cleanup before
   settlement. Preserve deterministic corpus seed 1 and existing GNU fixtures.
3. Build the maintained selected safe-bash workspace closure without cache.
   Run the maintained safe-bash typecheck/unit routes covering the new tests and
   private bundling tests. No shared runtime/build changes are planned; broad
   repository gates are required if such changes become necessary.
4. Stage public safe artifacts, pack/install outside the checkout with lifecycle
   scripts disabled, run the maintained diff3 runtime and strict NodeNext types
   fixtures, and confirm the private command package is absent. Record the exact
   source digest and public tarball digest; earlier receipts do not qualify this
   candidate. Node-hosted VM realm controls are not browser/workerd qualification.
5. Manually execute installed report, merge and ed commands in a memory VFS and
   inspect a terminal screenshot. Verify report status 0, flagged merge status 1,
   reverse ed script status 0 and no source mutation from `-i`. Inspect the emitted
   script rather than executing it with a host executable.
6. Record passes, failures, skips and unavailable runtime cells separately. Diff3
   has no checkpoint/restore API; repeat fresh invocations and existing engine
   replay controls without claiming shell checkpoint support. Conditional or
   exclusive file publication is not a diff3 API: Shell redirects are destructive
   streaming with same-file hazards, not atomic guarantees. Do not infer rollback
   from pre-render quota admission. Purge task-owned temporary artifacts.

Use `/out` for temporary output if available. On this host it is absent; use the
repository's ignored `out/safety-diff3` fallback if root creation is unavailable.

## Verification receipt, 2026-09-19

Candidate base is `35d01c57f8078d8afa916dc59929395d857e9c55` with the supplied
uncommitted implementation/integration changes preserved. No implementation
defect was reproduced by the added resource/failure controls; runtime code,
manifests and shared packaging infrastructure were not changed. Added five
command controls and five actual Shell controls, plus the README's explicit
partial-output/same-file redirect contract. Command code remains in its private
owner; safe-bash's facade only re-exports it.

SHA256 of sorted command `src/*.ts` contents, each preceded by its filename:
`5083f5731127cad1989d20b7fa5e6813c2a49d3e7ef1b6eff24bcf2adb44e44d`.
Public safe-bash tarball `0.0.0-safety-diff3` SHA256:
`6715bcafcf6b9f7b0a1a2c1b1c9e29f00bcede66a5f91310f7cfdf2bb46a4c66`.
These bind a dirty candidate, not a committed or released revision.

### Passed

- Fresh command unit route (`TSX_DISABLE_CACHE=1 npm test
  --workspace=safe-bash-command-diff3`): 328 passed, zero failures/skips. This
  reruns the retained exact GNU 3.12 controls and the 99/100/101 horizon variants;
  no new native capture or universal GNU parity claim is made.
- Command maintained lint and source/test typecheck passed. ESLint for the new
  Shell file passed. Focused actual Shell route: five passed, zero failures/skips.
- Uncached maintained selected build closure (`npm run build:workspaces --
  --workspace=@poe-platform/safe-bash --no-cache`) passed, including native npm
  build/postbuild events. Seventeen build tasks were selected from declarations;
  manifestless workspaces were reported separately by the planner.
- Maintained Vitest packaging routes (`bundle-safe-bash-private`, `package-safe`,
  `safe-command-publication`): 164 passed across three files, zero failures/skips.
- Three public artifacts were staged, packed and offline-installed outside the
  checkout with lifecycles disabled. Installed diff3 runtime and strict NodeNext
  declarations passed with exact optional properties, unchecked indexed access
  and no skipLibCheck. No private command/contracts workspace was installed.
- Installed runtime fixture passed with Node filesystem permission confined to
  the consumer and no child-process/native-addon permission. Missing host paths,
  URLs and external executable selection are negative controls, not authority.
  Shell tests mock denied fetch and observe zero calls. AST inspection of 1,264
  packed JS/declaration files found no static bare private command/contracts
  imports. The independently bundled packed command closure has 54 files and
  zero external imports. VM SDK execution and repeat invocation passed with
  throwing accessors denying process, fetch, require, WASM and context.env reads;
  zero denied access attempts occurred. Host JavaScript itself is not sandboxed.
- Manual Markdown QA executed installed report/merge/ed modes with statuses
  0/1/0, unchanged source after `-i`, dot doubling and repair substitution. The
  generated terminal screenshot was inspected: readable report indentation,
  conflict-marker boundaries and script layout. Screenshot generation uses the
  maintained general command route because this is the opt-in Shell API.
- Source ownership controls cover reused producer storage and shadowed length;
  quota controls cover infinite empty chunks and fragment exhaustion. Cancellation
  during SDK metadata admission and input preserves falsey reasons. Existing
  comparison checkpoint and owned-output cancellation controls pass. Actual Shell
  cancellation/disposal drains a pending cooperative input and returns it once.
  Read-plus-close failure preserves both errors; sink failure preserves identity
  and a published prefix. Cleanup is idempotent and fresh invocation recovers
  after quota failure without reusing failed state.

### Failed gates

- `npm run typecheck --workspace=@poe-platform/safe-bash` exits 2 before compilation:
  `qualified-current-release/peer.mjs:245` requires the retired root
  `./safe-fs` import `./packages/safe-js/dist/safe-fs.js`; the candidate root export
  is absent. Reproduced the current assertion and metadata mismatch. No guard or
  unrelated manifest was modified to manufacture qualification.
- The separate maintained `historical-type-models.mjs --noEmit` compiler phase
  exits 1 with 730 diagnostics across 143 files. Reviewed diagnostics: retired
  `poe-code/safe-*` imports and their dependent typing failures; strict optional/
  unknown/undefined checks; outdated FS stat and Playwright capability fixtures;
  SafeJS snapshot optional-field mismatches. Neither new diff3 test file has a
  diagnostic. This is a failed source/test gate, not a substitute typecheck pass.
- The full maintained safe-bash unit route reports a failure in
  `tests/integration/s3-http-exports/exports.test.ts:13`, `private checkout refuses
  qualification through retired public exports`. Independently reproduced with
  the named test: one failure, zero passes. The verifier returns `Peer binding
  requires the selected committed package metadata`, whereas the test expects
  the later retired-SafeFS identity rejection. Working package metadata differs
  from HEAD; the committed verifier refuses that candidate before runtime work.
  Kept both guards and the unrelated metadata edits intact. Expected deliberate
  failure output from archive hostile-input controls is not counted as extra
  failing tests. The full maintained `npm test
  --workspace=@poe-platform/safe-bash` settled with exit 1: 42,719 tests,
  41,889 passed, one failed, 829 skipped, zero cancellations/todos, across the
  declared 1,254 active files. Duration was 1,242,897 ms; no timeout occurred.
  The sole failure is the reproduced qualification assertion above. Skips and
  unavailable optional comparator cells do not establish compatibility passes.

### Unsupported or unverified

GNU costly-search shortcut cases fail explicitly with `ALIGNMENT`; universal
tie parity remains unqualified. Actual browser/workerd engines and Bun were not
run. Node-hosted VM graph evidence does not qualify them. Diff3 has no checkpoint
API or conditional/exclusive/atomic destination publication API; it emits byte
sinks. Actual shell checkpoint/replay qualification remains unavailable through
the failed public peer binding. Pure-engine replay and repeated fresh SDK/Shell
invocations are verified separately. No performance measurements are claimed.

Shell redirects retain truncation semantics, including symlink aliases; a failed
quota run can leave an already-truncated destination. A sink can publish a prefix
before failure. The documented requirement to use a separate destination is not
an atomic guarantee. No temporary VFS storage, recursive delete, host executable,
implicit network, runtime dependency download or native/WASM fallback was added.

No root `npm test`, repository-wide lint or root suffix build is claimed for this
test/documentation-only change. The full maintained safe-bash unit route failed
as recorded above; focused passes do not replace it. All initiated routes settled;
overall qualification remains incomplete for the failed gates and unverified
runtime cells.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No private publication was requested or performed. `/out` creation failed
because the root filesystem is read-only; task evidence uses the ignored
repository fallback and an isolated temporary installed consumer, purged after
receipt capture. Task-owned staging, tarballs, logs, screenshot and the installed
consumer were purged after the receipt was recorded.
