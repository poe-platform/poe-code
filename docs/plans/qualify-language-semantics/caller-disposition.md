# Legacy caller fixture disposition

The two `language/arguments-object/10.6-13-a-{2,3}.js` sloppy variants remain
failed in the raw current-primary report. Their `features: [caller]` cases
assume a legacy caller extension either returns undefined or exposes the calling
function. They do not admit the inherited throwing accessor.

ECMA-262 2025 [CreateIntrinsics §9.3.2](https://tc39.es/ecma262/2025/multipage/executable-code-and-execution-contexts.html#sec-createintrinsics)
installs restricted properties on `%Function.prototype%` using
[AddRestrictedFunctionProperties §10.2.4](https://tc39.es/ecma262/2025/multipage/ordinary-and-exotic-objects-behaviours.html#sec-addrestrictedfunctionproperties).
Its caller accessor throws TypeError. OrdinaryFunctionCreate does not require
an own caller property shadowing that accessor. A native engine's optional
legacy caller behavior is not the ES2025 oracle.

The [minimal controls](legacy-caller-controls.json) reproduce the distinction
on Node 22.23.2 / ICU 78.2: an ordinary function reading its own caller sees
TypeError in SafeJS versus null in Node; an arrow-function neighbor sees
TypeError in both. These probes use the standard Script realm, without host
capability grants. No runtime code was changed to expose a caller or host stack.

Disposition: **legacy-extension/oracle mismatch, not a demonstrated ES2025
product defect**. Primary ledger ownership stays `qualify-language-semantics`,
with a `verify-conformance-oracles` dependency for upstream/report policy.
The two original fixture failures remain visible nonpasses. They are not
rewritten as passes or used to claim complete ordinary-function conformance.
