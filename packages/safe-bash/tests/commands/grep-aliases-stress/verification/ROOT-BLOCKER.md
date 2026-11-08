# Shared external-stdin return failure: HOLD

Observed on committed c9bd0dbb in a physically moved offline package, not the live
worktree. The independent S07 borrowed-external-Shell-stdin row executes:

```javascript
let returns = 0;
const sentinel = new Error('external-return-sentinel');
const stdin = {
  [Symbol.asyncIterator]() {
    return {
      async next() { return { done: false, value: Buffer.from('keep:01\n') }; },
      async return() { returns += 1; throw sentinel; }
    };
  }
};
const result = await shell.exec('egrep -q keep', { stdin });
```

Actual: return is called once, but `result.exitCode === 0`, stdout/stderr empty.
Required independent assertion: the return failure must not become silent success.
The rejected error is swallowed at the borrowed external Shell input boundary;
this candidate is not a no-return observation. Both direct-context variants
(synchronous throw and asynchronous rejection, both aliases) and the owned-VFS
readStream return-rejection control preserve failure and passed. Registered-hook
failure and caller-abort precedence controls also passed. All workers exit before
the process ends, so this is a hidden cleanup failure, not a demonstrated worker leak.

Needed owner action: inspect the Shell external-stdin cursor/return cleanup path
and preserve a selected return rejection when there is no stronger caller abort
or primary execution failure. Do not change the alias, suppress the failing
assertion, or conflate a borrowed cursor's deliberately non-owning close with the
outer owner's eventual return. Add owner-scoped regression evidence at that public
boundary and provide a new immutable candidate commit for replay. No shared file
has been edited by this verifier; live `src/shell/runtime.ts` is under the active
shared owner's control and must not be overlaid into this archive.

## Final fixed-candidate confirmation and narrowed location

The same failure persists in candidate 04644bc2 after all six alias-specific
context regressions pass. The final ROOT-CONTROL registers only the public
createStandardCommands grep definition, with no aliases, and repeats the same
requirement. It also calls return once, then reports status zero and empty stderr.
Both cases remain failed; the control is not counted as a pass for finding a bug.

Frozen `src/shell/input.ts:65` assigns the return promise with both fulfillment
and rejection mapped to undefined. `ShellInput[Symbol.asyncIterator]` intentionally
exposes a borrowed iterator without return; the outer owning cursor eventually
calls the real source return. The silent rejection conversion is the observed
failure, not merely that borrowed iterator shape. Frozen `src/shell/shell.ts:174`
already awaits stdin close and propagates its error if no primary execution
failure was selected. Input source SHA-256 at this candidate:
`7af2dac6dfd6290e9f189590e9190b2e0703dcd99998212e471378063cd9a7b4`.

Minimal owner change request: preserve a settled outer cursor return rejection
through close instead of converting it to fulfillment, while retaining late-error
observation for pending opaque reads and existing caller-abort/primary-failure
precedence. Independently verify those boundaries; this verifier does not propose
an unreviewed blanket removal of cancellation handling or a shared source patch.
