# Replace obsolete Proxy/weak-reference skip

The maintained `test/adversarial/test262-semantics.test.ts` ended with a
skipped no-op declaring Proxies and weak references outside the sandbox
language. Current implementations and dedicated tests contradict that label.
It is not an actual unsupported-syntax test and provides no conformance evidence.

Replace it with two executable cases: Proxy get/revocation behavior and live
WeakMap/WeakSet/WeakRef/FinalizationRegistry registration/unregistration.
The weak-reference case keeps its target strongly reachable and makes no
assumption about garbage-collection or finalization timing.

The nine tests in this maintained file pass (ce64a9). Independent native VM
execution of both new source bodies produces the same expected results
(893d5c). Scoped lint (f90c59) and whitespace checks pass. This file is explicitly Test262-style, not an upstream corpus runner;
these tests do not establish complete Proxy or weak-reference conformance.

This is a test-only change while full-package session 94973 remains active.
It was made after that run began, so the eventual report must be inspected
to determine which revision of this test file it exercised. Runtime sources
remain unchanged. No push or release is performed.
