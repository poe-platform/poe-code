# Destructuring rest realm identity

## Validated gap

Eight tests failed before implementation. Object and array rest results were
resolved against another run's prototype when inspected through its SDK
Object.getPrototypeOf. Later creator-prototype mutations could be silently
discarded by data copying. Native VM controls preserve creator identity.

## Implementation

Store the current realm's default prototype on fresh object and array rest
results in patterns.ts. Do not replace restored pattern state or change key
enumeration, excluded keys, iterator stepping, or iterator cleanup. Where a
bare interpreter has no installed prototype, keep its existing fallback.

## Verification

The initial pattern/destructuring selection passed 231 tests across ten files.
Native-backed controls cover empty and populated results, omitted entries,
assignments, parameter patterns, own descriptors, and post-cleanup factories.
Scoped lint passed. The maintained build completed 23 workspace builds and
four fresh-process import checks. A built ESM probe now matches native
creation-realm identity for both object and array destructuring rest.
The final rest/snapshot/retained-root selection passed 1,721 tests across 129
files, including all ten new cases. Package TypeScript checks passed after
the build. This is not a fresh full-package gate. No visual CLI change.

No push or release during the release hold. Primitive boxing and function
rest-parameter array creation remain separate creation paths to investigate.
The built SDK probe confirms `((...r)=>r)(7)` still fails originating array
prototype identity when inspected by another run, while native VM passes.
