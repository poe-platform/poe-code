# Continuation attempt corrections

All original attempts remain retained. No native observations or sealed syntax
captures are rewritten; these are author development outcomes, not acceptance.

- T3F5Ng / 39f5613e: build failed because the existing synchronous shebang-state
  helper called the now asynchronous guarded clone. 4b350c74 propagates await
  through its existing async callers; no public signature changed.
- vttC5D / 4b350c74: build/strict passed, 11/14 groups passed. Copied sparse slots'
  disposal removed a newer same-index replacement. The fix checks slot identity
  before deleting. Sparse replacement, readonly-zero and clone cases subsequently
  passed; expected outputs were not changed.
- BhrZQz / a7f3b385: build/strict and 18/18 groups passed.
- 8KdKuf / 04fdb8cc: build/strict and 22/23 groups passed, including the actual
  default public B/F overflow cases. The new zero-byte scalar control incorrectly
  expected command name `true` to fit the existing maxExpansionBytes=0 contract.
  It necessarily costs four argv bytes. Replace only that control with the
  assignment-only `scalar=` (empty scalar RHS, no command argv); keep the public
  array zero-B/tiny-F assertions unchanged. This is an explicit author expectation
  correction, not a product fix or oracle rebaseline.
