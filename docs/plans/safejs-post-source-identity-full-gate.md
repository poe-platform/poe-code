# Post-source-identity package gate

The maintained `npm test --workspace=@poe-code/safe-js` route was started after
local commit b6d705b28. This is a full package check, not a root-only unit shortcut.
All four filesystem contract configurations passed (100 contracts total).
The unit suite is running and has emitted failure markers; final diagnostics and
counts are pending. Runtime files are being kept unchanged during this run.

While it runs, test-only mixed-source coverage was expanded with private class
fields, pending async functions, suspended async generators and generator finally
blocks. Each second source has a different AST layout. All 12 mixed-source tests
pass on the current runtime; TypeScript and focused lint passed. These tests
do not make the full package gate green.

The previous full package gate had 27,437 passes, 10 failures and 48 skipped tests.
Its failures remain tracked until fresh evidence establishes their disposition.
Do not attribute the current markers to those failures before reading terminal
diagnostics. Pushes and releases remain paused.

Further test-only qualification adds derived-class method `super`, derived
constructor `super()`, direct-eval lexical closures and dynamic Function bodies
from distinct source texts. All 16 mixed-source cases pass after two JSON
snapshot round trips on Node 22.23.2 (efbfbe) and Node 18.20.8 (56b792).
These paths did not reproduce a defect, so no runtime fix was made. The full
package run remains live; its runtime source has not changed. Test-only edits
made after launch are independently qualified and are not claimed to have
been discovered by that already-running gate.
