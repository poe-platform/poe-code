# Strict arguments callee descriptor identity

Four native controls failed before editing: Object.getOwnPropertyDescriptor,
Object.getOwnPropertyDescriptors, Reflect.getOwnPropertyDescriptor and legacy
getter/setter lookup rejected the strict arguments object's native throwing
accessor rather than exposing the guest realm's shared throwing intrinsic.

Translate only the exact native restricted accessor identity during descriptor
exposure with an explicit realm budget. Resolve its guest counterpart through
the existing intrinsic registry, not a process-global guest closure. Keep every
other unregistered native accessor rejected and never invoke the native getter.
Existing argument creation and snapshot encoding can retain their native
non-configurable callee property; exposure resolves against the resumed realm.

Verify descriptor identity, invocation, per-realm separation, arbitrary-native
accessor rejection and checkpoint restoration, plus ordinary function/object
reflection, TypeScript and lint. This followup is outside the frozen full-suite
candidate. No publication or complete-workspace validation is implied.

Validation selections pass: 51 runtime/function tests; 84 arguments, accessor
boundary and snapshot tests; and 129 Reflect/object-accessor tests including
the final six new descriptor/security/realm controls. These selection counts
overlap and are not a count of distinct new tests. TypeScript passes; focused
lint is still running. The resumed snapshot preserves the callee getter/setter
identity and equality with the current realm's Function.prototype thrower.

Lint initially flagged two native arguments probes under prefer-rest-params.
Acquire the exact same native intrinsic from Function.prototype.caller instead
of creating a native arguments object; no suppression is needed. The final
descriptor/snapshot tests and the two affected lint files are being rechecked.

The final seven descriptor/snapshot tests and affected-file lint pass. The
earlier seven-file lint run reported errors only in those two files, now clean.

For atomic isolation, guest tests now obtain Function.prototype through an
ordinary function's prototype rather than the uncommitted Function global.
Assertions still compare all accessor identities and resumed-realm behavior.
Keep the exact native Function.prototype.caller probe in the host-side identity
test unchanged. The separate function-prototype restriction commit is being
qualified first; this descriptor bridge will follow independently.

The prototype restriction repair is now locally committed as f9e259004.
Against that committed baseline, the constructor-independent descriptor/recovery
tests reproduce six failures with the arbitrary-native-accessor rejection control
passing (12876). Only the four reflection/accessor production files are changed
in the isolated proposed bridge. Unscopables, async tags, dynamic source and weak
collections are excluded. The initial six-file function/descriptor/recovery
selection passes all 80 tests (47515).

Additional arguments/reflection/security regressions pass all 157 tests across
seven files (19575), giving 237 distinct passing tests across thirteen files.
TypeScript and focused lint both pass (65846, exit 0). Proposed index:
`/tmp/safejs-arguments-descriptor-commit.G4ArJb/index`; source checkout:
`/tmp/safejs-reference-error-commit.1afxzl/checkout`. The candidate remained
frozen through checks. Stage this updated plan with the exact candidate.
No push or release.
