# Array.from Proxy iterator construction order

## Validated defect

With a dynamic Symbol.iterator supplied by a Proxy get trap, native Array.from
reads the method, constructs the result, then calls the captured method.
SafeJS instead called the iterator factory before constructing the result.
The same defect occurs when the Proxy is in the input's prototype chain.

Six independent native-controlled regressions initially failed: direct and
inherited Proxy inputs, each with normal construction, throwing construction,
and a constructor replacing the exposed iterator factory. The throwing cases
prove that the earlier factory call introduces side effects that must not occur.

## Fix

Use the existing property-descriptor lookup's Proxy-boundary callback to detect
an observable iterator method even when no ordinary descriptor exists. Capture
the dynamically read method before construction, then use the existing delayed
iterator-acquisition path. Preserve low-level implicit-iterator compatibility
and the separate Array.fromAsync acquisition order.

Six additional controls check undefined/null iterators falling back to array-like
length access, and invalid non-callable iterators rejecting before construction,
for both direct and inherited Proxy inputs.

## Delivery

The focused factory, Proxy acquisition, constructor-order, typed-result and
Proxy-result selection passes 156 tests across seven files. After adding the
fallback/invalid-method controls, the standalone regression file passes all
12 cases. Native controls use fresh VM contexts. These are focused results,
not a complete package gate.
Scoped ESLint, package TypeScript no-emit checking and `git diff --check` pass.

Local only. No push, release, or CLI visual output changes. Full-package failures
and the broader JavaScript-completeness goal remain tracked separately.
