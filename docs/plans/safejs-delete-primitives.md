# Delete primitive properties

Built native comparisons validate that deletion of missing properties on number,
boolean, string, symbol and bigint receivers returns true. SafeJS currently throws
TypeError for all five. String index deletion correctly throws in strict mode.

Reproduce the discrepancy with tests covering computed-key conversion and its
side effects/errors. Admit primitive deletion through temporary boxing while
retaining nonconfigurable string index/length behavior and nullish errors.
Verify focused deletion regressions, lint and the maintained build, then commit
this change independently of delete-value evaluation and dynamic constructors.

The initial regression run had eight failures and two passing strict string
controls. After primitive boxing, all ten cases pass, and the combined deletion
and dynamic-assignment run passes 50 tests. Four further controls retain null and
undefined errors and admit absent/noncanonical string indices. No prototype is
mutated: deletion acts on the temporary primitive wrapper.

Final focused verification passes 54 tests. ESLint and the maintained build pass
(23 workspace builds and four fresh-import checks). All 14 built native
comparisons pass on Node 18.18 and Node 24.14. No matching open GitHub issue was
found for this gap.
