# Callable Proxy object tags

## Evidence and repair

Six native-comparison regressions demonstrated that Object.prototype.toString
returned `[object Object]` instead of `[object Function]` for callable Proxies.
The existing Proxy path checked array identity but omitted callable identity.
It now selects Function after the array check, before reading Symbol.toStringTag.
The order preserves revoked-Proxy errors and custom-tag precedence.

## Validation

Ten new tests cover functions, arrows, classes, nested Proxies, non-string and
custom tags, async/generator functions, revocation, and the tag getter's receiver
and single invocation. The combined direct/inherited tag and global Proxy
selection passed 42 tests across four files. Package TypeScript and scoped lint
are checked separately; this focused result is not a full-package gate.

Host-boundary integration and remaining identity consumers still need auditing.
This is a local improvement only; pushes and releases remain paused.
