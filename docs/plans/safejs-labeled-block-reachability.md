# Reachability after labeled blocks

The CLI screenshot for labeled-block support incorrectly marked the following
statement unreachable after a break consumed by the block. Five regression cases
failed before the correction; a sixth exposed nested-function label isolation.

Track reachable breaks to active labeled blocks. A consumed break allows flow
after its block, while code after the break inside the block remains unreachable.
Keep return/throw termination handling and isolate function label contexts.
This is conservative reachability analysis, not constant-condition evaluation.

All 540 lint tests pass, and the two changed TypeScript files pass ESLint.
The actual harness CLI screenshot was inspected: the harness passes with no
unreachable warning and zero agent spawns.
