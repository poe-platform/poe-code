# Promise Proxy construction and callback dispatch

Eleven initial native comparisons failed because Promise capability construction
and callback paths invoked the private Proxy carrier directly. A twelfth failure
reproduced Proxy executors. Two additional failing cases cover callable Proxy
`then` overrides used by catch and finally.

Dispatch branded Proxies through existing call/construct operations in these
paths. Preserve ordinary closures' existing synchronous-prefix handling and job
ordering. Promise reactions and thenable jobs pass their execution budget through
to Proxy calls; context-free resolution retains its existing optional-budget API.

Verification:

- Fourteen native comparisons cover resolve/all/race/allSettled/any, constructor
  newTarget, executors, then/catch/finally callbacks, callable thenable hooks,
  resolve overrides, and overridden then methods.
- The selected 44 Promise files passed 639 tests. Host-Promise property-import
  tests were explicitly excluded because their admission-policy issue is
  unresolved; this is not a complete package gate.
- Package TypeScript and scoped runtime/test lint passed.
- Add checkpoint coverage for Proxy constructors, callbacks, and callable
  thenable hooks retained across await; run the complete Proxy snapshot file.

The new dispatch does not by itself validate Proxy-wrapped thenable objects,
every accessor path, or context-free SDK Proxy operations. Keep those in the
remaining audit rather than claiming complete Promise/Proxy interoperability.
README updated. Pushes and releases remain paused.

The complete Proxy snapshot file passed 31 tests, including the three added
Promise recovery cases; its scoped lint check passed too.
