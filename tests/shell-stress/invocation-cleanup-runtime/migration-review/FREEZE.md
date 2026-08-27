# Independent bounded cleanup migration controls

This is the different verifier, not the author. Ownership is only this NEW
subtree and the three explicitly requested `/tmp/cleanup-migration-independent-*`
markers. No live product, canonical fixture, author harness, historical artifact,
root configuration, dependency, or other worker path may be changed.

## Candidate and cohorts

- Freeze the initial observed candidate `4bb4ad85d4554889cd6f59097af776f4172e34d1`
  (tree `138d4d7fc33d2b716b1c5758f82692dece4bb082`), not a later incidental HEAD.
- Authenticate every captured input from that Git object and independently check
  working-tree equality. Source tree, input hashes, tools, Node executable,
  initial status and semantic comparison are recorded before any execution.
- Author `026e20cf` / evidence `9167913d`, original `85e6d560` fixture,
  original `4c16d9c5` runtime, and original ten before-hook failures remain separate.
- Candidate product source, canonical fixture, probe and helper are unchanged
  from author026e20cf. Later package/type-configuration changes are captured,
  not silently treated as the author's already-qualified candidate.

## Controls frozen before execution

1. Run the ACTUAL canonical ten with an independently Git-derived explicit
   expectation in a fresh isolated source/tools copy and fresh nested build.
   Require ten passes, zero fail/cancel/skip/TODO and ten natural child exits.
2. Independently inspect every child report: actual public dist imports and
   worker module hashes match its emitted manifest; source/module hashes remain
   stable before/after; zero live workers and unhandled rejections. Preserve all
   original status/byte/reason-identity/awaited-retirement assertions unchanged.
   Check event ordering, including the held sibling input producer spanning the
   other invocation's rejection/disposal boundary and subsequent resumed work.
3. Canonical invalid-expectation controls: JSON null, JSON false, wrong committed
   input hash, omitted input, mismatched revision. Each must reject all ten in
   setup without emitting a successful source manifest, not accidentally run zero.
4. Independently create another fresh real build. Source, emitted shell module,
   copied probe, and valid-JSON manifest tampering must each fail verification;
   restoring EXACT original bytes must restore verification, never rebaseline.
   For emitted-module and emitted-hash-manifest tampering additionally launch
   the unchanged probe on existing benign grep:normal and require actual loader
   identity rejection (not syntax failure or timeout).
5. In an OWN isolated source copy only, apply the original one-expression mutant:
   `if (!this.exited) await this.worker.terminate();` becomes
   `if (!this.exited) void this.worker.terminate();`.
   Reject it against the frozen expectation. Then run the unchanged canonical
   ten with an explicitly labeled working-copy mutant manifest and fresh build.
   Require genuine original normal grep AND rg retirement assertion failures,
   with sourcePinned true, natural exit1, and no stale-hash rejection. Do not
   change expected output or probe/assertion code. Other mutant outcomes remain
   recorded, never reclassified as acceptance.
6. Authenticate the original fixture/probe from Git, all six old source pins,
   historical data and ten failed rows against the original compressed full-gate
   capture. Hash all existing author evidence before/after; do not replay or write
   it. Historical replay passes do not count as current acceptance.

## Bounds and disposition

Only the existing benign `^a`, `^b`, `ab\n` x200, `bb\n` and head-pipe cases.
No extra pathological regex, native oracle, server, download, or other audit.
Strict unhandled rejections; canonical original 60s build / 15s test / 10s probe
watchdogs remain unchanged; outer subprocess budget 180s. Subprocesses are
synchronous and recorded by PID; no process groups or broad process killing.
Only own isolated scratch trees are removed, after all child waits return.
Retain raw failed attempts and every cohort separately. A blocker stops scoped
acceptance and is immediately published in the findings marker. No root approval
for product or author-harness edits is assumed. Success ends this bounded review,
not a whole-gate, broad parity or superiority acceptance.
