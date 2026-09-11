---
title: ArrayBuffer shared-storage foundation
---

# ArrayBuffer foundation for typed-array completeness

Typed-array subarray species requires passing the original buffer, offset and
length to a guest constructor. SafeJS currently hides the buffer and lacks the
ArrayBuffer global and Float32Array buffer overload. Add native-oracle tests
before implementing these requirements.

The foundation must preserve buffer identity between aliased views; copies must
have independent storage. Guest buffer properties, byte-length access, coercion
order, constructor branding and allocation budgets need coverage. Host import,
export, data measurement and all snapshot formats must preserve buffer/view
sharing and reject malformed references without losing backing bytes. Do not
expose host prototype methods through ordinary guest property lookup.

Treat fixed buffers as the initial dependency milestone, not complete ArrayBuffer
support: resize, transfer, detachment and additional typed-array types remain
explicit follow-up requirements. Species construction remains open until both
slice and subarray invoke the selected guest constructor with native arguments.

Validation now confirms five native-oracle failures and three additional
host-copy/snapshot failures (eight total), with no implementation changes yet.
Logs: `/tmp/poe-safejs-array-buffer-red.log` and
`/tmp/poe-safejs-array-buffer-expanded-red.log`.

The snapshot case importantly checks mutation as well as buffer identity:
currently both missing buffers compare equal as undefined, while constructing
the supposed view produces empty storage and fails to update the original array.

Implementation touchpoints identified:

- `interp/values.ts`: value union, retained-byte measurement, import/export and
  produced-value allocation. Existing Float32 copies use a shared backing-buffer
  map; exposed buffers must participate in that same map in either visit order.
- `interp/object-model.ts` and `interp/globals.ts`: guest prototype dispatch and
  intrinsic registration without host-prototype exposure.
- `interp/globals/float32array.ts`: branded buffer getter and buffer overload.
- `snapshot/float32array.ts`, serialize/restore/validation, replay-data and
  dump-format: represent buffers explicitly while retaining legacy Float32
  snapshots whose byte payload is owned by their first view. References must
  resolve to both old view-owned storage and new explicit buffer storage.

Latest delivered bound-coercion commit: ee01937afbf94bfd8d3f0f042c3f31f316f0a2b2.
Monitor CLI run 34088758131 and scoped run 34088757925 while continuing here.

Implementation is now in progress, uncommitted:

- Added native fixed-buffer representation with guest prototype dispatch,
  constructor, byteLength accessor, and Float32 buffer getter/constructor overload.
- Host data copy in values.ts shares one backing-buffer map with Float32 copies,
  preserving aliases in either traversal order.
- Seven of the initial eight tests pass. The snapshot test still fails because
  the new buffer node has no serializer yet; do not treat the implementation as
  qualified or ready to push.
- Added a ninth test proving that non-enumerable buffer metadata held only by a
  view was undercounted. Its failing run is recorded in
  `/tmp/poe-safejs-array-buffer-retention-red.log`; memory traversal now visits
  the backing buffer and includes its non-enumerable properties.
- TypeScript passed before the latest measurement change. Remaining work includes
  snapshots/replay/dump formats, host-bridge and host-call hashing, constructor
  options/coercion ordering, metadata/prototype copy policy, full regressions,
  build and actual harness qualification. Resizable buffers are not implemented.
- Previous scoped release confirmed: SafeJS 0.1.314, published by run 34088757925
  at 06:01:28 UTC. CLI run 34088758131 remains separate.

Snapshot and transport progress:

- Primary snapshots, replay data and diagnostic dumps now encode explicit buffer
  nodes and link views to them. Legacy view-owned byte records remain decodable.
  Primary buffer nodes preserve guest property descriptors and prototype links.
- New storage validation rejects missing/ambiguous payloads and invalid bytes.
  Two traversal-order snapshot cases and malformed-record cases pass.
- A replay cycle test initially reconstructed a second view when buffer metadata
  pointed back to the view being restored. Deferring buffer-property initialization
  until after allocation fixes identity without weakening the assertion.
  Red log: `/tmp/poe-safejs-array-buffer-replay-cycle-red.log`.
- Focused buffer and existing Float32 prototype-snapshot tests: 31 passed.
- Broader snapshot/Float32 regression run: 1,195 passed, two tests needed fixture
  updates for the explicit buffer node and newly exposed globals. After updating
  those expectations, all 27 maintained Float32 tests pass, including the sparse
  backing-byte rejection assertion unchanged.
- New host-binding and host-result import tests initially failed; host export was
  already passing. Added host bridge buffer import using the same backing map;
  all three now pass. Host buffer symbol properties currently reject explicitly
  because capability paths only represent strings; symbol capability identity
  needs a proper representation rather than conflating symbol descriptions.
- TypeScript and scoped lint passed before the latest host-bridge addition;
  final TypeScript is rerunning. Full unit, budget, constructor-order/options,
  host-call hashing, metadata copy and actual harness qualification remain.

No part of this buffer improvement has been committed or pushed yet.

Host identity and metadata follow-up:

- Different ArrayBuffer byte contents initially produced the same host-call
  digest. The new digest path includes bytes and data properties; the regression
  now passes (`/tmp/poe-safejs-array-buffer-hash-red.log` records the failure).
  Symbol metadata is explicitly rejected at this identity boundary pending a
  symbol-aware capability representation, not silently ignored.
- Importing/exporting only a view originally dropped backing-buffer properties,
  including an owner reference back to that view. Two new tests reproduced the
  loss. All three copy paths now visit the shared buffer after registering the
  copied view, preserving metadata and cyclic identity.
- Focused buffer/host/maintained Float32 tests: 42 passed. TypeScript passed.
- Full SafeJS suite is now running, excluding only the unresolved Promise import
  policy and the separately tracked unfinished species test file. Log:
  `/tmp/poe-safejs-array-buffer-package.log`. Do not start a concurrent build.

The first full run has now completed: 17,812 passed, 41 skipped, two legacy
checkpoint comparison failures, 280.94 seconds. Both failures were the exact
global-key comparison missing the newly added ArrayBuffer intrinsic. Added it
to the two tests' explicit expected intrinsic additions without changing the
genuine EA captures or graph comparator; focused checks are running.

Read-only native probes also confirmed that the options maxByteLength getter is
currently skipped even when it returns undefined (fixed-buffer case). Two new
option tests reproduce missing getter effects/throws; a third offset/length
coercion-order control already passes. Log:
`/tmp/poe-safejs-array-buffer-options-red.log`. These two failures still need
implementation work; resizable buffer support remains an explicit gap.

The harness pair is prepared but has not been run. A failing linter test confirmed
ArrayBuffer was missing from known runtime globals (AS003); it is now registered,
and that focused linter test passes. No lint suppression was added.

Prior CLI delivery is confirmed: run 34088758131 published poe-code@14.0.83 to
latest at 06:14:20 UTC. This includes ee01937af's bounds coercion, not the local
unfinished ArrayBuffer work.

Constructor capacity implementation:

- Expanded native option suite initially had six failures and one passing order
  control. Constructor now reads maxByteLength after length coercion, invokes
  guest getters/valueOf (including direct-call fallback), validates the maximum,
  and creates native resizable backing storage when requested. Prototype getters
  expose byteLength, maxByteLength and resizable with receiver branding.
- Copying and all explicit buffer snapshot encodings preserve the maximum and
  resizable/fixed distinction. Two failing snapshot/replay tests proved capacity
  was lost before the serialization change. Invalid capacities below current
  length, fractional capacities and infinite capacities are rejected.
- A new host-call digest test reproduced identical identities for fixed and
  resizable buffers with equal bytes. Capacity is now included in the digest.
- Current focused capacity/buffer/host/snapshot cohort: 39 passed; TypeScript
  passed. These are not final full-suite/build/harness qualification.
- ArrayBuffer resize, isView, and Float32Array views over resizable buffers are
  the next explicitly tested gaps. The existing Float32 storage guard still
  rejects resizable buffers; view tracking and resize semantics must be handled
  before claiming this work complete. Operations probe log:
  `/tmp/poe-safejs-array-buffer-operations-red.log`.

Resize and view runtime progress:

- The four operation probes failed before implementation. Added branded resize
  with guest length coercion, bounds checks and pre-growth budget checks, plus
  ArrayBuffer.isView. Native length-tracking Float32 construction now omits the
  explicit length when the guest omits it, and records original guest view layout.
- Runtime no longer rejects non-shared resizable backing buffers. Copying a
  resizable view currently requires known layout, preventing silent downgrade of
  an unknown imported view to fixed length; host-layout discovery remains open.
- Resizable-operation plus maintained Float32 cohort: 34 passed; TypeScript
  passed. Fixed-length and tracking layout still need full transport coverage.
- Three new native-oracle snapshot regressions cover an in-bounds tracking view,
  a fixed view temporarily out of bounds, and a tracking view temporarily out of
  bounds. These fail because original offset/length-tracking layout is not yet
  encoded/restored. Log: `/tmp/poe-safejs-float32-resizable-snapshots-red.log`.
  Preserve native recovery on buffer regrowth; do not snapshot an out-of-bounds
  view as a permanently empty fixed view.

Resizable layout follow-up:

- The three failing primary snapshot cases now pass. Encoding stores the original
  offset and fixed length or length-tracking mode. Restoration temporarily grows
  an out-of-bounds backing buffer within its validated capacity, constructs the
  original view and restores the buffer length. Replay and host data-copy cases
  cover the same layouts and preserve recovery on later growth.
- Malformed tracking flags, nonzero tracking lengths, fixed backing storage,
  misaligned offsets and layouts beyond maximum capacity are rejected.
- Two new native comparisons reproduced rejection of tracking views over buffers
  with trailing partial bytes. Those now use the native floor-length behavior;
  the fixed-buffer alignment restriction remains intact.
- Another native comparison reproduced a stale buffer-length check when explicit
  view-length coercion grows the buffer. Validation now reads the current length
  after coercion. Shrink-during-coercion remains a rejecting control.
- Focused layout/resize/storage cohort: 36 passed. TypeScript passed. The full
  maintained SafeJS unit route is rerunning, excluding only the separately tracked
  Promise-import policy and unfinished Float32 species cases. No build is running
  concurrently. This feature is still local, not committed, pushed or released.
- Remaining review includes view-aware host-call identity, resizing during typed
  array methods, unknown imported resizable view layouts and direct-call coercion.

Read-only host identity probe confirmed the next defect: an eight-byte fixed
Float32 view, a tracking view over an eight-byte buffer with maximum 16, and an
explicit two-element view over the same resizable layout all produce digest
`6779c25c432c61a0affa2ce24dfdba8cb90a574a58b82c4f319912d398b87d8a`.
The digest currently includes observable offset/length and backing bytes but
omits backing capacity and original tracking layout. Add a failing regression
and fix this before push. Preserve established fixed-buffer receipt identities
where there is no new backing metadata or layout information to represent.

Host identity and method fixes:

- Three digest tests failed before the fix (capacity/tracking collision, ignored
  buffer metadata and ignored buffer/view cycle). The Float32 digest now includes
  backing-buffer state when nontrivial and the original resizable view layout.
  Ordinary fixed-buffer digests remain unchanged. Six distinct layouts, including
  two temporarily out-of-bounds views, remain distinct and stable through replay.
- Digest plus maintained identity/Float32 regressions: 54 passed. Expanded digest
  round-trip cohort: nine passed. Logs: `/tmp/poe-safejs-view-digest-red.log`,
  `/tmp/poe-safejs-view-digest-qualified.log`,
  `/tmp/poe-safejs-view-digest-roundtrip.log`.
- Six native comparisons then reproduced missing out-of-bounds checks in join,
  values, set and slice; subarray also lost the original offset and tracking mode.
  Methods now perform native typed-array bounds validation where required, set
  checks after offset coercion, and subarray uses original layout and preserves
  tracking when its end is omitted. These plus maintained set/range/Float32
  regressions pass: 68 tests. Seven layout snapshot/copy tests also pass, including
  a tracking subarray through two primary snapshot rounds.
- TypeScript and follow-up lint passed. The prior full run completed with 17,849
  passes, 41 skips and the three digest failures: it loaded the new regression
  tests with pre-fix modules. The current code is now under a fresh full run,
  `/tmp/poe-safejs-array-buffer-final-package.log`. Do not treat the earlier run
  as qualification of the final changes or restart the live run.
- Further native comparisons are still needed for iterator.next after a resize,
  resizing during method coercions, and direct-call getter coercion. These are
  explicit remaining coverage gaps, not assertions that those paths work.

Final foundation qualification:

- Fresh maintained SafeJS unit route: 17,859 passed, 41 skipped; 531 files passed
  and one skipped; 281.61 seconds. The two explicitly tracked unfinished files
  (Promise host-import policy and Float32 species) remain excluded, not counted
  as passes. Log: `/tmp/poe-safejs-array-buffer-final-package.log`.
- TypeScript and scoped ESLint passed. Selected workspace build and real harness
  qualification follow. No source changes were made during the final full run.
- Read-only GitHub issue search for ArrayBuffer or Float32Array returned no open
  matching issues. Nothing has been closed speculatively.
- Resize-during-conversion mismatches are recorded separately in
  `docs/plans/safejs-float32-resize-reentrancy.md` for an independent TDD fix.

- Selected build passed: 23 workspace builds and four native ESM/import checks.
- Real harness command passed with a fresh CLI build: 70 successful tasks,
  zero cached, 57.751 seconds. Inspected
  `screenshots/harness-run-docs-plans-safejs-array-buffer.md.png`: Harness passed,
  expected result fields, no errors; zero agent spawns as intended for this
  runtime-only probe. This validates the actual pair, not model behavior.
