# String trim aliases

## Validated gap

Both String.prototype.trimLeft and trimRight are undefined in the runtime.
Nine regressions fail before implementation. Native JavaScript exposes these as
the same function objects as trimStart and trimEnd, respectively.

## Change

Install the existing functions under the additional prototype keys, preserving
identity rather than creating wrappers. Give those functions the native names
trimStart and trimEnd. Keep the existing coercion and budget implementation.
The snapshot regression additionally exposed that these two closures lacked guest
function metadata, preventing restoration of their own mutated properties. Mark
them as guest intrinsics, as already done for other exposed String methods.

## Verification

Compare identity, descriptors, whitespace behavior, borrowed receivers, errors,
replacement/deletion independence and snapshot retention of shared properties.
Run focused string and legacy-snapshot tests, scoped lint and maintained build.
Commit and push separately; monitor publication without delaying other work.
