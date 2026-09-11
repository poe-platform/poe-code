# Proxy in historical checkpoint comparisons

The complete package run failed two genuine EA checkpoint comparisons: regex
compile-policy and Math.f16round replay. The comparator reported one unexpected
binding, Proxy. Both callers already explicitly admit globalThis and eval as
new intrinsic bindings while comparing all represented legacy graph state.

Add Proxy to those two explicit lists. The comparator validates its intrinsic
reference and exact identity; it does not ignore arbitrary added globals. Keep
the historical captures and graph/alias/hash/replay assertions unchanged. Other
uncommitted edits in these test files must remain outside this atomic commit.

Run both complete files and scoped lint. This addresses two failed expectations,
not a proof of complete checkpoint compatibility or a passing full package gate.
Pushes and releases remain paused.

Verification: both complete working-tree files passed, 44 tests passing and one
native-host-dependent case skipped. The skip is not a pass. The commit excludes
the separate WeakMap/WeakSet expected-binding additions.
