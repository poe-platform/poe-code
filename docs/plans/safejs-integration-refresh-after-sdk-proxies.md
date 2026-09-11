# Integration refresh after SDK Proxy fixes

Source HEAD: ca8c3d8ad. The working tree also includes experimental weak-collection
work and the unresolved host-Promise property-import tests. This is not a clean
committed-only candidate and not remote-main delivery evidence.

Before the maintained build/test run, sorted paths and file contents under
packages/safe-js/src and packages/safe-js/test produced SHA-256:

e0f61eda674d82f9e61c958bf504280cf558df552630edcd862326821c33bb84

The hash excludes build tools, dependencies, documentation, and other workspaces.
The same hash was verified during and after the run. Source and tests remained
unchanged during verification.

Command: npm run build:workspaces -- --workspace=@poe-code/safe-js followed by
npm run test:unit --workspace=@poe-code/safe-js -- --reporter=default.

The maintained build completed 23 declared builds and four fresh-process import
checks. Session 12107 completed with exit 1: 23,915 passed, two failed, and 37
skipped tests (23,954 total), across 915 passing files, one failing file, and one
skipped file (917 total). Unit duration was 562.40 seconds.

The only failures are promise-import-properties.test.ts: the explicit own string
descriptor is missing, and the user-symbol property yields undefined instead of
42. This is not a successful package gate. Their host-property admission policy
remains unresolved; do not blindly import native Promise private metadata or
weaken the isolation boundary to obtain a green test result.

The accumulated SDK input/result/construction, static from/of, primitive
conversion, Proxy iteration, host callback, and replay regression files passed
within this full working-tree run. This does not establish full JavaScript
conformance, a clean committed-only result, or repository-wide test success.

## Current capability presence

A fresh built-runtime probe against Node 22.23.2 finds eval, Function, Proxy,
WeakMap, and WeakSet bindings present. WeakRef, FinalizationRegistry,
SharedArrayBuffer, and Atomics remain undefined, while their native controls
exist. This supersedes the older inventory's claim that Proxy is absent.
Presence is not semantic conformance; weak collections remain experimental and
their Node 18 weak-symbol lifetime requirement remains unresolved.

The original completeness goal remains intact. Other outstanding areas include
full eval conformance, host-Promise property admission, transparent Proxy host
exports, complete host-boundary/SDK coverage, and broad regression verification.
No ambient host authority is implied by implementing language features.

Pushes and releases remain paused. No issue closure or remote delivery claimed.

## Read-only investigation during the run

The built internal getSandboxIterator helper, called after run returns a
Uint8Array with an own Proxy-valued Symbol.iterator, yields underlying storage
values rather than the custom iterator's values. A discriminating native control
uses storage [3,5] and a custom generator yielding [7,9]: native iteration yields
[7,9], while the direct helper yields [3,5]. The returned object still has its own
Symbol.iterator, but hasExplicitSandboxPrototype is false and its no-budget guest
prototype lookup is null. Wrapping the returned typed array in an array does not
change this observation.

An initial control used identical storage and iterator values and therefore
masked the mismatch. Do not use that control as passing coverage. This is an
internal-adapter mismatch, not yet a validated public SDK requirement or a
completed fix; establish supported call paths before editing implementation.
