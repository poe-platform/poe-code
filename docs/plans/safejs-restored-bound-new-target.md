# Restored bound-constructor newTarget

## Reproduction

At `7c5abb4c6`, live single and nested bound Array constructors retain an
alternate constructor's prototype. After serialize/JSON/restore, both instead
select Array.prototype. Two tests fail specifically on the restored prototype
identity; the live control and bound argument values pass.

The restored adapter includes newTarget in its call-context record but omits
the explicit newTarget parameter consumed by `invokeBuiltinClosure`. That
dispatcher consequently substitutes the callee when constructing.

## Change

Forward the already-computed newTarget as the dispatcher argument. Preserve
the existing bound-function substitution when newTarget is the bound function
itself; single and nested ordinary-construction controls check the original
target prototype. No weak/finalization restoration changes are included.

## Verification

- Before: two alternate-prototype regressions fail after restoration.
- After: 108 tests pass across constructor regressions, restored Intl context,
  general restoration, bind prototype ordering and Proxy binding on Node 22.
- Final ordinary-construction controls pass in both regression cases on Node 22.
- Node 18.20.8: 26 tests pass across both restored-call regression files, bind
  prototype ordering and Proxy binding, including ordinary-construction controls.
- Focused ESLint and SafeJS TypeScript no-emit checks pass.

This fixes the demonstrated constructor-dispatch gap, not all snapshot or
JavaScript compatibility gaps. Pushes and releases remain paused.
