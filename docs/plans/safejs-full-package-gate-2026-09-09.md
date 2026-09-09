# SafeJS full-package gate — September 9

## Latest completed run

Atomics candidate `098e503fd`, session 5896: exit 1 after 733.32 seconds.
24,864 tests passed, 4 failed, 37 skipped; 971 files passed, 3 failed,
1 skipped (975 total). Two failures are the unresolved host-Promise property
policy. Two legacy EA checkpoint comparisons explicitly enumerate added globals
but omit Atomics. Their exact binding-list mismatch is reproduced by the gate;
add Atomics to those declarations without changing the historical captures or
weakening graph, alias, metadata or hash comparisons. D3 deadline cases passed.

The original 1,305 inputs were verified unchanged after completion, SHA-256
6a473f2b78c9f41a890dbabc43a7aa6c8b28b77747c58ec3e73915e0894d2893.
The six new shared-buffer modules/tests were not part of the discovered inputs.
This run includes the pre-existing uncommitted work and is not all green.
After adding only Atomics to the two explicit intrinsic-addition lists, both
affected files passed: 44 tests passed and one skipped (session 20527). Legacy
captures and the graph comparator were unchanged.

## Previous completed run

Runtime candidate `291ce5fca`, session 21369: exit 1 after 544.03 seconds.
24,819 tests passed, 2 failed, 37 skipped; 971 files passed, 1 failed,
1 skipped (973 total). Only the two host-Promise own-property policy tests
failed. The reused-budget accounting and original five-second D3 cases passed
in this package run; no deadline or workload was relaxed.

The original 1,302 source/test inputs were verified unchanged after completion:
SHA-256 f02fa8d837b87e731d944737740e0f6a90fc06d89011f287362c68fe9e5eaa06.
The newly added Atomics factory and regression file were excluded from those
inputs; the factory was not yet connected to globals during this run.
Uncommitted work remains included in the original input set. This is not a
clean-checkout or all-green claim.

## Earlier run

Runtime candidate `b4613fcbc`; later `dd550eab4` changed only documentation.
Command: npm run test:unit --workspace=@poe-code/safe-js -- --reporter=dot.
Session 54630 completed with exit 1 after 689.23 seconds.

Results: 24,777 passed, 5 failed, 37 skipped; 964 passing files, 3 failing,
1 skipped (968 total). This is not a passing gate.

Failures:

- boxed-boundaries: closed-realm budget reuse exceeds dataSize, 1681 > 1500.
- function-arity: both full D3 bisector fixtures exceeded five-second deadlines.
- promise-import-properties: two unresolved native Promise property-policy tests.

The original 1,297 source/test inputs have SHA-256
dc4276556f32c96a46c880570e159bfb75ab769ffc28dbf4423448133585e635,
verified unchanged after completion. The separately added foreign-intrinsic
error and foreign-RegExp audit files were not in this run's discovered test set.
The worktree includes experimental uncommitted weak-collection changes; this
is not a clean-checkout claim.

An isolated rerun of boxed-boundaries and function-arity passed 65 cases and
failed only the retained-memory case. The deadline failures remain unresolved,
not excused by the focused pass. A built probe confirms that reusing a budget
also changes Object.getPrototypeOf(Number)===Function.prototype from true to
false in the second realm. Investigate realm-prototype registry lifetime first.
