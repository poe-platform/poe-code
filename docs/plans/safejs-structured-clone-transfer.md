---
title: Structured clone transfer validation
---

# Validated structuredClone transfer gap

The native-comparison probe in structured-clone-transfer.test.ts fails:
after cloning a four-byte buffer with `transfer: [buffer]`, native JavaScript
reports the original length as zero while SafeJS still reports four.
The current closure accepts only its first argument and drops options.

Implement the [HTML structured serialization and transfer algorithm](https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializewithtransfer).
Read the options dictionary and transfer sequence through guest property and
iterator operations. Validate transferable brands and duplicates, then complete
clone validation before detaching anything. Preserve transferred backing aliases
for ArrayBuffer, numeric typed arrays and DataView. Transfer listed buffers even
when absent from the returned graph. Preserve resizable capacity. Reject detached
or non-transferable items with the appropriate error, and test failure ordering.

Resource failures must remain fatal and must not leave buffers detached before
all fallible SafeJS allocation/validation steps have completed. Account for any
temporary native transfer results. Test actual ownership loss, invalid entries,
duplicate lists, option/iterator side effects, mixed views, snapshots and Node 18.
Keep this a separate atomic commit and push after DataView is delivered.

Web IDL sequence conversion does not close the iterator on element conversion
failure. The native-comparison regression caught an incorrect cleanup call in
the first implementation; retain that regression unchanged.

## Manual validation

Run the paired harness with the real runner through `npm run screenshot-poe-code
-- harness run docs/plans/safejs-structured-clone-transfer.md`, then inspect the
PNG. This checks runtime behavior, not model behavior; no agent calls are needed.
Check the built SDK on Node 18 to exercise native structuredClone detachment
fallback when ArrayBuffer.prototype.transfer is absent.

## Results

- Initial expanded validation: 24 failing transfer cases, one passing control.
- Final focused buffer/clone/persistence suite: 428 tests passed in 21 files.
- TypeScript and ESLint passed for the changed implementation and tests.
- Real harness passed after 70 uncached build tasks; screenshot inspected.
- Node 18.18 built SDK fallback returned `[true,4,7]`: detached original,
  four-byte clone, retained byte value.
- No matching open GitHub issue found. Guest object accessor cloning remains a
  separate gap; this change does not claim complete structuredClone conformance.
