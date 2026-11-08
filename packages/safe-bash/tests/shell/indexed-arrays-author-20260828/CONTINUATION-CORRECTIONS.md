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
- hwmqBj / d1f79258: 23/23 source groups; installed and physically moved strict
  public consumers passed six foundation flows each. The inspected readBytes API
  is an async generator; the consumer uses bounded iteration, not a proposed
  collector signature. Negative public type controls failed compilation as intended.
- sAIOg1 / f2bea0ee: 27/27 source groups, 48 public Shell.exec calls; ten actually
  loaded mutants failed their targeted assertions. Installed/moved consumers and
  negative public type controls passed their respective expectations.
- MB5NJY / 8635b0b8: build failed because moving sourceDepth restoration into a
  closure lost TypeScript's optional-field narrowing. e9acdb17 captures the original
  scalar depth before publication and restores that identity; no expected output
  changed and no timeout was increased.
- l9Y6zk / e9acdb17: build/strict passed; 27/28 groups passed, 49 public exec calls.
  Newly accounting the private state/proxy WeakMap entries under F makes the
  maxExpansionFields=1 case refuse at Map-slot admission before metadata admission.
  Update only that exact expected diagnostic from private metadata to private Map
  slot. This follows the unchanged seven-counter refusal order and is not a blanket
  diagnostic relaxation. Preserve the original failing capture.
- Uw3rbK / c7dae6e8: 28/28 groups, 50 source public exec calls; all ten loaded
  mutants and both strict installed/moved six-flow layouts met expectations.
- jcgWOz / 9813f231: build/strict passed; 31/32 groups, 56 public exec calls before
  the first control-name assertion ended its loop. The generic success helper
  incorrectly required empty stderr after an intentionally refused control-name
  conversion followed by successful printf. The replacement explicitly asserts
  the exact control-refusal diagnostic, status and retained RHS absence for each
  of thirteen independently listed names. No production behavior changed.
