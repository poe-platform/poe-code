# Preserve source ReferenceError stacks

Four runtime regressions reproduce missing Identifier source locations in caught
reads, calls, updates and Promise rejection delivery. A native host stack privacy
control passes before the repair. Source-created diagnostics already carry the
guest location, but materializing the guest Error rebuilt its stack using only
the current call frames.

Use the canonical stack only for weakly branded source diagnostics. Keep the
existing guest Error construction, budget accounting and identity cache. Native
host Error stacks continue to be replaced with guest call frames; arbitrary
host stacks are not copied. Add JSON-checkpoint coverage for the rejected Promise.

This is a diagnostic-quality fix, not a claim that stack formatting is specified
by ECMAScript or that all error paths are equivalent to a native engine.
Validation:

- Four runtime regressions fail before repair; the native-stack privacy control
  passes. The corrected checkpoint test independently reproduces source-location
  loss against committed HEAD. Its first draft returned the rejected Promise
  directly and hit an unrelated unhandled rejection; that is not RED evidence
  for this bug. Returning it inside an object reaches the intended assertion.
- With only this production change applied to the isolated committed source,
  all 61 focused ReferenceError, catch/finally, declaration and recovery tests
  pass. Another 388 source-exception, native-host-error, Error-constructor,
  snapshot-error and shape checks pass across thirteen files.
- The isolated package TypeScript check and focused repository-configured
  ESLint both pass; session 94919 completed with exit 0.
- Whitespace checks pass. Unrelated staged SafeBash changes retain their patch
  identity. No full-package gate has been rerun for this repair.

The proposed atomic commit is staged separately in
`/tmp/safejs-reference-stack-commit.bNDLPL/index`, based on HEAD 775b6da41;
its exception implementation is isolated in
`/tmp/safejs-reference-error-commit.1afxzl/checkout` and excludes pending eval work.
Pushes and releases remain paused.
