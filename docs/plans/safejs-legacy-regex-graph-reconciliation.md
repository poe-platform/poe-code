# Legacy regex graph comparison

After the lightweight template-cache import repair, both compilation-policy
files were rerun unchanged: 52 tests passed and one legacy graph comparison
failed (94f573). The mocked source/depth/allocation limits now reach the guard;
no additional regex enforcement change is justified by those earlier failures.

The remaining comparison treats a descriptor-backed guest-regex node as if it
still had the legacy plain-object record shape. Existing callers already
verify restored regex behavior, aliases, source hashes, host-call replay and
untouched source fixtures before reaching that shape failure.

A new helper acceptance test reproduced the mismatch (5e8523), alongside ten
corruption controls. The helper now compares this exact format transition:
source, flags and lastIndex must match; the original one-to-one reference map
still verifies alias identity. New state must have the RegExp prototype and
only the standard writable, non-enumerable, non-configurable lastIndex data
property on an extensible object. Extra state or changed attributes is rejected.
No production serializer, parser or fixture was changed.

All four selected files pass: 89 tests passed and one skipped (695f79), including
the helper controls, both compilation-policy files, and independent f16round
legacy replay coverage. The skipped case remains unverified, not a pass.
Scoped ESLint and package TypeScript checks pass (3182a5). Existing user edits
to compilation-policy and independent f16round tests are untouched. No push or
release was made.
