# SafeJS full-package gate — September 9

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
