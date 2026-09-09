# Legacy array graph comparison

Two failures in the full package run came from a comparison helper that assumed
every heap reference replacing an old inline value must be an intrinsic. Array
literals now retain their prototype and serialize as guest-array heap nodes.
The helper's new positive fixture reproduced the incorrect intrinsic assertion
before implementation.

Compare descriptor-backed arrays against the old inline indices and length,
while requiring default data-descriptor flags, extensibility, and an intrinsic
Array.prototype link. Continue recursively comparing values and enforcing the
existing bijection for legacy heap references. No serialization or restoration
implementation changes are needed for these two failures.

Corruption controls cover values, element aliases, prototype identity, length,
duplicate keys, and descriptor flags. A further test reproduced a hole in the
initial helper update: formerly distinct inline arrays could become one aliased
heap array. Track those newly referenced inline arrays separately from the
legacy reference bijection. Reject alias collapse; a distinct-array control with
shared elements still passes.

All three helper consumers found by source search were tested: 61 passed and one
skipped across the helper tests, independent f16round review, and regex compile
policy. Scoped ESLint and package TypeScript pass. This addresses two
failures from the last full run, not a fresh complete-package result. Diagnostic,
string SDK, and two host-Promise import cases remain.

README updated. No runtime or visual CLI changes. No pushes or releases.
