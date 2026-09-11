# Cooperative ERE matcher work accounting

The ERE matcher uses the existing invocation-local `EreLedger`. Work is an
abstract operation budget, not calibrated CPU time, a subsecond guarantee or
a total JavaScript heap bound. Limits and status meanings are unchanged.

## Copy admission

Before capture storage is allocated or copied, the matcher admits work for
the logical slots processed and retains the existing allocation admission:

- Initial capture and history arrays: twice the capture width.
- Descendant reset: the copied capture width, plus existing traversal work.
- Group close: both capture and history widths.
- Result materialization: copied captures, value storage and captured character
  volume. Each output slot also has a charged, checkpointed visit.

Work and allocation admission precede the corresponding allocation; neither is
refunded after a later refusal. Array widths are bounded by the existing grammar.
Logical slots and characters do not assert physical V8 copying or allocation sizes.

## Oldest-first history comparison

For two nonempty histories of lengths `leftCount` and `rightCount`, each history
is traversed once into a comparison-local array indexed oldest-first. Before
creating an array, its full length is work-admitted and `length + 1` allocation
units are admitted. Every subsequent link visit/store and ordinal comparison
is separately charged and checkpointed. No history array survives in a cache.

Materialization and comparison cost at most
`2 * (leftCount + rightCount) + min(leftCount, rightCount)` work units inside
the comparison, with `leftCount + rightCount + 2` cumulative allocation units.
Empty-history comparisons need no scratch. Scratch is bounded by admitted actual
history counts and the existing cumulative allocation limit, not an unchecked
materialization of an arbitrary subject or a new independent memory limit.

Preference remains: furthest ending position, capture-group order, oldest-first
span length/start order, then history count when the common prefix is equal.
Null captures, descendant resets, zero-width spans and equal-history ties keep
their existing meanings. States are not deduplicated and first success does not
replace preference evaluation. Cancellation keeps the caller's exact reason.

## Limits of the change

Additional copy and scratch charges can cause earlier work/allocation refusals
for some inputs, while eliminating repeated history traversal can reduce work
for others. All existing caps remain in effect; these are not promised identical
resource-failure boundaries. Ambiguous patterns still explore many states and
can legitimately reach a profile limit. Unchanged successful capture semantics
are checked against the existing reference/native-visible fixtures; those
fixtures do not establish universal Bash parity or a fresh native-oracle run.
