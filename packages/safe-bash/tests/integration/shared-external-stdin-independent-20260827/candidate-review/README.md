# Independent final candidate review

**Bounded behavior supports the final stdin fix; no genuine candidate bug found. Not an all-green fixture gate.** Root must adjudicate the two remaining provisional primary-read expectations and the verifier's six new column diagnostic mistakes. No assertions were changed, failures relabeled, or product files edited.

Final candidate only: `f8819e9d6b6d535b0626e0aa004bb10a7bc36785`. Author evidence: `87dced967d3a55611fa1d05d6d1df25514c83622`. Intermediate `3af3f628` is not accepted: its genuine primary-read regression was corrected by final `f8819e9d`. Exact final-input and historical-to-final product diffs are retained as evidence data. The final tree also includes separately committed column padding changes; this is not a claim that the entire baseline-to-final product diff is input.ts alone.

## Actual results, kept separate

| Cohort | Prior preserved result | This final candidate |
| --- | --- | --- |
| Original unchanged independent fixture `0ec75ef320ecaea9fc66e1ba952f3961c917685c` | 18/32 | **24/32**, eight failures retained |
| Provisional unchanged fixture `92f7626200d1509cf0efe17e4ee6c3d558f3a277` | 25/35 | **33/35**, two failures retained |
| Frozen bad-swallow / strict late-unhandled controls | Two detected per prior execution | **Two detected in each cohort**, four control executions, separate from behavior |
| Author final 22 tests | Author reports 7/22 before | **22/22**, reproduced author cases, not independent holdouts |
| Author unchanged original 34 observations | 34 characterized, nine actual baseline defects | **25 characterizations match; exactly nine old silent-success assertions differ**, retained exit 1 |
| New post-inspection column supplement | No baseline | **0/6**, all fail the verifier's wrong exact diagnostic expectation |
| Subsequently authorized missing falsy controls | Existing coverage inventoried first | **5/5**, separate postfreeze cohort, no old count changed |

The unchanged author 63-test scope was **not rerun**. No baseline rebuild, global tests, native/performance oracle, risky regex probe, or additional broad cohort. Two original/provisional suites share one build and one actual npm pack. Supplements reuse authenticated copies of that package, not another production build. No actual-source bad-swallow mutant was prepared/run; the frozen adapter and strict-unhandled controls remain the negative-control evidence.

## Every independent failure

- Original `shell-eof-sync`, `shell-eof-reject`, `shell-eof-zero`, and `shell-sequential-nested-binary`: wrong fixture expectation of one external return after observed natural EOF. Actual zero returns is the existing contract. Exact output and source-read assertions precede these failures. Provisional corrections pass unchanged.
- Original `shell-deferred-eof-return`: impossible gate waits for a return that EOF must not call. Exact child exits **13**, unsettled top-level await, not a watchdog timeout. No successful fixture-finally claim. The provisional early-return replacement passes unchanged.
- Original `shell-primary-read-zero/error`: wrong layer expects the original read reason to reject public Shell. Actual ordinary read failures are reported through fulfilled status 1 and original diagnostics. Direct helper identity is independently checked and passes.
- Original `shell-primary-sink-error`: wrong layer expects sink Error as selected public rejection. Final rejects with the outer close Error after the sink diagnostic; one read/return and attempted bytes `00ff` retained. The provisional corrected expectation passes unchanged.
- Provisional `shell-primary-read-zero/error`: still incorrectly demands **secondary closeError** as public rejection. Final fulfills status 1 with `shell: line 1: 0\n` or `shell: line 1: independent-primary-failure\n`, one read/return, empty output. Both failures remain in the denominator; no force-green revision.

### Precise primary-read disagreement and proposal

Final `src/shell/input.ts:56` records a non-aborted source-read failure. Its `:70` catch observes/suppresses a later return error, then still checks cancellation. `src/contracts/io.ts:200` likewise uses a separate failed flag to preserve a primary read reason, including 0, over secondary return failure. `src/shell/runtime.ts:496` preserves its existing ordinary-error status/diagnostic conversion; selected ShellLimitError rejection remains exact. Normal/early/unread closes do **not** set readFailed and do propagate errors. Caller abort still wins by exact identity.

`src/contracts/command.md:84` describes explicitly registered cooperative cleanup drains; its nonzero-result rule does not require treating this unregistered external return as a new overriding primary error after an already reported source-read failure. The provisional static semantic review was baseline-only and did not inspect the final correction. Its old runner criticism is separately closed by `4fa5929a18f952697f7def2bf6a3b7e4940aae23`; that does not automatically approve these final-candidate expectations.

**Proposed only, not applied:** change exactly the two provisional Shell primary-read assertions to fulfilled status 1, original diagnostic, one read/return and no output. Leave direct 0/Error identity, sink close-error rejection, selected-error identity, normal close, abort, disposal, and every other assertion unchanged. Proposal was published before any executable changes; none followed.

## Alias and column boundaries

Author final22 actually includes grep/egrep/fgrep, **not column**. All six Shell alias/grep synchronous/rejected-return tests pass. Exact original34 provides six direct grep/alias controls and five matching column rows: ordinary deferred return waits; disposal/caller-abort interrupts unregistered external return; explicit VFS return blocks exec and concurrent dispose; direct column still waits in finally without a registration hook. These are reproduced author cases, not independently frozen assertions.

The six new post-inspection column rows use the existing benign maxInputBytes:1 schedule, source `a b\n`, synchronous Error/rejected Error/rejected 0. All six assert one read, one return and no output, then fail because this verifier incorrectly expected `column: input limit exceeded\n`. Actual diagnostic is **`column: EFBIG: column input limit exceeded\n`**. Recorded observations show direct status1 versus Shell exact external-return rejection, but subsequent status/identity assertions were **not reached**, so those observations are not six passing tests.

**Exact proposal only:** correct that one diagnostic literal, retaining errno, text, newline and every other assertion. No edit or rerun occurred. All six failures, including raw observations and failure stacks, remain. This is a fixture bug, not a product diagnostic defect. Do not broaden into diagnostic relaxation.

Alias/column factories in this candidate are **packed internal modules**, not root/package exports. Main holdouts load the bare public `virtual-bash` package; author reproductions map original internal imports to their exact packed dist counterparts. Column supplement imports public Shell/registry plus packed internal column. This establishes bounded integration behavior, **not exported-family acceptance** or authority to modify root exports.

## Authentication and timing

- Main adapter committed `dc8e362b5b03a526d9b0bfd90cdcefeca601c590` at 16:06:03Z, before replay 16:06:14Z and first candidate-source inspection **16:06:21Z**. Original fixture committed 15:53:31Z; provisional 15:58:10Z; candidate 15:52:09Z. Therefore **before inspection, NOT before candidate commit**.
- Supplement adapter committed `79f0f917` **after execution**: its attempted earlier commit met a concurrent Git index.lock. No lock was removed. Source/expectations were written before execution and authenticated in the execution input inventory; unchanged source was committed afterward. Do not claim preinspection or committed-before-execution supplement status.
- Subsequently authorized falsy fixture/runner committed **before execution** as `bdb49bb1c2b2c5646e1ed8666bf53ebf3bb6433c`. Exact byte binding is checked before child execution; this remains explicitly post-inspection coverage.
- Main source archive has 228 exact Git-bound files; 247 copied development-tool files. Darwin arm64 Node **v22.22.2**, not the author's Node24 profile. No install or runtime dependency change. Author test TS bytes/assertions are unchanged; TypeScript emits test JS only, with loader source-import routing disclosed.
- Source archive SHA256: `dfa06095b546379bbd11054a95ceabf60884e3738b84e2b2de0a87cd8e0118bf`.
- npm-packed tarball SHA256: `62228b67ca6793544f0f4374ca00fbbb6e627f514f184d5880fd7723ccf179c6`.
- Input TS SHA256: `4214a448a1a076acb297c3ba6a02d72482d488cf8b6df4549498148a012e5c32`.
- **Actually loaded input JS SHA256:** `f8b984b6fc338ff3d1ca60e10283ab100d8e62a697f4b7f8e691819c28ea7c4a`.

Source/build/tools and moved consumer inventories match before/after, including **new entries**, directory/file types, modes, sizes and bytes. Every nonbuiltin loaded module is bound to those inventories; no live dist or implicit HEAD. Supplement verifies the original source and consumer unchanged again. Strict unhandled mode, readiness gates, 60-second exact-child watchdogs (180 seconds setup), no expiries or output-limit waivers. Original EOF gate failure is retained, not timeout-waived. Frozen controls mutate only a scratch iterator adapter / intentionally unobserved promise fork, **not candidate source**.

## Evidence and scope

`SEAL.json` binds 172 exact captured files, including raw fixture bytes, command receipts, all failure rows, load receipts, full inventory authentication, reference diffs, and early proposal markers. The read-only verifier checks Git source/fixture/adapter binding and append-aware capture integrity; it never reruns probes or rewrites committed evidence:

```sh
node tests/integration/shared-external-stdin-independent-20260827/candidate-review/verify.mjs
```

`falsy-SEAL.json` separately binds seven additional capture files without changing the original seal/captures. All five authorized rows pass: direct null/undefined primary reasons remain exact despite secondary Error; Shell null/undefined produce status1 and exact original diagnostics, with one read/return and no output. `abort(undefined)` produces the **native DOMException AbortError**, preserved as the exact `signal.reason`, not undefined; zero reads, one return, and controlled late return rejection observed. Existing return-cleanup 0/null/undefined coverage is not duplicated or confused with absence of rejection. The original historical evidence verifier also passes unchanged (171 files, original18/32, provisional25/35). The new read-only verifier's first run had a Git ls-tree cwd setup defect; rooting Git at the repository corrected that metadata check without altering any probe or capture.

Exact caller 0/Error, primary direct read identity, selected rejection, no extra reads/double close, sequential shared stdin, sibling isolation, opaque pending async-generator limits, late rejected next/return observation, and explicit registered host/VFS normal/disposal waits pass in the unchanged compatible independent cases. No new API, no opaque hard retirement, no post-disposal external-return barrier. No active owned children/servers remain; only inert candidate-prefixed scratch is retained. Original fixtures/evidence, foreign staging, source, package config/exports and dependencies were untouched. This bounded work is neither 72-hour completion, universal parity, superiority, nor full release acceptance.
