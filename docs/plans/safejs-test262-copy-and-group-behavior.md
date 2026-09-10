# Array, grouping and Set behavior: pinned source probes

## Scope and procedure

Use Test262 commit `72faf8ec1445c55149615e8b35187830783aba1a` and load
each directory's JavaScript tests and declared harness includes in memory.
Run each source in strict mode, first in a fresh Node 26.8.1 VM context,
then in a fresh SafeJS run. Include `sta.js` and `assert.js`.
Record native failures separately instead of treating them as guest passes.
Exclude and report negative, noStrict, async, module and raw tests.

These are source-level probes, not the official Test262 runner. They do not
qualify non-strict execution, checkpoints, host admission, resource limits,
all supported Node versions, or complete JavaScript conformance.

## September 10 results

| Test262 directory under `test/built-ins` | Guest passes | Native passes | Skips |
| --- | ---: | ---: | ---: |
| Array/prototype/toReversed | 17 | 17 | 0 |
| Array/prototype/toSpliced | 30 | 30 | 0 |
| Array/prototype/with | 21 | 21 | 0 |
| Object/groupBy | 14 | 14 | 0 |
| Map/groupBy | 14 | 14 | 0 |
| Set/prototype/union | 29 | 29 | 0 |
| Set/prototype/intersection | 28 | 28 | 0 |
| Set/prototype/difference | 28 | 28 | 0 |
| Set/prototype/symmetricDifference | 28 | 28 | 0 |
| Set/prototype/isSubsetOf | 23 | 23 | 0 |
| Set/prototype/isSupersetOf | 25 | 25 | 0 |
| Set/prototype/isDisjointFrom | 25 | 25 | 0 |

All 282 recorded cases passed unchanged. No runtime fix is justified by this
selection. The separate `toSorted` defect and its 21-case post-fix probe are
recorded in [sort validation order](safejs-array-sort-validation-order.md).

The original completeness objective remains open. In particular, these results
do not resolve the existing ISO formatting, Promise admission-policy, or
full-suite reliability work in the current gap inventory.

Only verification documentation changed during this qualification.
`git diff --check` passes. No push or release was made.
