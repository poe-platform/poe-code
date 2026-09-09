# SDK TypedArray.of and Proxy primitive conversion

Four initial native-comparison tests failed: direct, nested, and accessor-trap
Proxy constructor receivers lacked guest property context, and a Proxy numeric
input silently became zero. Supply the SDK of path with guest property dispatch
and closure invocation while preserving provided hooks and newTarget.

Constructor tests then passed, but numeric conversion still failed. Expanded
tests confirmed conversion hooks were skipped, BigInt input raised SyntaxError,
and revoked input was silently accepted. The shared conversionHook prototype
walk inspected Proxy carriers directly. Stop at that boundary and use shared
guest property access with the original receiver; preserve ordinary and legacy
builtin fallback behavior elsewhere.

Eight SDK cases and nine native Number/String/BigInt comparisons pass. Coverage
includes coercion order/hints, constructor newTarget identity, inherited accessor
receiver identity, nested Proxies, Proxy-valued hooks, and revocation.

The broader buffer/typed-array/coercion/BigInt selection passed 2,035 tests across
96 files. Scoped ESLint passed. An initial independent typecheck overlapped the
tiny-mcp-client build's deletion/recreation of dist and reported missing types;
the post-build rerun passed. Avoid that overlap on subsequent verification runs.
The maintained selected-workspace build passed 23 declared builds and all four
fresh-process import checks. These scoped checks are not a full-package gate.
README updated.
No CLI presentation changes. Pushes and releases remain paused. Full-package and
full JavaScript conformance remain unproven.
