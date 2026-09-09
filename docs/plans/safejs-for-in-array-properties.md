# Array string properties in for-in

Investigation at cdb643f82 found that `forInKeys` explicitly discarded every
non-index property on arrays, even enumerable string properties. Four of six
native JavaScript comparisons failed before the fix (session 22061).

Remove the array-only index filter. The existing descriptor enumerability check
already excludes `length` and other non-enumerable properties; own-name collection
excludes symbols. Keep visited-name shadowing and deleted-property checks.

Coverage includes custom names, non-index numeric strings, array ancestors,
hidden and symbol properties, deletion, and non-enumerable shadowing. Generator
checkpoint cases cover custom properties and inherited array properties in both
sync and async generators. The low-level checkpoint fixture has no built-in
bindings, so its inherited case uses a prototype object literal, not `Object`.

Verification: 115 tests across five files, package TypeScript and scoped lint
passed (20933). Expanded array and generator coverage passed 41 tests across two
files (78288). This does not implement Proxy for-in or establish full-package
conformance. Pushes and releases remain paused.
