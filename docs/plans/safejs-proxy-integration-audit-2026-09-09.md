# Proxy integration audit, September 9

## Current validation boundary

Source HEAD at start: a9d9e26c2. This working tree includes unrelated uncommitted
weak-collection work and host-Promise import tests. It is not an isolated
committed-tree candidate.

Started the maintained route:

```sh
npm run build:workspaces -- --workspace=@poe-code/safe-js
npm run test:unit --workspace=@poe-code/safe-js -- --reporter=default
```

The declared closure completed 23 builds and four fresh-process import checks.
The unit run completed with exit 1 (session 80899): 23,676 passed, seven failed,
37 skipped across 897 files (890 passed, six failed, one skipped), in 420.46
seconds. Source files remained unchanged during the run. This is not a passing
package gate. The seven failures are the two host-Promise import cases, the
array for-in expectation, named-host strict deletion, SDK Reflect.construct,
and two historical checkpoint comparisons missing the Proxy intrinsic addition.

## Newly validated integration gaps

Read-only probes used the freshly built core export, not inferred source paths.

- `run("return new Proxy({x:1},{})")` returns `{}`.
- `run("return new Proxy([1,2],{})")` returns `{}`.
- A nested Proxy return also becomes an empty object. The host data-copy path
  checks native Proxy identity but does not recognize the private guest carrier.
  Audit host export semantics before changing this path; do not silently unwrap
  targets and skip guest traps or leak private handler state.
- `lint` reports AS003 unknown identifier twice for a source using both
  `new Proxy` and `Proxy.revocable`, despite the public runtime binding being
  committed. Add runtime-backed lint regressions before repairing declarations.

These probes identify next work; no repair or completion is claimed here.
The full binding audit inspected 61 runtime names; lint rejected Proxy, WeakMap,
and WeakSet. The weak names belong to the separate experimental working-tree
feature, so the committed Proxy declaration is the next isolated lint repair.

## Failures identified while the full run continues

- interpreter.test.ts independently reproduced one failure (476 passing):
  "iterates only present array indices" expects the enumerable `extra` property
  to be omitted from for-in. Native Node includes it, matching the repaired
  runtime. Correct the obsolete test expectation, not the runtime enumeration.
- reflect.test.ts reported failure in "preserves newTarget through SDK
  Reflect.construct". The focused reproduction failed too: the constructed
  object's `own` field was false rather than true, proving new.target identity
  was not preserved through the exported SDK closure path. Fifty unselected
  tests were skipped, not counted as passes.
- The Reflect fallback sets `context.newTarget` but omits the explicit seventh
  argument now accepted by invokeBuiltinClosure. Its constructor fallback then
  selects the target rather than that supplied context field. The Function
  prototype fallback uses the same outdated calling convention; audit additional
  adapters and add targeted coverage rather than changing all calls blindly.
- named-host-mutations.test.ts independently reproduces "preserves a false
  deletion result for an existing named property": strict member deletion now
  throws TypeError instead of returning false. The realm parses executable module
  source and the interpreter applies strict deletion by default. Validate the
  intended strict/sloppy/Reflect contracts before changing runtime or expectation.
  Built-runtime probes now confirm strict deletion throws TypeError and deletion
  inside a non-strict Function returns false, matching native Proxy controls.
  Thus retain strict behavior and relocate the false-result expectation to a
  non-strict context. Reflect deletion of live host capabilities is independently
  rejected as unsupported descriptor access; do not expand that API as part of
  correcting this strict-mode test.
- The historical regex checkpoint test independently fails because its declared
  additional-intrinsic list includes globalThis and eval but not Proxy. The
  comparator reports exactly one extra binding, Proxy. Keep the genuine EA
  fixture unchanged and use its existing explicit added-intrinsic mechanism;
  do not drop graph, alias, source-hash, replay, or history comparisons.

The two host-Promise import failures remain subject to the admission-policy
decision described in safejs-host-promise-import-policy.md. Do not import
arbitrary private host symbols to make those tests pass.

Pushes and releases remain paused. The larger JavaScript-completeness objective
is still open; focused Proxy improvements do not establish full conformance.

## SDK Reflect repair after the terminal gate

Six added constructor cases cover ordinary and bound targets, Proxy targets and
newTarget, construct traps, and accessor-backed construct traps. The first four
failed before repair: three identity mismatches and one missing guest-property
context. Reflect now forwards the explicit newTarget argument and provides a
guest property/invocation bridge for SDK calls without an interpreter context.
The broader Reflect test caught an accessor-bridge regression during development;
that was corrected before committing. TypeScript also caught the omitted required
thisValue field; it was restored explicitly.

The combined Reflect/Proxy construction/instanceof selection passed 88 tests;
the final expanded Reflect file passed all 57 tests. These are post-repair focused
results, not a rerun of the full package gate. The Function prototype fallback
and other adapters remain separate follow-up work, as do the other six failures
from the terminal full run. README updated for the tested SDK behavior.
