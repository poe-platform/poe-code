# Read-only upstream findings and untested patch proposal

**Current v3, August 26, 2026:** the fixed native/upstream AbortError spelling
repairs v2's two message mismatches. Targeted unchanged tests pass 109/109; full
pinned suite is 3225 pass / 0 fail / 38 skip. The authorized new 18-case fixture
uses a native default-message oracle and passes 18/18. Original nine bytes remain
unchanged: original ten is still 9/10 (raw identity), invariants 8/9 (quota), and
verifier requires 10/10 with visible exit 1 / passed:false. Current evidence is
under `docs/upstream-patches/safejs/evidence/v3/`; v1/v2 results below are historical.
Stable source checkpoint: `/tmp/safe-bash-safejs-v3-source-stable.txt`. No commit;
separate final review pending, no accepted API contract change.

**Historical V2 proposal, August 26, 2026:** a run.ts-only cause-preserving revision relative
to v1 now repairs the unchanged 12-test error-shape audit and passes 18 new
frozen/accessor reason-safety checks. It does **not** satisfy the unchanged raw
Error identity assertion: original nine plus action-abort is **9/10**, not
10/10. The full pinned 125-file suite reports **3223 pass / 2 fail / 38 skip**;
both failures concern the investigator's generic AbortError message spelling.
The original nine file and supplemental invariants are unchanged. The verifier
still demands 10/10 and exits 1 with `passed: false`; no API contract is approved.
Fresh copies use the explicit preserved hash-pinned baseline because current
private source has drifted and is correctly rejected. V1 artifacts/logs are
retained separately; see `docs/upstream-patches/safejs/EVIDENCE.md`.

**Historical v1 isolated artifact update, August 26, 2026:** the historical proposal
below now has a reproduced candidate under `docs/upstream-patches/safejs/`.
Only fresh temporary regular-file engine copies were patched. The unchanged
original nine acceptances plus the new durable action-abort child move from
0/10 baseline to 10/10 patched, but the full unchanged upstream suite exposes
one cancellation error-shape regression (3224 pass / 1 fail / 38 skip), and a
supplemental shared-capture budget diagnostic remains failing. The candidate is
**NOT APPROVED**; `verify.mjs` intentionally exits nonzero. See that directory's
README and evidence for hashes, isolation, licensing, commands and limitations.
Statements below that no patch or durable lifecycle executable existed describe
the earlier handoff, not this later isolated implementation.

Independent verification, August 26, 2026. This document proposes private
SafeJS changes; **none have been applied or tested as a patch**. The shipped
plugin still passes its signal. No host evaluator or substitute interpreter is
used. No private dependency was installed or private worktree file changed by
these workers. Private files changed externally between the historical writer
snapshot and the later independent final review; identities are separated below.

## Minimal raw-engine differential repro

Run from the safe-bash workspace with its existing `tsx` tooling:

```sh
SAFEJS_LOCAL_ROOT=/Users/kjopek/Workspace/poe-code/packages/safejs \
node --unhandled-rejections=strict --import tsx --input-type=module -e '
const { run } = await import(process.env.SAFEJS_LOCAL_ROOT + "/src/run.ts");
for (const signal of [undefined, new AbortController().signal]) {
  try {
    await run("throw new Error(\"constructed\");", signal ? { signal } : {});
  } catch (error) {
    console.log({ signal: !!signal, name: error.name, message: error.message });
  }
}'
```

Expected in both cases: guest `Error` with message `constructed`. Observed
without signal: `Error`, `constructed`. Observed with a live signal:
`TypeError`, `Error is not a constructor.` The no-signal case is a differential
control, not an acceptable production workaround. The unchanged command exits
1 with `safejs: Error is not a constructor.`

`upstream-limitations.test.ts` reproduces direct-run controls, direct signalled
failures and command failures for five constructors (`Error`, `TypeError`,
`Map`, `Set`, `RegExp`), plus `Array.isArray` and `Array.from`. It also reproduces
the two further defects below. Passing these nine **characterization checks
does not mean any of the nine desired behaviors passed**.

`upstream-desired.probe.ts` retains the desired semantics as independently
runnable failing assertions, rather than silently rewriting acceptance:

```sh
SAFEJS_LOCAL_ROOT=/Users/kjopek/Workspace/poe-code/packages/safejs \
node --unhandled-rejections=strict --import tsx --test \
  tests/commands/safejs-stress/upstream-desired.probe.ts
```

This deliberately separate probe is not a conventional `*.test.ts` gate; run
and report it alongside the gate. It reported 0 passed / 9 failed on the observed
unfixed snapshots. A nonzero result is unresolved evidence, not something to hide.
If upstream changes, re-review the characterization expectations and desired
probe together; do not preserve old bug assertions merely to get green output.

## Additional raw-engine defects

- With `modules: {command: {env: Object.fromEntries([["__proto__", "literal"]])}}`,
  `import {env} from "command"; return env["__proto__"];` returns `literal`
  without signal and `undefined` with signal. The command supplies an own data
  property correctly, but inherits upstream data loss. This is not evidence of
  a host prototype escape; the observed failure is lost guest-visible data.
- `run("return 42;", {signal: AbortSignal.abort(reason)})` succeeds with 42
  instead of rejecting. The plugin's own precheck rejects the exact parent
  reason before calling the runner. Do not remove that protection.

## Root causes and proposed upstream edits

### Separate host-promise observation finding

On August 26, 2026, the read-only reviewer verified an injected host callback
that aborts its live signal and supplies a rejected promise. Actual-engine
execution surfaces the abort; afterward, a separate unhandled rejection from
that host promise terminates Node under strict rejection handling. Expected
lifecycle behavior surfaces the original abort while observing the existing
host promise's rejection, leaving no separate unhandled rejection. This is not
guest constructor behavior, and the action module is not installed by default
by the plugin. The plugin's tested sink-aborts-parent race passed; no plugin
implementation or adapter bug was confirmed, and plugin runtime is unchanged.

External evidence is `/tmp/safe-bash-safejs-abort-in-action.mjs` and
`/tmp/safe-bash-safejs-abort-in-action.log`; the final review reconfirmed the
observation in `/tmp/safe-bash-safejs-final-action-abort.log`. **There is no
durable executable regression for this newly reported observation.** It is
separate from the existing nine desired probes and adds no passing checks.
This handoff records prose only and does not rerun or reconstruct that evidence.

The review identifies an early-aborted branch in
`src/interp/host-bridge.ts`'s `wrapHostPromiseWithSignal` that returns an abort
rejection without observing the supplied promise. It identifies the same
early-branch risk in `src/interp/cancel.ts`'s `wrapCancelablePromise`.
The **unapplied, unverified high-level proposal** is to observe rejection of
the already-existing promise before returning early for abort in both wrappers.
Keep the returned abort rejection visible to the caller, retain cancellation
semantics and listener cleanup on all paths, and do not introduce global
rejection suppression. Future authorized upstream acceptance would need to
cover synchronous/async abort-then-reject callbacks, delayed rejections and
already-created sandbox promises; those are proposed coverage, not delivered
regressions or additional accepted probes.

### Existing constructor, property and entry-abort proposals

`src/interp/cancel.ts` rebuilds a closure with `async`, `call` and `name`, losing
`construct`, closure `properties`, and retained-value metadata. This explains
both constructor failure and loss of static methods. Its plain-object loop
uses assignment into an object with the original prototype. Assigning an own
`__proto__` key can trigger the inherited setter rather than preserve data.
The host bridge correctly defines own data descriptors before this later copy.

1. Preserve optional construction with the same signal checks and result
   wrapping as invocation. The conceptual closure addition is:

   ```ts
   ...(value.construct === undefined ? {} : {
     construct: (args, context) => {
       if (signal.aborted) throw readAbortReason(signal);
       return wrapCancelableResult(value.construct!(args, context), signal, seen);
     }
   })
   ```

   This fragment alone is **not a complete fix**. Review constructor async/error
   semantics and cancellation observation as part of the actual patch.
2. Preserve and recursively wrap closure properties with the same identity map.
   Register the closure before walking recursive properties. The existing
   `createSandboxClosure` freezes both the closure and supplied properties, so
   simply assigning properties afterward or eagerly copying before registering
   `seen` is incorrect. Design an internal two-phase create/finalize helper (or
   equivalent cycle-safe factory), retaining brands and final immutability.
   Audit retained-value traversal and observability/host-call metadata; do not
   blindly spread a closure and assume non-enumerable fields survived.
3. In the ordinary-object branch, replace assignment with explicit data
   descriptors, preserving keys without invoking inherited setters:

   ```ts
   Object.defineProperty(wrapped, key, {
     value: wrapCancelableValue(entry, signal, seen),
     enumerable: true,
     configurable: true,
     writable: true
   });
   ```

   Keep cycle registration before iteration. Review arrays and other branded
   collections separately; this suggestion is not an audit of every value kind.
4. Add a raw run-entry abort check before guest evaluation, including pure code.
   Audit interpreter checkpoints and async suspension/resumption. An entry
   check alone does not preempt synchronous execution or prove mid-run
   cancellation; retain actual step/deadline checks and cooperative limits.

## Required upstream acceptance after a real patch

- Make all nine desired probes pass with the signal supplied, then expand
  construction coverage to Error subtypes, custom fields and static methods.
- Exercise callable and construct paths, identity/cycles in closure properties,
  frozen descriptors, retained values, and host-call observation/journaling.
- Preserve own `__proto__`, `constructor` and `prototype` keys for string and
  object values without inherited pollution or unauthorized host capabilities.
- Test pre-aborted and pending-operation cancellation, late rejects, cleanup,
  output backpressure, replay/reentry guards and strict rejection handling.
- Run private upstream suites in their authorized environment. This worker
  cannot claim acceptance for a patch not applied to the real engine.

## Corroboration and source identity

The separate read-only reviewer checkpoint at
`/tmp/safe-bash-safejs-upstream-checkpoint.txt` confirms constructor/static loss,
pre-aborted pure-run behavior, own-`__proto__` loss and the separate host-promise
observation. Earlier reviewer counts of 0/6 desired and 12 passing scratch
checks are historical. Its linked final report,
`/tmp/safe-bash-safejs-independent-final-review.txt`, records 0/7 desired and
15 passing scratch checks, separate from the owned nine desired probes.
These overlapping suites must not be summed as distinct defects or acceptance.
The anticipated `/tmp/safe-bash-safejs-upstream-review.txt` was unavailable when
this documentation handoff read the linked final report.

Observed `src/interp/cancel.ts` SHA256:
`7652feb38be7c034e7f98f8e98370835307571fec46647d930908a3c1a23d6e4`.
This file's hash was unchanged in the independent final report, but other
private files changed externally: the earlier 229-file tree is historical.
The report verifies stability only across its August 26 final gate for the
238-file tree with SHA256
`36673b386793b61fca9b65990320a0c57b584d34b833aff85869be79fd810e63`.
See `README.md` in this directory for snapshot-specific hashes and counts.
The actual engine remained read-only to these workers; no proposed fix was
applied or validated here. No superiority, exhaustive sandbox security, Node compatibility or
full product completion claim follows from this focused verification.
