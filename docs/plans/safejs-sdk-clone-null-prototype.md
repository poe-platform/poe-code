# SDK structured-clone record prototypes

## Validated gap

The native structured-clone oracle creates an ordinary object when given a
null-prototype record. The SDK structured-clone option instead preserved null.
The regression failed before implementation (0b9e73). The equivalent guest
runtime test already passed, so no interpreter serializer change is justified.

Create ordinary records in the SDK structured-clone path regardless of the
input record's null prototype. Preserve the existing behavior for ordinary
SDK copies. The regression checks a self-cycle and data value as well as the
prototype; the guest-runtime case remains a passing control.

## Verification

- Node 22: 49 tests passed across the new prototype checks, symbol-key omission,
  accessor cloning and ordinary value copies.
- Package TypeScript no-emit check passed.
- Node 18.18.2: both regression/control tests passed.
- Focused lint passed for values.ts and the new test.

Only the one-line SDK record-allocation condition, its tests and this plan are
included. Other uncommitted changes in values.ts and unrelated staged Safe Bash
work remain untouched. This is not complete structured-clone or JavaScript
qualification; the known full-suite failures remain open. No CLI appearance
changes. Local commit only, with no push, release or issue closure during the
release hold.
