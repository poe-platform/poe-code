# One fixed actual-grep observation

**Completed exactly one product invocation and one selected native exec.**
No retry, enlargement, sweep, native oracle, fallback profile, source change,
additional control run, broad test/typecheck/build or delegation occurred.

## Frozen execution and evidence

- Scripts/protocol committed before execution: `ac84d52f21a2b7a964681f71cfe8030279f6462a`.
- Separate quote-only correction: `3b4784f`; only removed the erroneous trailing
  space/period from the two staged-control refusal quotations.
- Run: August 27, 2026 at 03:47:01.093 UTC (August 26, 22:47:01.093 Chicago).
  Node `v22.22.2`, V8 `12.4.254.21-node.39`; sole owned child PID 23251.
- Exact stdout capture: `evidence/run.json` (705 bytes); parent tool exit status
  0, parent stderr empty. Child observation stdout 232 bytes, stderr 0; product stdout
  and stderr both 0 bytes. No output limit was reached.
- Before hashes at 03:46:52 UTC and after hashes at 03:47:23 UTC:
  `evidence/before.sha256` and `evidence/after.sha256`, all 21 identical.
  Includes all nine loaded product TS files, relevant grep/rg documentation
  and matcher sources, immutable static artifacts, reviewed supervisor and
  executed scripts. These are sequential worktree observations, not an atomic
  snapshot or whole-repository clean-HEAD validation.

Exact parent command (repository cwd):

```sh
node --unhandled-rejections=strict --max-old-space-size=64 --max-semi-space-size=1 --stack-size=512 tests/stress/regex-execution/single-grep/run.mjs
```

Shell resolves Node to `/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node`.
Child launcher uses that runtime's `process.execPath`, with argv:

```text
--unhandled-rejections=strict
--max-old-space-size=64
--max-semi-space-size=1
--stack-size=512
--experimental-strip-types
--no-warnings
/Users/kjopek/Workspace/safe-bash/tests/stress/regex-execution/single-grep/child.mjs
```

Only clean LANG=C/LC_ALL=C child env; shell=false, detached=false, ignored stdin,
bounded pipes and five fixed IPC strings. Current source loaded successfully
through synchronous allowlisted native type stripping, not tsx or a transpiler
service. The executed command was direct actual `grepCommands()`/`execute`, not
Shell/registry dispatch. Literal argv `grep -E '^(a+)+$'`; stdin exactly thirteen
ASCII bytes `aaaaaaaaaaaa!`, no newline. Pattern length seven, flags `g`.

## Result and timing

| Observation | Measured value |
| --- | --- |
| Selected native exec calls | 1; returned null, as frozen |
| Actual grep result | status 1; expected nonmatch, no output |
| Native-call timestamp bracket | 0.533–0.635 ms; 0.102 ms including entry-marker overhead |
| Command completion (child clock) | 0.646 ms |
| Child 5 ms timer armed / delivered | 0.505 / 6.991 ms; 6.486 ms elapsed |
| Signal state at entry / leave / command completion | false / false / false |
| Parent ready / start (parent clock) | 74.529 / 74.548 ms |
| Parent entry / leave / cancellation message receipt | 75.479 / 75.563 / 81.999 ms |
| Planned parent execution deadline | 274.548 ms; did not fire |
| Parent exit / close | 85.432 / 85.442 ms; 10.894 ms start-to-close |
| Child exit / signal; kill request | 0 / none; none |
| Cleanup | exit, disconnect, both streams closed, child close all true |
| Active owned children | **0**; no cleanup warning |

The 5 ms callback was delivered before the parent deadline, after grep already
completed. It called `abort()` on the supplied signal; no executing product
operation observed an already-aborted signal. Delivery was 1.486 ms after the
nominal local delay, but this does **not** attribute scheduling delay to regex:
the measured call and command both ended before the timer was due. There was
no blocked-call, parent-termination or product-abort-delivery observation here.
Entry/leave timestamps bracket instrumentation overhead, not pure engine CPU.

## Safety review, limitations and history

Reviewed corrected `72a0d51` supervisor before use, without rerunning controls;
its current hash matches that revision. New fixed parent strengthened the
cleanup barrier to require all five events before release. Only the owned
handle could be killed; no PID search/group signal/descendant was used.
Static syntax checks passed for all three new scripts; no product execution
occurred during those checks. The one actual run is `completed`; other outcome
branches and watchdog/overflow guards are not dynamically tested here.

Grep's advertised JS translation explicitly lacks hard regex budgets; rg's
advertised cooperative limitation explicitly requires outside isolation for
hard deadlines. Prior research R1–R5 remains documentation, not an experiment.
This quick successful fixed case proves neither a hard-deadline failure nor
general regex safety, preemption, input-size scalability, POSIX/native parity,
rg behavior, superiority, full-shell completion or 72-hour work. No kernel or
total-RSS guarantee follows from 64 MiB old-space flags; peak RSS was unmeasured.

Historical `0d625f3` remains **ZERO probes**, its three artifacts unchanged
(`git diff --quiet` status 0). Preserve controls initial `2cd1673` **1/2**,
corrected `72a0d51` **2/2**, evidence `d6ff6d0`/`6fdb702`, waiting callback
202.467 ms and SIGKILL-to-close 2.046 ms. Initial PATH/glob/inspection errors
and the old cleanup assertion failure were not authorization refusals. No new
refusal occurred. Stop here: this authorization's single case is consumed.
