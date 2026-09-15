# qualify-async-job-order — qualification receipts

## Scope, source and target

Execution date: 2026-09-13. Owner: `qualify-async-job-order`, including Promise feature categories F-124 through F-129 and async functions/iteration F-018/F-019. Recovery coordination belongs to `qualify-realms-and-recovery`; native Promise authority boundaries remain coordinated with `repair-promise-symbol-admission`.

The compatibility target remains **ECMA-262 edition 16 / June 2025**, with the baseline's separately pinned extensions unchanged. Test262 is the clean checkout at `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, `/tmp/safejs-baseline-test262-419d3e0`. Its newer fixtures do not silently replace that edition. `Promise.try` and `Promise.withResolvers` are base-edition APIs here. Array.fromAsync, await-dictionary and other separately tracked proposals are not newly adopted by this execution.

The branch is `main`. Inspected HEAD: `bc6107ba5a308e94335f2d419d51d122ed17e6c3`; actual remote main from `git ls-remote origin refs/heads/main`: `8e890a5324a52a76a0a67da6ff0503efda76cb6b`. They have three local-only and fourteen remote-only commits. This is **qualification of the dirty worktree**, not a claim that HEAD alone or remote main contains the candidate. [Initial environment and file fingerprints](environment.json), [candidate source fingerprints](candidate-source.json), and the pinned reports' source hashes identify the tested bytes. `candidate-runtime.patch` is the complete six-file working diff and therefore includes earlier unrelated interpreter edits; it is not an authorization to commit that whole diff.

Local environment: Node **22.23.2**, ICU **78.2**, V8 **12.4.254.21-node.56**, Darwin arm64. Root AGENTS.md and the instructions supplied in the task apply. The ancestor AGENTS.md mentioned in historical evidence is absent in this environment; no nested safe-js instructions were found. Existing local and staged changes were preserved. No README, budgets, timeouts, runtime support, upstream fixtures, or public host grants were changed.

## Specification and repairs

Primary algorithms:

- [Promise(executor)](https://262.ecma-international.org/16.0/#sec-promise-executor) and [AsyncFunctionStart](https://262.ecma-international.org/16.0/#sec-async-functions-abstract-operations-async-function-start) govern synchronous prefixes. [Promise.all](https://262.ecma-international.org/16.0/#sec-promise.all), [allSettled](https://262.ecma-international.org/16.0/#sec-promise.allsettled), [any](https://262.ecma-international.org/16.0/#sec-promise.any) and [race](https://262.ecma-international.org/16.0/#sec-promise.race) govern aggregate iteration, input indexing and settlement.
- [Promise Resolve Functions](https://262.ecma-international.org/16.0/#sec-promise-resolve-functions), [NewPromiseResolveThenableJob](https://262.ecma-international.org/16.0/#sec-newpromiseresolvethenablejob), [NewPromiseReactionJob](https://262.ecma-international.org/16.0/#sec-newpromisereactionjob) and [Await](https://262.ecma-international.org/16.0/#await): resolution locks before reading `then`; the getter runs synchronously; callable assimilation and reactions run as jobs.
- [AsyncGeneratorStart](https://262.ecma-international.org/16.0/#sec-asyncgeneratorstart), [AsyncGeneratorUnwrapYieldResumption](https://262.ecma-international.org/16.0/#sec-asyncgeneratorunwrapyieldresumption), and [yield evaluation](https://262.ecma-international.org/16.0/#sec-generator-function-definitions-runtime-semantics-evaluation): body return and return resumption already await their values; a missing delegate `return` has its own additional await.
- [Promise.prototype.finally](https://262.ecma-international.org/16.0/#sec-promise.prototype.finally): generated handlers have length one; completion replacement follows the finalizer outcome.
- [AsyncIteratorClose](https://262.ecma-international.org/16.0/#sec-asynciteratorclose): await cleanup; preserve an existing throw over a cleanup throw.

### AJ-1: duplicate async-generator return assimilation — product defect

Smallest regression: `async function* f(){return value}` with `value = { get then(){ reads++; } }`; expected one read, actual two. A queued `g.return(value)` after `g.next()` similarly produced `start, tick 1, get then, tick 2, get then`, instead of `start, tick 1, get then, tick 2`. The native Node22 control agrees with the published algorithm. Neighboring controls returning into an unstarted or completed generator already performed exactly one read.

Before editing runtime code, `npx vitest run packages/safe-js/test/async-generator-return-order.test.ts` failed in **113 ms** at the initial source above: [red receipt](generator-red.log). The expanded control run had three failures and two passes in **261 ms**: [control receipt](generator-controls-red.log). Pinned `language/statements/async-generator/yield-return-then-getter-ticks.js` failed both variants in [initial pinned results](pinned.jsonl).

Repair: the driver awaits a return only when it bypasses the generator body. The first candidate revealed a necessary neighboring dependency: `yield*` with no delegate `return` had been relying on that broad driver await. [Intermediate failing regression](delegated-red.log) records the missing second getter read. That await now occurs at the missing-method delegation step, with an explicit `return` continuation phase. Snapshot encoding already carries optional phase/completion fields; validation now checks the new phase's return completion, absent iterator-await metadata, and AST position. A direct pending restoration test first exposed a missing AST admission rule ([restore failure](restore-finally-first.log)); the completed repair passes [direct restore and malformed-state tests](restore-green.log).

This is one coherent generator repair, including preservation of the neighboring delegated case. Tests cover direct body returns, suspended/unstarted/completed returns, FIFO tick traces, pending structural restoration, replay restoration, completed replay, and rejected malformed states. No getter suppression or extra host authority is used to hide the duplicate effect.

### AJ-2: finally handler arity — product defect

Smallest counterexample: override `p.then = (a,b) => [a.length,b.length]`, then call `p.finally(() => {})`. Expected `[1,1]`, actual `[0,0]`. Noncallable `finally(7)` passing `[7,7]` through unchanged is the neighboring passing control. The pinned `built-ins/Promise/prototype/finally/invokes-then-with-function.js` confirms this independently.

Before repair, `npx vitest run packages/safe-js/test/promise-finally-handler-metadata.test.ts` had one failure and one pass in **134 ms**: [red receipt](finally-red.log). Repair explicitly supplies anonymous names and length one when creating the two handlers. [Green receipt](restore-finally-first.log) records both metadata tests passing. Constructibility and pass-through assertions remain intact.

## Independent traces and host authority

[Ordering tests](../../../packages/safe-js/test/async-job-order-qualification.test.ts) use literal, specification-derived traces, with native execution as a control. Each of nine guest traces is repeated through original execution, pending replay restore, and completed replay. The traces cover executor prefixes, nested assimilation, reentrant getter resolution, FIFO registration inside reactions, async-function prefixes, generator request queues, both generator-return cases, all/allSettled/any/race, empty aggregates, finally preservation/replacement, and for-await break cleanup.

Explicit deferred host gates acknowledge entry before capture. Pending `re-issue` operations execute once per live continuation, while completed replay suppresses consumed operations. Two further cells use a host callback that mutates shared guest state before/after suspension: `prefix:1, reaction:2, callback:3, after:4`. A `read-side-effect` host operation is not reissued; its resume provider joins the recorded callback result. An operation after the checkpoint must run in both live continuations and must not run again during completed replay. Both already-settled and pending host results are checked, including rejected results.

The test helper's existing finite 8192-notification bound is unchanged. No sleep, timer race, GC/finalization assumption, external service or LLM supplies ordering. Subprocess deadlines are failure guards, not scheduling controls. Snapshot wire round trips use memory, not files.

[Lifecycle tests](../../../packages/safe-js/test/async-lifecycle-qualification.test.ts) establish guest finally-before-catch on cancellation for async functions and generators, awaited for-await cleanup and throw precedence, and realm-close revocation/extension cleanup. Existing pending async continuation tests separately revalidate cancellation after structural restoration. A closed realm has no public restoration contract; it revokes callbacks and rejects later invocation.

Two initial probe expectations were **contract misclassifications**, not runtime repairs:

- [Realm-close probe](lifecycle-first.log) expected a guest `finally` block to call a host operation after close. `RealmState.close` sets `closed` before abort; `assertOpen` revokes that authority. The corrected test asserts no guest host calls and waits on a deferred extension-cleanup gate. Ordinary run cancellation still separately requires guest finally execution. Granting host calls during close would violate the boundary.
- [Rejected-host probe](focused-final.log) expected a primitive host-operation rejection to stay a string. `host-bridge.ts:createHostErrorValue` deliberately normalizes it to a guest Error. The final test asserts `Error:reason` in original/pending/completed phases; guest `Promise.reject('reason')` is separately required to preserve the primitive. The original failures remain recorded.

## Unhandled-rejection policy, separately qualified

[HostPromiseRejectionTracker](https://262.ecma-international.org/16.0/#sec-host-promise-rejection-tracker) is host-defined. SafeJS's one-shot embedding checks for unobserved guest rejections at completion and rejects the host run with `UnhandledRejectionError`. Attaching a handler before completion handles the rejection; `.then()` without a rejection handler transfers the obligation to its derived promise. Direct late observation removes a subsequent tracker report, but cannot undo an already returned error. Fatal budget/reentry rejection is independently sticky. The tracker has a finite 20-native-microtask observation flush; this is an implementation detail, **not** a claim to observe arbitrarily delayed external failures after run completion.

[Separate policy tests](../../../packages/safe-js/test/async-rejection-policy-qualification.test.ts) cover these distinctions. Native Promise policy is not the conformance oracle.

The pinned runner also applies rejection-fatal policy. Fourteen final variants intentionally leave rejected promises unobserved and therefore remain **failed / unhandled-rejection**, not semantic passes. A separate read-only execution of the exact original fixture/harness bytes records normal synchronous assertion completion followed by a rejection at settlement: [policy separation receipt](pinned-policy-separation.json). The two `Promise.any` neighboring fixtures handle their result and settle normally. No fixture was patched and no runner assertion/policy was weakened.

## Pinned fixture results and edition reconciliation

Commands are exact argument arrays in [initial](pinned-command.json), [expanded candidate](pinned-after-command.json), and [final](pinned-final-command.json) receipts. Execute an array with `subprocess.run(json.load(open(path)), check=False)` from the repository root. They invoke the maintained `npm run test:conformance --workspace=@poe-code/safe-js -- ...` route with its unchanged **3000 ms** variant deadline and default budget configuration.

| Invocation | Variants | Passed | Failed | Unsupported | Disposition                                                     |
| ---------- | -------: | -----: | -----: | ----------: | --------------------------------------------------------------- |
| Initial    |       50 |     36 |     14 |           0 | 12 rejection-policy failures; 2 generator defect variants       |
| Final      |      170 |    152 |     18 |           0 | 14 rejection-policy failures; 4 post-edition contract conflicts |

[Final report](pinned-final.jsonl) has zero metadata/execution errors and is terminal/complete. Its exit is **1**, accurately retained. Both repaired generator fixtures and the finally metadata fixture pass. Additional selections include await interleaving, thenables, for-await iterator closure, all finally fixtures, Promise.try and withResolvers.

The four remaining non-policy failures are the two variants each of `Promise/try/avoids-wrap.js` and `avoids-wrap-for-subclass.js`, copyright 2026. They require reusing a returned Promise. [ECMA-262 2025 Promise.try](https://262.ecma-international.org/16.0/#sec-promise.try) instead creates a new capability before calling the callback and returns that capability's promise. SafeJS's new-promise behavior matches the pinned **edition** and its maintained neighboring tests. These upstream fixtures are explicitly **post-edition contract conflicts**, not a reason to change the target or the runtime. Future adoption requires separate contract approval/qualification. The raw failures remain visible.

## Runtime receipts

[Exact records](runtime-disposition.json) separate native controls from SafeJS results. Nine traces × original/pending/completed modes pass in every Node/Bun cell, with exactly two host gate calls per three-phase exercise. The first aggregate probe required native agreement too; its exit 1 on Node18/Bun is retained in [command receipts](runtime-commands.json). Direct comparison of its immutable trace records against the same literal expectations establishes zero SafeJS failures; this is a partition, not a hidden successful rerun.

| Runtime                                      | ICU                       | SafeJS traces        | Native control differences               |
| -------------------------------------------- | ------------------------- | -------------------- | ---------------------------------------- |
| Node 18.18.0 minimum                         | 73.2                      | 9/9, all three modes | one delegated-return ordering difference |
| Node 18.20.8                                 | 74.2                      | 9/9, all three modes | same difference                          |
| Node 20.20.0                                 | 77.1                      | 9/9, all three modes | none                                     |
| Node 22.23.2                                 | 78.2                      | 9/9, all three modes | none                                     |
| Node 24.14.0                                 | 78.2                      | 9/9, all three modes | none                                     |
| Node 26.8.2                                  | 78.3                      | 9/9, all three modes | none                                     |
| Bun 1.3.11                                   | 74.2                      | 9/9, all three modes | same delegated-return difference         |
| Workerd 2026-09-11, compatibility 2026-09-01 | not exposed in this probe | 9/9 original         | native dynamic code generation not used  |

Workerd uses the maintained `resolveWorkerdRuntimeBuild` options and public `workerd` entrypoint. [Build receipt](workerd-build.log), [version](workerd-version.log), [test](workerd-test.log): pass in 316.107 ms. It has no public dump/restore exports; pending/completed public recovery on that entrypoint is a capability boundary, not an ECMAScript failure. The informational nodejs_compat-default warning remains in the receipt. No filesystem or network capability is granted to guest code.

Node26 was downloaded from the official nodejs.org v26.8.2 archive and checked against its official SHASUMS256.txt before extraction. Other Node binaries are existing nvm installations; Bun is the existing installed binary. These are built-source checks, not installed published-artifact or release receipts.

## Verification and delivery state

- Maintained selected build: `npm run build:workspaces -- --workspace=@poe-code/safe-js` passed, including eight built-import postbuild checks: [receipt](build.log).
- Changed-file ESLint passed: [receipt](lint-final.log). Focused final semantic/snapshot/policy verification and package-suite terminal disposition are recorded in the ledger after this file's initial creation.
- No visual CLI language or layout changed; no screenshot test was added. Manual QA is the review checklist below.
- **Local commits:** none created by this task so far. **Remote-main delivery:** none. **Release/publication:** none. Existing releases do not qualify these repairs. Remote divergence and dirty-source provenance are explicit; this task did not merge, reset, push, or republish unrelated work.

Semantic qualification of the selected cases is distinct from broad compatibility closure. Full corpus coverage, unrelated categories and adoption of post-edition Promise.try semantics are not claimed. Do not mark the overall task complete until the maintained-check, preservation and delivery disposition in the main ledger is terminal.

## Manual review checklist

1. Read the literal expectations against the linked 2025 algorithms before consulting native output.
2. Inspect red receipts before the runtime patch; verify the neighboring passing controls and intermediate delegated regression are retained.
3. Compare original/resumed/replayed values and host-call counts in each runtime JSON. Keep native-control differences separate.
4. Verify the pinned final report is complete, source-pinned, and totals 170 variants without turning policy/conflict rows into passes.
5. Inspect lifecycle gates and resume proofs; ensure no timer/GC ordering assumption or host authority expansion appears.
6. Check the initial staged-diff hash and unrelated file preservation. Review only task-owned hunks in the already-modified interpreter and append-only evidence ledger.
7. Report local commit, verified remote main and release publication separately; an empty receipt is not a successful release.

## Additional receipt notes

The expanded intermediate pinned run had **128 variants: 110 passed, 18 failed**, exit 1. Its failures comprise fourteen policy failures, the two finally-arity variants, and the two delegated-return variants exposed by the first generator candidate. Source hashes are `46b542e7418807d8e8bd48afc9769617903a6248b14643ea91a02fb28fc3ebda` (initial), `d3fd9ba0bf879f06ef6541c891c4b703e4f20c65dc03112a790b17a4762f5514` (intermediate), and `2f863dc2167796f6e081d7b2147ca77ea469e5017c0fc00b4b22cbeb9d014d3c` (final). The hashes include maintained runner and workspace source/build inputs, not just HEAD.

[Task-only runtime patch](task-runtime.patch) excludes every unrelated interpreter hunk. A read-only inverse comparison in memory reproduces all six original runtime fingerprints exactly: [hunk preservation](task-hunk-preservation.json). No inverse patch was applied to working files.

Read-only delivery observations: [remote main](observed-remote-main.txt) remains `8e890a5…`; [workflow list](observed-release-runs.json) includes successful Release workflow `34748657709` at that SHA and two cancelled predecessor workflows. Workflow success alone does not prove a publication. [Registry root observation](observed-root-release.json) reports `poe-code@15.0.31` at `04b784cd0c85d9e4c93d1ae694f94ca9a4d8acd7`; [scoped observation](observed-scoped-release.json) reports `@poe-platform/safe-js@0.1.568` with engine `>=18.18`, but returned no gitHead. None contains or qualifies this uncommitted candidate. [Official Node26 download verification](node26-download.json) separately records the runtime archive checksum.

Setup failures: the web reader rejected the large official ECMA-262 page; direct HTTPS download succeeded. The first extraction attempt failed because Python `bs4` was unavailable; the standard-library HTML parser extracted the selected algorithms instead. An overbroad ancestor-file inventory was terminated after the applicable root/nested paths were established with a narrower search. These are tooling/setup outcomes, not conformance results. No dependency, assertion, runtime or timeout was changed to accommodate them.

## Cancellation completion replay

A further deterministic built-SDK probe closes the cancellation replay cell: original execution and restoration of the pending host gate both receive an explicit `AbortController.abort(new Error('stop'))` only after gate-entry acknowledgement. Both return `['finally','stop']`. Capturing that completed result and replaying it **without a new abort** returns the same trace. Host gate calls total exactly two; completed replay adds none. [Complete source, versions and outcomes](cancellation-replay-probe.json). This is the embedding cancellation contract, not a native-engine ECMAScript cancellation primitive. All phases use the unchanged 8192-notification failure bound, and no sleep or GC assumption.

The six repaired runtime files have identical Git blobs at inspected local HEAD `bc6107ba5…` and remote main `8e890a5…`: [exact comparison](remote-source-comparison.json). Thus the relevant remote code still contains both faulty implementations. This is read-only source equivalence for those files, not a claim to have executed the whole remote tree or delivered the repairs there.

Ad-hoc visual CLI validation also passed through the maintained screenshot tool: `npm run screenshot -- node packages/safe-js/dist/cli.js docs/plans/qualify-async-job-order/ordering.safejs` ([command receipt](cli-screenshot.log)). The inspected terminal PNG shows a readable, unclipped successful JSON result with trace `start, tick 1, get then, tick 2` and handler lengths `[1,1]`. The screenshot remains an ad-hoc artifact at `screenshots/node-packages-safe-js-dist-cli.js-docs-plans-qualify-async-job-order-ordering.safejs.png`; no screenshot test or CLI layout change was introduced. The scoped generic route targets the actual SafeJS executable without rebuilding the unrelated root CLI during frozen-source verification.

## Terminal result

The maintained final package suite passed: **29,527 tests passed, zero failed, 47 skipped**, across **1,359 passing/two skipped files**, in **1,441.94 seconds**, exit **0**. [Full log](package-test-final.log), [terminal counts](terminal-checks.json), and [unchanged source provenance](terminal-source-provenance.json). Focused verification passed **132 tests**, build/postbuild and lint passed, and the ad-hoc CLI screenshot was inspected. Earlier running/open statements in this record are historical.

Local repair commits are `26d6b7722ad5da347f7c08a7386f953b6e1eab10` and `cff1a62cdedc5072d56deada513c576211083f5a`; [receipt](local-repair-commits.json). Qualification tests and evidence form their own subsequent local commit. The original staged diff remains unchanged, and task-only inverse comparison reproduces every initial runtime fingerprint. The stated local acceptance is evidenced; **no remote delivery or release was performed or claimed**. No push was requested.

The first isolated evidence-staging check rejected extra terminal blank lines in sixteen tool-generated logs. Only those trailing newline bytes were normalized; all command/result/failure/skip lines remain intact. [Original and normalized hashes](log-normalization.json) record the exact formatting-only change. No runtime, test, deadline or assertion was changed, and no hook was bypassed.
