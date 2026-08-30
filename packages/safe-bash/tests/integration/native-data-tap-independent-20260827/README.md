# Independent bounded TAP fixture verification

## Scoped verdict

**Qualified acceptance of the two-line reporter repair only.** The exact unchanged
candidate test file independently executes **8/8 on Node22 and 8/8 on Node24**.
All three separate reporter mutants expose the unchanged canonical assertion.
No product release, full gate, fourteen-input DU workflow, public API acceptance,
superiority, or general Node-version parity claim follows.

| Independent execution | Tests | Pass | Fail | Exit |
| --- | ---: | ---: | ---: | ---: |
| Candidate / Node22.22.2 | 8 | 8 | 0 | 0 |
| Candidate / Node24.11.1 | 8 | 8 | 0 | 0 |
| Remove current-child TAP / Node24 | 1 focused | 0 | 1 | 1 |
| Historical TAP after positional glob / Node24 | 1 focused | 0 | 1 | 1 |
| Historical forced SPEC before glob / Node24 | 1 focused | 0 | 1 | 1 |

Every row has zero skipped, TODO and cancelled tests. Negative controls are not
passing product cohorts. Each candidate's actual nested npm captures show filtered
TAP **5 tests / 5 pass / exit0**, then historical unfiltered TAP **7 tests / 5 pass /
2 intentional native-data failures / exit1**. The eight exact canonical names,
all raw byte streams, argv, environment, cwd, statuses, source inventories and
startup records are preserved; `preexecution.json` lists the names directly.

Removing the current flag yields local default SPEC with 5 successful tests; the
canonical TAP5 assertion fails. Putting TAP **after** the historical positional
glob does not select TAP on this installed Node24 profile: all seven tests still
execute, SPEC reports five passes/two intended failures, and the canonical TAP7
assertion fails. This is not a fabricated option-parser rejection. Forced SPEC
before the glob independently produces the same TAP7 detection. All eight
synthesized TypeScript input files are byte-identical across the nine nested npm
captures. Additional guard-only controls detect both a new entry and changed
configuration bytes, with the disposable tree restored afterward.

## Frozen identities

- Candidate: `e422ad06b3470477b7f9323c89289d2963a00407`.
- Parent: `647f42b9abf9f5abc4de3e36c74410b3bb63df3c`.
- Preexecution policy/inventory commit: `591d2c20d08987bb0829ec91db7cc5cf333842ec`.
- Executed observer/supervisor commit: `aa7541ee437de93b6bc1f80b9861f795c1e35b1f`.
- Author receipts: `6bc7a360beb98264044932a838c3d8763b746d25`.
- Prior independent history: `397894e0833a84fcd86d34102548faa78e9d988d`.

The only candidate-vs-parent path change is
`tests/plugins/qualified-current-release-native-data/controls.test.ts`:
SHA-256 `f1a94e3a45750bd66ce3118a27664922599124abca0a303279b5143fa8b9dc92`
(parent `8ef246ff8e6411bb35680d713bb808eccd371143122a026e745971e96a43c562`).
The review verifies exact replacement strings, not merely a line count. Current
`npm test -- --test-reporter=tap` forwards the reporter before test paths; the
historical script is `node --import tsx --test "tests/**/*.test.ts"`, with the
repair injecting TAP immediately after `--test`. No assertion, byte expectation,
exit code, synthesized input, root script/config or frozen DU original changes.

Actual installed Darwin arm64 executable paths and SHA-256:

| Executable | SHA-256 |
| --- | --- |
| `/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node` | `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011` |
| `/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node` | `4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0` |

Both use the existing Node22-installation npm **10.9.7** CLI under the selected
Node executable via an isolated wrapper, not a possibly broken Node24 npm link.
Full paths/realpaths/version output/hashes are recorded before and after. The npm
CLI SHA is `8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7`;
TypeScript 5.9.3 `_tsc.js` SHA is
`e8f349eabd48486bdb2bf9dc1a00c89d58297270c54b745838879e2859194419`;
tsx 4.23.12 metadata SHA is
`96aee9fd252d0cc31f3c01468250961f5b338c797bc208700d7db926450c7659`.
Full original npm/tooling trees and the copied tooling tree are inventoried,
including added-entry detection. Seven installed dependency metadata records
match candidate lock versions/resolved/integrity fields. This does not rehash
registry tarballs or attest ambient OS libraries. No installation occurs.

## Isolation and observed boundaries

Each execution materializes **13 actual fixture dependencies plus the candidate
lockfile** from the exact Git commit into regular files in a unique `/tmp` tree.
This is a selected dependency closure, not an entire repository archive. The four
current-consumer TS sources are presence/route reads only, not consumer execution.
No live product input, unrelated untracked HTML/whole-gate data, AGENTS copy,
historical native archive or private checkout enters the snapshot. The original
fourteen staged DU files are hash-checked against the parent, not executed.

The unmodified helper resolves its package/config root inside that snapshot and
creates its own regular temporary fixture files there. A startup/read/spawn
observer records actual nested npm stdout/stderr and input bytes without changing
the results. The selected Node is enforced through PATH; npm user/global configs
are distinct empty files. `NODE_OPTIONS` loads only the observer, never a reporter.
Default SPEC is observed for the local non-TTY Node24 profile, not asserted as a
universal Node policy. Startup records may repeat PIDs for loader contexts.
Synchronous read observations plus static import review bind the selected inputs;
this is not kernel-level all-syscall or module-load attestation.

All source/config/tooling before/after inventories match, including path additions.
Per-run limits are 180 seconds, 8 MiB outer output and 16 MiB trace; canonical
helper children retain their unchanged 60-second/4-MiB limits. All observed owned
children and process groups close naturally. No timeout, output kill or leak is
accepted. The fixture execution window is recorded as
`2026-08-28T00:00:58.453Z`–`2026-08-28T00:01:09.934Z`
(August 27 locally), not a 72-hour work claim. The owned materialization and
verification-extraction directories are removed after preserving raw evidence.

## Preserved harness failures

The initial supervisor remains **failed, 23/28 checks**, because it incorrectly
required a reporter flag in observed worker `execArgv`. The test coordinator's
reporter option is not retained there. All five actual executions already had
the recorded expected outcomes; no cohort was rerun. A separate offline audit
checks every captured executable/version, actual current-script forwarded argv,
historical package script bytes and raw nested reporter output instead.

The first offline-audit attempt also failed: its executable-only spawn filter
included six compiler commands alongside the test command (7 rather than 1).
Its original script and terminal-transcribed diagnostic are retained in
`audit-attempt-01.json.gz` inside the raw archive. The filter now also requires
the actual `--test` argument. The corrected **28-check offline audit passes**
against the same raw captures. The original supervisor source/report remain
unaltered in the archive; the reusable replay has only its observer assertion
corrected and syntax-checked, not rerun. No canonical expectation was weakened.

Original prior Node24 **7/8** remains historical nonpass. Author captures,
including the author's separate setup failure, retain their original commit and
hash bindings; their scores are not reused as independent execution. The seal
also checks the author's actual candidate/parent input hashes and child runtimes.

## Evidence and reproduction

- `policy.json`, `preexecution.json`, `preexecution-tooling.json.gz`: policy and
  exact input/tool freeze committed before any fixture execution.
- `evidence-v1/MANIFEST.json`: per-entry hashes, results, history bindings and
  executed/revised harness identities.
- `evidence-v1/RAW.json.gz`: JSON container of 13 base64-encoded entries, including
  five compressed execution receipts, original failed `REPORT.json`, corrected
  `AUDIT.json`, guard/tool inventories, preserved audit error and executed scripts.
  Each execution receipt includes exact stdout/stderr base64 and raw JSONL trace
  base64, plus parsed observations for inspection.
- `evidence-v1/CLEANUP.json`: natural process closure and removal record.

Run the non-executing sealed-evidence audit from the repository root:

```sh
node tests/integration/native-data-tap-independent-20260827/verify.mjs
```

It verifies archive/file/harness hashes, re-audits saved receipts in a disposable
directory, checks append-sensitive evidence integrity and canonical discovery
hygiene, and removes its extraction. It runs **zero fixture/product tests**.

An explicit future reproduction using the corrected supervisor is:

```sh
node tests/integration/native-data-tap-independent-20260827/replay.mjs
```

That command uses the frozen Git inputs/tools, emits a fresh unique `/tmp`
directory and executes only the two eight-test cohorts plus three focused
controls. It never overwrites committed evidence. `audit.mjs`/`seal.mjs` are
version-specific to this preserved first-run failure/audit; they do not silently
rescore a different future run. No loose TypeScript, canonical `.test.*` file,
AGENTS copy or shared configuration change exists in this evidence directory.
