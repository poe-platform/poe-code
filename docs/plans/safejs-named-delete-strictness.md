# Named host deletion strictness

The full package run and a focused rerun reproduce a test expecting `false`
from failed deletion in strict executable-module code. Built-runtime probes
confirm TypeError in strict code and false in a non-strict Function, matching
native Proxy controls. No runtime change is warranted for this expectation.

Move the false-result test into a non-strict Function and add a strict native
comparison asserting TypeError, preservation of the existing property, and
successful deletion of an absent key. Keep the host mutation provider unchanged.

Validate the complete named-host mutation and named-object suites with scoped
test lint. Reflect operations on live host capabilities remain a separate API
contract and are not broadened by this test correction. No full gate or release
success is implied; pushes and releases remain paused.

Verification: both complete named-host files passed, 83 tests in total.
