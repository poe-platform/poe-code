# Proxy-wrapped thenable resolution

Seven native comparisons failed because Promise resolution inspected the private
Proxy carrier instead of reading its guest then property. Resolution lost wrapped
thenables, skipped trap effects/errors, and accepted revoked Proxies as plain data.

Mark guest Proxies as requiring resolution without running traps in the predicate.
During resolution, read then using the shared guest property operation and the
caller's context. Keep only callable results, reject read failures, and use the
existing thenable job/continuation machinery. Ordinary values keep their existing
fast path.

Thirteen native cases cover wrapped/nested/callable Proxies, original receiver,
read/call order, callable Proxy hooks, non-callable then, rejected reads,
revocation, callback returns, and async returns. A checkpoint case retains a
wrapped thenable across await. The combined focused selection passed 45 tests.

Run the broader Promise selection, package TypeScript, and scoped lint. The
host-Promise property-import cases remain excluded from that focused selection
and unresolved; no full-package gate is claimed. Context-free host boundaries
and inherited Proxy thenable access still need their own audit.

README updated. Pushes and releases remain paused.

The broader selection passed 652 tests across 45 files.
