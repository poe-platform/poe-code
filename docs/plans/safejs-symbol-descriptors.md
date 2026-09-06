# Symbol intrinsic descriptors

## Validated issue

Native comparisons on remote-main foundation commit
0635829010305020efb5186c33649a0ee40eb10d showed incorrect Symbol constructor
property descriptors. Its prototype reference and well-known values were
enumerable; registry methods were enumerable, non-writable and non-configurable;
name/length reconfiguration also differed. The new regression suite reproduced
21 failures before implementation.

## Implementation

Use the same guest-visible function-property model as Object's intrinsic
constructor. Keep Symbol non-constructible. Define the prototype reference and
well-known values as fixed non-enumerable properties. Define registry methods
as writable/configurable non-enumerable properties. Preserve the existing
intrinsic mutation tracking and sandbox-local registry; do not make host
capability functions mutable.

## Verification and delivery

- Native differential tests cover 18 descriptors, enumeration, replacing and
  deleting registry methods, name redefinition, and fixed property rejection.
- All 83 focused Symbol controls passed; TypeScript explicitly exited zero.
- The maintained SafeJS package suite and focused ESLint are being checked.
- Before push, run the real harness and inspect a screenshot that checks these
  descriptors and mutations. Keep the delivery atomic and verify remote main.
- Monitor both publication workflows while continuing the next validated gap.

Evidence: /tmp/poe-safejs-symbol-descriptors-red.log,
/tmp/poe-safejs-symbol-descriptors-first.log,
/tmp/poe-safejs-symbol-descriptors-types.log,
/tmp/poe-safejs-symbol-descriptors-package.log, and
/tmp/poe-safejs-symbol-descriptors-eslint.log.

The foundation commit is already verified on remote main. Its release jobs
34023765635 (scoped packages) and 34023765719 (CLI) were still running at the
start of this follow-up. This descriptor fix does not claim to implement
destructuring, the remaining well-known protocols, or general built-in
inheritance.

## Completed verification

The maintained package suite passed 13,917 tests (41 skipped). Two additional
boundary controls verify changed intrinsic state/memory retention and unchanged
host-capability immutability; all 74 descriptor/callable-prototype controls pass.
TypeScript and focused ESLint explicitly exited zero. The selected SafeJS
workspace build closure passed, including its four fresh-process import tests.

The updated real harness checks fixed descriptor flags, mutable registry method
flags and replacement/restoration of Symbol.for. Its screenshot run passed with
zero spawns and no diagnostics; the image was visually inspected. Additional
receipts: /tmp/poe-safejs-symbol-descriptors-boundaries.log,
/tmp/poe-safejs-symbol-descriptors-build.log, and
/tmp/poe-safejs-symbol-descriptors-screenshot.log. This is a focused intrinsic
change; the foundation's full root tests/lint/build were already verified before
its preceding push.

The foundation's scoped-package release completed successfully and published
@poe-platform/safe-js@0.1.159 (run 34023765635). Its CLI run was still active at
this observation; publication is tracked independently from remote delivery.
