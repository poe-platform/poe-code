# Private host-error diagnostic metadata

## Validated failure

Passing an ordinary native Error or DOMException as a public `run` binding failed replay encoding with an unsupported host-object error. The wrapped error retained the native diagnostic origin under `Symbol("wrappedErrorCause")`, but that symbol was missing from the internal-symbol registry. Guest symbol enumeration also exposed this private marker.

## Correction

Register the marker by identity in the existing internal-symbol registry. Keep the original cause available to explicit host diagnostic materialization; do not expose or recursively encode it as guest data. A user-created symbol with the same description remains public.

## Verification

- Public Error and DOMException binding regressions: message is usable and no private symbol is exposed.
- Same-description user-symbol identity is preserved.
- Explicit host diagnostic materialization retains the exact original Error.
- Run error-shape, formatting, host identity, host bridge, and replay/snapshot error tests.
- Run changed-file lint, the maintained SafeJS workspace build closure, and built-import checks before pushing.

## Separate remaining work

Foreign-realm native errors are currently rejected at admission. `Error.isError` is separately under development. Neither behavior is claimed fixed by this metadata correction.
