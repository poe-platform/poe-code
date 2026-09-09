# Function prototype tables across budget reuse

The full-package gate at `b4613fcbc` found boxed-boundaries failing at
1681 > 1500 dataSize when closing and reopening realms on the same Budget.
An isolated rerun reproduced it. A public identity regression additionally
returned [false,false] for builtin and ordinary Function prototypes in the
second realm.

Function realm registration previously stored only Budget identity and kept
the first prototype table for that budget indefinitely. Retain the actual
prototype table per function instead, and start a new active table when
creating new builtin bindings. Do not remove that active table on ordinary
run cleanup: live exported factories still create functions afterward.

An initial cleanup-time reset failed lifetime/replay controls and was replaced
with initialization-time rotation. The direct-table regression uses Function
prototypes: a bare createBuiltinBindings call does not independently recreate
every boxed primitive prototype, so Number.prototype was not a valid distinct
table control for that low-level setup.

Final focused result: 229 tests passed across six files, including the original
1500-unit memory regression, budget reuse, old/new intrinsic identity, late
factory creation, replay, foreign newTarget and dynamic constructor controls.
This does not establish all runtime identities across budget reuse; the saved
foreign eval/dynamic evaluation contexts still require a separate audit.
That follow-up audit now has two failing controls: borrowed eval returns the
first run's marker (1 instead of 2), and borrowed Function throws fatal reentry
after reuse. They are in a separate uncommitted test file and are not fixed by
this prototype-table change.
Scoped ESLint, TypeScript and diff whitespace checks passed.
The full snapshot route passed 1,700 tests across 127 files. The maintained
selected-workspace build passed 23 builds and four fresh-import checks. A built
SDK probe repeated three realm lifetimes within the original 1500-unit budget
and confirmed zero current retained data after each close. No new whole-package
gate has been run after this fix; the two workload deadlines and two Promise
policy failures remain unresolved.

No push, release or issue closure.
