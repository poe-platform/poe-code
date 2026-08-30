# Independent shared-stdin fixture-v2 review

## Verdict — 2026-08-27

**Accept the bounded fixture reconciliation** `8e5fec07ec9a39582987736269bbed51caeb795e`, independently replayed against actual product `f8819e9d6b6d535b0626e0aa004bb10a7bc36785`. No product change, source mutant, expectation waiver, or whole-product acceptance is made here. Public aliases/column integration still requires the separate final combined module review and root authorization.

The reviewer audited every authorized assertion delta, authenticated the old and new fixture/evidence bytes, ran the unchanged author runner on the preserved moved npm package, then authored and executed four additional assertion controls. Harness `b67eabd2` was committed after these executions; the evidence does not claim pre-execution sealing of that harness.

## Exact changes reviewed

- Two `shell-primary-read-zero/error` assertions now require a fulfilled result with **exitCode 1**, rather than rejection with the secondary `return()` error. The exact primary diagnostic, one read, one return, and original input remain unchanged; empty returned/published output is additionally required. No cleanup/abort/selected-limit assertion elsewhere changes.
- Six column cases change only the expected diagnostic literal from `column: input limit exceeded\n` to **`column: EFBIG: column input limit exceeded\n`**. Inputs, limit, status, reason identity (including zero), read/return counts and empty output remain identical. Direct status 1 and Shell close-reason rejection stay distinct.
- Reconstructing only the primary branch replacement reproduces the entire new probe byte-for-byte. The cases file changes only two explanatory strings; all 35 semantic input objects and historical controls are identical. The loader is byte-identical. The entire column file differs by only that one string.
- At frozen `f881`, `src/shell/input.ts:55` records primary read failure and observes closing rejection without replacing the primary error. Ordinary Shell read errors produce status 1 and the primary diagnostic. `src/commands/column/internal.ts:35` supplies `FsError` code `EFBIG`; retaining its actual formatted prefix is not suppressing a failure.

## Executed evidence

| Cohort | Independent result |
| --- | --- |
| Unchanged v2 main runner | **35/35** |
| Unchanged v2 column runner | **6/6** |
| Author wrong-primary / wrong-errno controls, replayed unchanged | 3 executions detect all 8 intended failed rows |
| New independent primary status-0 assertion controls | 2 executions detect 2 intended failures, primary diagnostics unchanged |
| Byte-identical original column prefix fixture | 1 execution still fails all 6 original prefix assertions on the same package |
| New independent column direct status-0 assertion | 1 execution detects 3 direct failures; the 3 Shell reason-identity rows still pass |
| Before/after fixture and historical evidence audit | 9/9 checks each; 267 authenticated files identical |

The replay ran **2026-08-27 16:37:30.188–16:37:51.082 UTC**, Node **22.22.2**, Darwin arm64. All 39 replay children closed, with no watchdog expiration or active owned child. The four independent control children also exited: **43 child executions**, not 43 positive cases. No skips are substituted for failures. The four historical negative executions and falsy 5/5 cohort were not rerun or counted as new passes.

The raw unchanged author runner still labels its result `authorOnly: true`, `reviewer: WAITING`, and `publicIntegration: HOLD`. Those original fields are preserved; this report is the separate independent verdict. New controls mutate assertions only, not production. They detect **11 intended failed rows**, separate from the 8 author-control failures.

## Source and package binding

| Artifact | SHA-256 |
| --- | --- |
| Preserved f881 source archive | `dfa06095b546379bbd11054a95ceabf60884e3738b84e2b2de0a87cd8e0118bf` |
| Actual f881 npm tarball | `62228b67ca6793544f0f4374ca00fbbb6e627f514f184d5880fd7723ccf179c6` |
| f881 `src/shell/input.ts` | `4214a448a1a076acb297c3ba6a02d72482d488cf8b6df4549498148a012e5c32` |
| Actually loaded `dist/shell/input.js` | `f8b984b6fc338ff3d1ca60e10283ab100d8e62a697f4b7f8e691819c28ea7c4a` |
| Executed Node 22.22.2 binary | `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011` |
| Prior committed authentication record | `2b8db1a8be77cb98c555f33ec7d7e4410295b20505b0887197f2c68e73a674d9` |
| V2 fixture `FREEZE.json` | `f154fb6aad15cfdfbdc6ffe6fb956218f45087eda9fb58a9186b6b43ea619ac8` |

Prior evidence `d9a58cdc1d4fee159e21c76c708267628767bbf4` and author v2 evidence `4f3a3115cf5cdf365ee2877ce04e2ef951aed491` authenticate the reused artifact and fixture inputs. Actual execution uses a fresh regular-file copied/moved package: no rebuild, repack, live `dist`, repository-source fallback, install, or private checkout access. The independent controls authenticate 714 module-load receipts to their copied package/fixtures, including the exact input.js above.

Full before/after inventories compare file/directory types, modes, sizes, hashes **and new entries**: prior source/build/tools 1,317 entries, prior consumer 787, this replay consumer 786, additional-control consumer 785. Counts differ because fixture sets differ, not product substitution. Inventories do not monitor identical-byte write attempts or promise universal malicious-host isolation. Only this review's scratch was removed; prior/author artifacts were preserved.

## Historical cohorts retained, not rescored

| Historical fixture | Baseline | Candidate |
| --- | --- | --- |
| Original 32 (`0ec75ef3`) | 18/32 | 24/32 |
| Provisional 35 (`92f76262`) | 25/35 | 33/35 |
| Original column (`79f0f917`) | — | 0/6 |

The original author 34 cases/nine fixed observations and separately reported falsy 5/5 remain separate. Both historical evidence seals are byte-authenticated before and after this run. No prior failed result is rewritten. This f881 review is not the frozen **8670** package cohort, and includes none of the later curl-count-cap or env-S fixture changes by implication.

## Reproduction and evidence verification

Recorded product execution (requires the authenticated preserved prior artifact):

```sh
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --unhandled-rejections=strict tests/integration/shared-external-stdin-independent-20260827/fixture-v2/run.mjs /tmp/shared-stdin-fixture-v2-independent-curie-01 8e5fec07ec9a39582987736269bbed51caeb795e
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/integration/shared-stdin-fixture-v2-review-20260827/negative-controls.mjs /tmp/shared-stdin-fixture-v2-negative-review-01
```

Use fresh output locations for any new execution; never overwrite these captures. `negative-controls.mjs` binds this review's replay path and is a version-specific audit driver, not a reusable canonical test.

Verify the committed raw capture without product execution:

```sh
node tests/integration/shared-stdin-fixture-v2-review-20260827/verify-capture.mjs
```

`CAPTURE.json` authenticates the compressed payload; `RAW-MANIFEST.json` authenticates every captured raw result, module receipt, audit and cleanup record. No global build/typecheck or unrelated suite was run for this fixture-only review. Root exports, package files, production, author fixtures and foreign staging are untouched.
