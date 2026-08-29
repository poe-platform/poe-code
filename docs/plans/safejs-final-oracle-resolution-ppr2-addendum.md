# H3 PPR2 history-count and oracle-locator addendum

## Status and immutable parent

**Metadata author READY; independent index review pending. Not final QA or product closure.** Snapshot cutoff: 2026-08-29T12:22:16.282Z. This clone pulled main successfully to `e702430ab3dacfea4a5e4bc7494f7c51953ceba4`, preserving its own frozen/untracked files without reset or stash. No racing publisher code or future release outputs were inspected.

This additive handoff preserves the prior H3 report and `candidate-20260829-6e3733a0-h3-followup` (manifest `d513b006769864efbabf45adcbdb4a21237a9d4c31e09e1295c5022e16b6d848`) and the first `e531c27135b8cf5b97eef4a8ef6f7c5a9ac670099a636420025d6113296760d4` snapshot. No membership changes: **47 rows, 21 ranked groups/23 IDs, 128 FAIL + 17 unresolved, 30 review configurations/93 children**, and separate **49 assertions/86 disposition records** remain intact.

New immutable data root: `out/safejs-remediation/final-oracle-resolution/candidate-20260829-e702430a-ppr2-counts`. `ppr2-index-addendum.json` maps cases to complete file SHA-256 plus JSON pointer or zero-based UTF-8 byte span and decoded JSON pointer. `manifest.json` pins every new artifact and this report. Historical TypeScript is inert `.txt` evidence, not a QA runner.

## Approval is not publication

PPR2 final **28 publishables** are independently READY in:

- Source: `/Users/kjopek/Workspace/poe-code-safejs-ppr2-fixture-packaging/out/safejs-ppr2-packaging-independent/publication/manifest.json`.
- SHA-256: `31d14e25974bf910ec253539458085d903d1c38a6ccd3551b2f4992b1dd136b0`.
- Capture date: 2026-08-29T12:11:42.746Z; validation receipt: 2026-08-29T12:10:32.982Z.
- ROOT subsequently approves publication **after CTX**, per the latest user message. Capture-time `publicationAuthorized: false` remains unchanged; later ROOT approval changes authorization only.
- **PPR2 publication version/commit/receipt are still unknown at this cutoff.** This clone’s HEAD/tags and publication approval do not establish a release. Actual-main preimages/gates, serial publication and final independent composite execution remain required.

## Count reconciliation

| Family                    |            Distinct snapshot/case count |      Recorded executions | Meaning                                                      |
| ------------------------- | --------------------------------------: | -----------------------: | ------------------------------------------------------------ |
| Older raw-v6 negatives    |            **8 snapshots in 2 cohorts** |    Prior evidence reused | Not freshly rerun by packaging or H3                         |
| Packaged raw-v6 negatives |                         **4 snapshots** |  **8 fresh invocations** | Object/JSON representations of the same four datasets        |
| Both negative families    | **12 distinct snapshot SHA-256 values** |       Not a fresh-12 run | Hash-disjoint sets; no invocation/history double count       |
| Working v6                |                             **6 cases** | **18 fresh generations** | data/guest/host × saved/completed; three generations each    |
| New v7                    |           single/full × saved/completed |  **8 fresh invocations** | Object/JSON modes, separate full native/current typed graphs |

“Fresh” means recorded independent packaging projection, **not this H3 task and not the eventual final published stack**. Historical generation totals remain separate from fresh18.

## Exact eight historical datasets

The index pins both complete logs, JSON-line byte offsets and selectors. Snapshot SHA means UTF-8 `JSON.stringify(parsedSnapshot)` without newline. It also freezes the eight selected values in `data/extracted-snapshots.json#/historical`.

- **C1**: `PPR2/evidence/prior-validation/safejs-ppr-002-validator-final.log`; full file SHA `7d5c46a2f72a3caa7f90ac5465284678e01ddd20dd08101177bc44b61e71353e`.
- **C2**: `PPR2/evidence/current/independent-31.log`; full file SHA `2f7c34fe7962cf71c0c38cdce9a11ae6c6163f44da8a6ae9c3bd190527075d88`.
- These are approved final-candidate copies under `history/author-repair-hold/history/preparation-inputs/`, **not the original audit**. Canonical absolute paths, read receipts and manifest lineage are indexed.

| Case         | Cohort | Workflow/stage   | Log line + JSON pointer      | Snapshot SHA-256                                                   |
| ------------ | ------ | ---------------- | ---------------------------- | ------------------------------------------------------------------ |
| PPR2-HIST-01 | C1     | single/saved     | 5 + `/observation/saved`     | `7364dca84a05226d0e285d9ab6989df7adc85f85e4112dadc003d59d154dd9be` |
| PPR2-HIST-02 | C1     | single/completed | 5 + `/observation/completed` | `937d54dfaaac23ba44c38b52aa3fce8dfa075603c9bfbb4eb59db8479d107033` |
| PPR2-HIST-03 | C1     | full/saved       | 8 + `/observation/saved`     | `fbb4905098323de526584d7c73d06920a5172023c58311ad92756cf683f3bc56` |
| PPR2-HIST-04 | C1     | full/completed   | 8 + `/observation/completed` | `6668b64ae818815325da0e0b038e757591d5addb5c8ab05a44b8600f9f410cf0` |
| PPR2-HIST-05 | C2     | single/saved     | 5 + `/observation/saved`     | `c143f442f83455af24c721cf484bcdc17d5c7c0faef88cfc8726a303c2bdbf2e` |
| PPR2-HIST-06 | C2     | single/completed | 5 + `/observation/completed` | `b89e30c22a1a5233789c98c47275b1f23707d64316a0d81cc45db69598f3926b` |
| PPR2-HIST-07 | C2     | full/saved       | 8 + `/observation/saved`     | `5da19e9968efffca3678a8db40d9709e98c2e7ec55a5c92976284d09940a1ab1` |
| PPR2-HIST-08 | C2     | full/completed   | 8 + `/observation/completed` | `80279e92c3ff66e9e04366125bb1f0c636ebf4b81b33e57fd19c4b83c920848e` |

All eight hashes match `historical-v6-final.json#/records/0..7` (file SHA `fedab1b7348cac85439779f01f69fc7594879cd522b35268b5f347d64f98fef9`) and prior `ordered-historical-v6.json` (SHA `58f16bd0ab4f152fd8586fba84173c5ce01100c0eaed436ac455877c66360303`). Each receipt preserves **accepted restore → TypeError: `Promise replay references work not created at this position.`**, unchanged input/marker, and no provider/boundary work. This is qualified legacy failure evidence, **not repaired replay, native parity, blanket pass or a newly waived bug**.

Native JSON observations remain at log line35 (single) and line38 (full), with full observation selectors. Historical JSON does not prove prototype/descriptor-aware typed equality. Newer typed native/current graphs are separately pinned in `fresh-native-v7-recovery.json#/captures/0..1`; full raw-Promise alias differences remain PPR1-qualified.

## Four packaged negatives, not eight histories

Byte-exact published fixture: `packages/safejs/test/fixtures/ppr2-integration-history/ordered-original-red.json`, SHA `a9feba99d6e0f02d631f8b38c4e027beaa30d7d240b0f8666edbb3ada26bed62`.

| Workflow/stage   | Fixture pointer        | Snapshot SHA-256                                                   | Fresh receipt pointers                   |
| ---------------- | ---------------------- | ------------------------------------------------------------------ | ---------------------------------------- |
| single/saved     | `/records/0/saved`     | `050f53850e19079f2ec0037ffdbaffc8bcb0a93c740331901888deb2b729d101` | `/broken/0` (object); `/broken/1` (json) |
| single/completed | `/records/0/completed` | `d9545eeba941399b95cf94318e9e65fd97131f4a99bc75553f0b44b79d37117d` | `/broken/2` (object); `/broken/3` (json) |
| full/saved       | `/records/1/saved`     | `09b1e0959f384efce9a6f5ff4f941334396962e156d029638c43cef2f105fcf8` | `/broken/4` (object); `/broken/5` (json) |
| full/completed   | `/records/1/completed` | `68d348beae0fdf158717129a19b98633f9b960f64a612e7e2e0f43c39c352793` | `/broken/6` (object); `/broken/7` (json) |

Fresh receipts: `fresh-v6-history.json`, SHA `103787ff4fc8ae0e53e7998bc93472ed7b9f1c03bcd182ee53517e153d41bb15`. Eight invocations cover four unique hashes, none equal to the older eight. Complete error/counter outputs, source/mock locators and representation labels are retained, not inferred from a pass count.

## Sources, oracles and commands to port

Unchanged sources in approved `public-promise-inputs.ts` match negative fixture and fresh v7 capture: single SHA `21004b9bd197084cdfc54b678a69094d9fc2ca776710fd773f57c6bef753c1a8`; full SHA `94f71537e4d19ff33a45cb950607c4e1eec1922276f15825166e4658cc64e9ff`. The original approved PPR2 manifest pins both that fixture and its preparation-input postimage to complete file SHA `33e1eca0203814ac71949d5eea67f6e3ce4f83f87a58c81deea7488e65b0bfa8`.

Each historical case has an exact inert `childProgram`/`observe()` command-text selector, source, selected saved/completed snapshot, native observation and qualified-error receipt. The template includes boundary/readValue mocks, unexpected-provider guard and bounded budget. **Do not execute the old validators wholesale**: setup reads the original archive and rebuilds old bundles. Port only approved selected data/mock recipes to the actual final published public API, never recreate a “new old” snapshot or call a real provider. This is a concrete execution-port gate, not missing historical data.

Working-v6 source/snapshot selectors: `public-promise-v6.json#/cases/0..2/{source,saved,completed}`; six hashes match fresh `/working/0..5` receipts. Full three-generation outputs/counters remain. Eight v7 receipts: `fresh-native-v7-recovery.json#/captures/0..1/children/0..3`, with `source`, `nativeGraph`, `currentGraph`, snapshots and complete child outputs. Raw-Promise alias qualification and prototype-aware comparison are not replaced by JSON equality.

Recorded commands (metadata only; later execute from actual approved final publication checkout):

- `./node_modules/.bin/vitest run`: **24,544 passed / 41 skipped / 0 failed**, 979 files passed/3 skipped in the independent clean projection. Receipt records no added exclusions or timeout flags.
- `./node_modules/.bin/vitest run packages/safejs/test/ppr2-integration-history.test.ts`: **40 passed**, a focused subset, **not coverage of all older eight negative datasets**.
- Exact 38-path command in `combined-999-command.json`: **999 passed**, a subset. Shadow subset **23 passed** remains separate; overlapping counts are not summed as unique tests.

Configured typechecks pass; expanded24-root types remain **QUALIFIED_RED: 56 baseline/56 candidate diagnostics, 0 new**. Do not say all typechecks green. Formatting exceptions retain exactly two byte-exact historical JSON fixtures. Archive38/security exclusions guard evidence access, not ordinary configured repository unit/build membership.

## Remaining gates and safety

- Independently review this additive index. Prior **207/212 located fields**, five recipe prerequisites (EXEC-CLONE-1; four EXEC-PATCH-4 cases) and trace qualification remain unchanged.
- ROOT/publisher: actual ordered preimages after CTX, approved PPR2 final28 application, actual-main gates, serial publication and atomic receipt/version/commit. Final PPR1 approval/publication and actual-final-HEAD composite execution remain open.
- Curie’s O12 H8 portable proof is **preparing**, user-reported; no frozen READY capture or intake permission is assumed. Generic input Error is not O12. O05/O13/O14 lifecycle, O10 shallow view/O12 typed Error, H5/H6 public proofs and H7 real final SIGINT/screenshots inherit parent gates.
- **COMPLETED-MAP-VALUE-ALIAS stays separate OPEN, Boyle-owned**, original47 membership unconfirmed. PPR2 compatibility/PPR1 raw-Promise qualification does not close this guest-visible Map defect.
- Six README corrections/live sync remain permission pending. No README/production/test/masterplan/home edits, other-clone writes, staging/commit/push/branches, runtime/native/old-harness/test execution or original-audit reads occurred here.
- Exact38 exclusions plus whole `security/` were bootstrapped from pinned prior metadata before copied-payload access. Only canonical, manifest-listed functional paths were read. The earlier interrupted-first-pass individual-receipt loss is preserved; this addendum does not retroactively certify it.

Relevant plans enter a later scoped commit **only after independent review**; this worker does not stage them.
