# Typed-array symbol accounting

Validated while examining camera accounting costs after e78047a9a. The common
object traversal already measures symbol properties, then the typed-array branch
iterates typedArrayProperties, which includes those same symbols. New regressions
failed with 800 instead of 400 bytes of added string payload and 10 instead of 9
units for one empty symbol-keyed property.

Keep symbol capture in the common traversal, including snapshot-before-callback
ordering and accessor non-execution. The typed-array branch now measures only
string-keyed properties; array storage and prototype accounting are unchanged.
This addresses incorrect resource charging, not the unresolved camera CI timeout.
Do not claim a speedup from this change without representative measurements.

Before delivery, check every numeric typed-array family, symbol accessor/cycle
retention, focused data-budget and snapshot coverage, lint/types, and maintained
build/CLI validation. Commit this improvement independently of any performance
experiment and push directly to main.

Implementation evidence: both original regressions passed after excluding symbol
keys from the typed-array-specific pass. Expanded to all 12 declared numeric
typed-array constructors, including BigInt and Float16; added non-executing
getter and self-cycle coverage. Eight focused files passed 239 tests, covering
symbol resources, data budgets, Float32 properties/snapshots and number/BigInt
typed arrays. The earlier three-file check also passed all camera cases; this
does not establish that their CI timing issue is fixed. Scoped lint is running;
types and built CLI validation remain before committing and pushing.

Delivery validation: scoped ESLint and changed-file TypeScript passed. The
explicit SafeJS workspace build closure passed 23 maintained builds and four
built-import checks. A compiled-module probe verified 400-byte growth for all
12 typed-array families. The focused 25-test regression file was also executed
through the terminal screenshot route and its PNG inspected; this is a visual
test-report check, not an agent harness or CLI interaction change. No new CLI
surface is introduced by this accounting fix. Full camera behavior remains
covered by the earlier maintained camera tests; CI timeout resolution is not
claimed.
