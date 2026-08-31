# Frozen RegExp search: independent final source review

Date: 2026-08-30. Author: Newton; reviewer: independent root-assigned reviewer. **READY for the exact bounded three-path source candidate below.** This is not whole-SafeJS security certification, sticky activation, or actual published-artifact approval.

Major validation CPU finished and was released at **2026-08-30T16:59:01Z**. No validation task remains running. Subsequent work is LIGHT receipt verification and sealing only.

## Exact candidate and isolation

- Base: `5dafe7a59bf21da7365befe60e6b4d8d901e8669`, unchanged reviewer main throughout validation.
- Author manifest: `0452f45f2c7ff830c8f5f74772978210d45c15d4b735b789afdf9f9e0ab3c046`.
- Author patch: `834d3fa78ff953db4a508c8d3901ef82de8ace99d35e5c0d07f97de722585eb0`.
- Private input: `out/safejs-remediation/frozen-search-independent-review/intake-0452f45f/candidate-5dafe7a-sealed-20260830`.
- Independent receipts: `out/safejs-remediation/frozen-search-independent-review/validation-0452f45f`.
- Prior static/intake reports remain unchanged: hashes `a6ddbbaf19427b94e6f0a8dfff31c2335fa663d33a7671ea7b6a092bce656530` and `c80cf54282660ef4d0a83a7f6d8135d83cc2e62ef2ed86dbe3257abc97a62dc0`.

| Publication path                                                   | Exact preimage SHA-256                                             | Exact postimage SHA-256                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `packages/safe-js/src/interp/methods/string.ts`                    | `157c7aaa4f16e239aa278ec4888cd3de6da1c4a021a55dec0b73f96669d7ccfd` | `b657dacb191381fac83c2d7d6de258bb464b2758c3e8a8d4e7d5e35eecd93178` |
| `packages/safe-js/src/interp/methods/string-search-frozen.test.ts` | absent                                                             | `0418fe7b99b461ed0b7a27bab11ea9fc496110476c77fafae33d58264b508fa6` |
| `docs/plans/safejs-frozen-regexp-search-20260830.md`               | absent                                                             | `b4410029c76452102836d53aee8aa4a5e1c48bb9e4610492868d3ea9f21e0d6f` |

Independent forward check passed; the applied files match all three sealed postimages after validation. The only tracked production diff is the author's two conditional `Object.is` writes. No independent production fix was authored. The extra one-case validation test was preserved in reviewer evidence and removed from package discovery before the single DEFAULT run. Author/original workspaces, earlier capsules, README, ledger, home and Git publication state were untouched.

## Independent execution results

All logs below are relative to the independent receipt directory's `logs` folder. Exit values are raw, including expected baseline failures; no RED exit was rewritten to zero.

| Gate                                         | Result                                                            |                         Exit | Receipt                                        |
| -------------------------------------------- | ----------------------------------------------------------------- | ---------------------------: | ---------------------------------------------- |
| Qualified baseline source                    | 4 failed / 9 passed, 13 cases                                     |                            1 | `source-baseline.log`                          |
| Fresh baseline public SDK/native comparison  | 4 failed / 9 passed; S01/S02/S05/S06                              |                            1 | `public-baseline.log`                          |
| Candidate source                             | 13 passed                                                         | 0, shared focused invocation | `source-candidate-and-abrupt.log`              |
| One internal abrupt control                  | 1 passed                                                          | 0, shared focused invocation | `source-candidate-and-abrupt.log`              |
| Fresh candidate public SDK/native comparison | 13 passed / 0 failed                                              |                            0 | `public-candidate.log`                         |
| DEFAULT SafeJS, exactly once                 | 9,383 passed / 39 skipped / 0 failed; 245 files passed, 1 skipped |                            0 | `DEFAULT_SAFEJS.log`, `default-safejs.json`    |
| Baseline prerequisite/SafeJS build           | 23 verified workspace tasks, every exit 0                         |                            0 | `build-baseline.log`, `build-task-exits.jsonl` |
| Candidate SafeJS-only rebuild                | passed, production types included                                 |                            0 | `build-candidate.log`                          |
| Expanded new-test types                      | passed                                                            |                            0 | `SCOPED_TYPES.log`                             |
| Changed source/test ESLint                   | passed                                                            |                            0 | `SCOPED_LINT.log`                              |
| Configured format, all three final paths     | passed, no edits                                                  |                            0 | `SCOPED_FORMAT.log`                            |
| Patch whitespace check                       | passed                                                            |                            0 | `DIFF_CHECK.log`                               |

The focused invocation passed 14 tests total: the sealed 13 plus exactly one independent abrupt control. DEFAULT includes the sealed 13 again; these rows must not be added together as distinct recipes. The default suite's 39 skipped identities were extracted from its JSON report and retained in `adjudicated-counts.json`; they belong to the unchanged parser-fuzz, fs-conformance and test262-semantics roots. No skip, slow/fuzz opt-in, timeout, assertion or limit was changed. No second DEFAULT or full-root suite ran.

No ordinary fixture/setup correction was needed. Both planned baseline failures and all original author nonpassing receipts remain available. No product defect was found requiring an author revision.

## Public scope and build identity

The same thirteen-case adapter in `docs/plans/safejs-frozen-search-independent-execution-20260830.md` ran unchanged through ordinary Node at both stages. It imported `poe-code/safe-js` and asserted resolution to this reviewer's own `packages/safe-js/dist/index.js`, not Vitest source aliases or another workspace. The baseline source test was present, but baseline production still matched its preimage when built and executed.

| Identity                                         | Baseline                                                           | Candidate                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Compiled `dist/interp/methods/string.js` SHA-256 | `7de876318f072388d248a3359acfc6c0b678c3c011c0c6e96582268a58a8bc77` | `a72f851f995566286c317c64e4b8a512bb3822955cd446e8917e4be2230311d2` |
| Public entry SHA-256                             | `2fef744184e826cafa5a7e6d9b59749ea5822e3c1a0d0fd3ac7440f4d639e92e` | unchanged; the implementation dependency changed                   |
| Public Node PID                                  | 39161                                                              | 40824                                                              |

This proves the canonical **source-built SDK** boundary for these recipes. It does not rerun Laplace's actual 13.0.5 canonical/legacy artifact campaign or approve an unpublished frozen-search release artifact. Root's separate actual-alias completion/receipt remains its own evidence.

## Qualification and behavior adjudication

The two S03/S04 assertion qualifications are accepted only as boundary projection: native execution must throw native TypeError, while the SDK must reject with the existing surfaced record named TypeError. Raw native and sandbox exceptions, own descriptors, messages, stacks and host-instance observations were logged separately before comparing completion channel/name. Successful values and caught arrays use complete deep-strict equality, retaining -0 and NaN. No host-prototype, native-message or native-stack equality is claimed. A fulfilled interpreter-failure result is a distinct mismatch, not a rejection substitute.

Preserve original author **6 failed / 7 passed**, then qualified **4 failed / 9 passed**. Independent baseline reproduces the qualified four and fixes precisely those four after application. The two host-instance expectation changes are not counted as two additional runtime defects fixed.

The two-write implementation matches the previously cited SameValue search contract. Frozen non-global +0 hit/miss now avoids redundant writes; frozen initial -0/1/NaN still fails the required initial write. Frozen global hit and miss still fail the execution write, including a same-valued +0 miss. Mutable -0 restoration remains exact. Brand checking, receiver/input selection, execution call ordering, synchronous owner cleanup, flags and budgets are unchanged.

The additional abrupt control starts a genuine internal regex at -0, observes +0 at the execution boundary, and throws one unique sentinel. It passed exact sentinel identity, one call with the same receiver/input, cursor remaining +0, unrelated seven-unit ticket preservation, cleanup to zero, and subsequent owner acquisition. Therefore the tested implementation does not restore in a finally after that abrupt execution. This is one internal control-flow witness, not public custom-exec support or proof of every possible abrupt identity.

## Still open, not waived

Seventeen original observations map to thirteen unique recipes. Fourteen future-y observations are excluded and remain unexecuted in this review. The three raw-cursor observations remain overall JavaScript gaps: frozen string `"0"`, and object-cursor identity/valueOf ordering with frozen false/true. No raw-cursor domain widening occurred. No `y`, Unicode, flag record, async-owner or compile-accounting change was applied; the earlier future-y budget decision remains unactivated.

No new security campaign, original audit payload read, original C06 copy, native matching fallback, dependency remediation or general language expansion was needed. Existing install warnings are not security clearance.

## Setup, resource and CPU receipts

Initial free-space observation was approximately 2.8 GiB, not the earlier 2.9 GiB assumption and not an 8 GiB prerequisite. Node v22.22.2, npm 10.9.7, Darwin arm64, ABI 127 match the author environment. Root/package/lock pins were checked; lock SHA remains `60234a6893f09468ac19cfc69682b9d462de4fb6ff9f29db2feb6e366a996063` after execution.

Same-lock dependencies were copied from the named author source workspace with APFS copy-on-write `cp -cR`; no shared writable donor modules/dist. A complete dependency-symlink walk found 109 links, all targeted inside the reviewer workspace; representative module files have different inodes and link count one. Donor normal postinstall/prepare receipts were inspected. The reviewer did not reinstall or bypass hooks. Private HOME, config, cache and TMP were used; TERM and slow/fuzz opt-ins were unset, and only `SKIP_SYNC_SKILLS=1` was enabled for source setup/build. No HUSKY=0 or ignore-scripts.

The fresh filtered dry graph contained 23 tasks, independently checked against local workspace build commands and the exact prerequisite closure. All 23 ran serially, followed later by one SafeJS-only rebuild; no 69-task graph or full-root build executed. Logs preserve each npm task PID and exit.

Heavy completion: **16:59:01Z**. Final gate supervisor PID 41200; DEFAULT PID 41215; types 41682; lint 41693; format 41711; diff check 41722. Baseline build supervisor 36929, public processes 39161/40824, and all final-gate/supervisor PIDs checked after release were absent (`ps` exit 1 means no requested process found). The 23 build-child exits are individually recorded. Source focused shell PIDs were 36483 and 39869; candidate rebuild shell PID 40785. CPU release was reported immediately; subsequent log parsing and document sealing do not rerun validation.

Publisher may use only the exact three-path packet with its preimage checks. Any source, test, lock or integration delta requires a corresponding review, not whole-file overwrite or reuse of these results for changed bytes. Actual publication and artifact approval remain with root/publisher.
