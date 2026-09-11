# Atomics.pause

The Node 24.18.0 callable audit (14468) found Atomics.pause present natively and
absent in SafeJS. The [current specification](https://tc39.es/ecma262/multipage/structured-data.html#sec-atomics.pause)
defines a zero-argument CPU spin-wait hint returning undefined. Arguments have
no specified processing. The [finished-proposal table](https://raw.githubusercontent.com/tc39/proposals/main/finished-proposals.md)
lists expected publication in 2027; classify this as additional modern language
support, not a claim about the published 2026 API surface.

Installed Node 24.18.0 and Node 26.4.0 still reject non-integer supplied hint
arguments, including null and symbols. Their old argument behavior is not the
oracle for the current specification. If a host hint exists, invoke it without
guest arguments. On older hosts without the hint, return undefined without
blocking or inventing a timer delay. Charge the ordinary step budget in both
paths. Register the function normally for intrinsic identity and replay.

Three regression cases failed before implementation (3131): method metadata
and non-constructibility, ignored arguments/receivers with a throwing proxy,
and alias/property preservation through completed public replay. All three
passed after implementation (75559). The later budget control correctly threw
at the second call with a one-step limit, but initially expected the option name
maxSteps rather than the existing error category steps. Broader run 98649
reported 111 passes and that single assertion failure. The corrected control
asserts category steps, current 2, limit 1; the same eight-file, 112-case
selection is rerunning as 82248.

Remaining verification includes the native-hint path on installed Node 24,
focused lint and maintained build/type checks, plus independent qualification
without the main tree's unrelated pending changes. README and CLI spot checks
must accurately distinguish local support from delivery. No push or release
is authorized; no completed atomic implementation commit is claimed yet.

Corrected run 82248 passed all 112 tests across eight files. Installed Node
24.18.0 then passed the four pause cases (30885), exercising the host-hint path;
the ordinary Node 22 run exercises the fallback. This does not qualify the
unrelated full-worktree changes or resolve the earlier full-suite timeouts.

## Independent qualification

The isolated candidate is based on `2d50ea205` and includes only this feature's
implementation, regression test, README paragraph and plan. It excludes the
pending prototype-origin, compiler-route and weak-reference integration work.
The maintained selected build passed all 23 dependency-closure tasks and four
fresh native ESM import checks (37078). Its eight-file selection passed all
112 tests (10487). All 1,331 tracked SafeJS source/test/script/manifest blobs
match the private index after verification (90d3db).

Built CLI checks passed on Node 18.18.2 (48968f) and Node 24.18.0 (9d1779),
both reporting name pause, length zero and undefined return for an object
argument whose coercion throws. The Node 22 CLI screenshot (85989) was visually
reviewed and shows the same successful result. Main-tree scoped lint passed
(93027); isolated scoped lint is still running as 92923 and must finish before
the local commit. No full-suite or release-success claim is implied.

Isolated scoped lint 92923 completed successfully with exit zero. Independent
qualification is complete for this focused addition, not for the entire
worktree. The atomic commit includes only atomics.ts, atomics-pause.test.ts,
the pause README paragraph and this plan. Other README edits and all unrelated
staged/unstaged work remain outside it. Publication remains held.
