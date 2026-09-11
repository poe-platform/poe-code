# Guest Proxy data-copy boundary

Six regressions failed before the repair: the public deepCopyFromSandbox API
silently turned guest Proxies into empty objects, including arrays, nested
objects, Map values, Set entries, and revoked Proxies. The existing synchronous
data-only contract rejects native Proxies and unsupported guest prototype state;
inspecting a private carrier as ordinary data violates that contract.

Recognize guest Proxy identity at the copy boundary and reject with an explicit
owning-realm bridge error. Preserve explicit wrapClosure support for callable
Proxies. Do not unwrap private targets, skip traps, or copy handler internals.
This stops silent loss; it does not implement transparent Proxy export or count
that larger integration requirement as complete.

Eight tests cover the six loss cases, explicit callable wrapping, and a retained
guest-reference round trip. The latter checks identity, target mutation after
retention, and the actual get trap result/log. The focused copy/reference/clone
selection passed 62 tests across four files.

The broader copy, callback, host-bridge and Proxy checkpoint selection passed
431 tests across 23 files. Scoped lint and package TypeScript passed.
The full-package result in the preceding integration
refresh predates this change and still has two unresolved host-Promise imports.

The values.ts working tree contains unrelated weak-collection work. Commit only
the new copy guard from that file and preserve those changes and existing staging.
README updated. Pushes and releases remain held.
