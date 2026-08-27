# Independent PAX deletion review — OPEN

2026-08-27 UTC. No commit recommendation. No source, author-test, historical-evidence, staging, or commit changes by this verifier. The complete first driver exits **1**; its raw run is retained unchanged in `runs/run-sUC9Tn/`.

## Executed accounting

| Cohort/check | Pass | Fail | Exit | Qualification |
| --- | ---: | ---: | ---: | --- |
| Accepted historical baseline, literal177 | 177 | 0 | 0 | Historical replay, not a newly source-matched causal run |
| Patched source, literal177 | 176 | 1 | 1 | Exact original options line108 conflict retained |
| Patched source, corrected177 | 177 | 0 | 0 | Explicitly corrected oracle; not unchanged old177 |
| Author deletion12 | 12 | 0 | 0 | Distinct from accepted author12 inside177 |
| Independent deletion7, first attempt | 5 | 2 | 1 | D04 fixture defect; D07 policy question below |
| Scoped TypeScript | — | — | 0 | Includes exact-byte legacy transport separately |
| Actual global `npm run typecheck` | — | — | 2 | Unowned shell TS2769, preserved |
| Actual global `npm run build` | — | — | 0 | Fresh emitted output |
| Built-package checks | 4 | 0 | 0 | Separate, not added to177 or196 |
| Pinned historical observation control | 1 | 0 | 0 | Three phases, separate historical profile |
| Corrected D04 focused follow-up | 1 | 0 | 0 | Separate transport; does not rewrite first7 |

All TAP skip/TODO/cancel counts are zero. Exact identities match each declared cohort. Raw corrected main total is **194/196**, comprising177+12+7; no denominator or outcome is recalculated after the focused D04 fix. The177 contains128+1+30+12+6. The30 uses all five files with `ARCHIVE_LONG_LINK_NATIVE=1` and is **native-profile and B02-observation refactored**, not the unchanged original29/30 oracle. Raw158/159,29/30,176/177 and prior driver failures remain historical.

## Findings and disposition

1. **D04 verifier fixture defect, fixed locally without changing expectations.** The original raw-mtime mutation used all-FF bytes, which this format accepts as signed base-256 minus one. Baseline and patched diagnostics both extract it as -1000ms. The owned control now uses ASCII `9` bytes, an invalid octal field; both profiles reject those bytes when effective, while the patch correctly ignores them under valid PAX override. A frozen-helper focused D04 run passes1/1. Original control bytes, failed TAP and diagnosis remain retained; the full seven have not been rerun.
2. **D07 mutation8 remains unresolved, not a demonstrated new regression.** The exact vector has a local `mtime=1e3` followed by local `mtime=` and a regular member. Our assertion expects status2/no publication; both baseline and patch return0. Both reject effective `mtime=1e3`. The patch correctly leaves normal backend timestamps after deletion. `parsePax` validates framing, text/NUL, unsupported keys and hdrcharset before duplicate replacement, but numeric grammar is checked only for the effective merged value. Root must distinguish strict unsupported-key/charset policy from our stronger all-record known-numeric restriction. D07 is unchanged; no expectation waiver or source fix was made. Its later path/resource vectors were not reached after mutation8 failed. Reproduction bytes/base64, source hashes, exact argv and outputs are in `evidence/diagnostics.json`.
3. **Global types fail outside archive ownership.** Frozen `tests/shell/diagnostic-context-bounds.test.ts:7:176` reports TS2769: `detached` is not a property of the `SpawnSyncOptions` overloads. Raw global stdout/stderr remain in the run. No fix or current-live pass claim is made.
4. **Driver input/output classification needs correction before a clean gate.** Current global imports include52 generated `dist/*.d.ts` files, so excluding all dist would make global input equivalence false. They were captured. The build rewrites five, and the runner's immutable-input check throws at `dist/commands/table-text/internal.d.ts`. This is a real driver failure, not suppressed by passing test cohorts. Postflight separately proves all1859 non-output inputs unchanged; full1911-input stability is false. Preserve actual pre-build type inputs and explicitly separate generated-output validation in a future authorized driver revision; do not omit global inputs or report this attempt as exit0.

`evidence/diagnostics.json` contains five diagnostic vectors for each of two sealed profiles; these are not new main tests. `reproduce.mjs` imports product/fixtures exclusively from its explicit regular snapshot root and hashes source before/after. No native malformed extraction was used. `evidence/d04-corrected.json` preserves the focused command, transport hash and output.

## Source and oracle audit

The reviewed delta persists global empty values per key, retains local tombstones until the next real member (including excluded members), selects effective fields before raw semantic decoding/GNU fallback, and rejects deleted required path/linktarget/size before publication. Rejecting deleted size for all supported types is the approved conservative **product policy**, not a universal POSIX error rule. Missing uid/gid/mtime render dashes. Paired timestamp restoration obtains fresh stat when only one timestamp is requested; explicit atime deletion does not fall back, absent atime retains the existing fallback, and deleting both performs no restore. Envelope/framing/type checks and strict unsupported sparse/unknown/charset handling remain. The narrow opaque optional allowlist is not widened. No filesystem or contract implementation is changed by this archive delta.

The original options fixture remains byte-identical at SHA256 `34e3aa6ac71cc7078371502255c7880994ef0644ecf00dc8da351e785532d66f`. Only the approved expectation is migrated from rawmtime1700000000000 to fixed normal-backendmtime1600000007125, with a forwarding observation fixture setting that literal independently of product output. Archive bytes and other assertions remain. Restore calls/state are additionally checked by dedicated author and independent cases; the legacy assertion itself is not a new restore-call spy. The literal original is transported only to frozen `tests/commands/archive/options.legacy.mts`, with original relative imports and exact hash unchanged before/after. Its failure is preserved separately from corrected177.

Author evidence corrections were audited, not attributed to source bugs: missing P09 historical archives in the initial old-cohort capture; D10 syntax failure with zero targeted cases executed; D09 direct command cancellation changed from an inappropriate returned-status assertion to rejection by the exact original reason; D10 diagnostic wording corrected while retaining nonzero status, sentinel bytes, fullstat and namespace checks. All13 author raw stdout/stderr hashes match their records. The author source-matched pair was independently rehashed:510 regular inputs in each, no missing paths, and only archive README/extract/format differ. Their hashes are `423c2ea2696bf6823d1328877e75df83ccf4526e798ca078737caa608f5fc372` and `79dcf243cc8a0c37b9749091fed70418e769edb765b9a202d2b7d70a6517f4f4`; this audit is separate from our historical177 replay.

## Capture and exact commands

The actual driver invocation was:

```sh
node tests/commands/archive-stress/pax-deletion-independent/run.mjs --ready /tmp/safe-bash-pax-deletion-ready-01.json
```

READY hash: `ef6c5a5cd1399605fb92ac7384a242aa0d9728382ee01e24d3f0053f9aab79bc`.
Frozen root: `/tmp/safe-bash-pax-deletion-independent-FEprCU/tree`.
Frozen HEAD: `98de827f9f8986f572532d750d3eb9d5ce1c0a86`, plus recorded dirty inputs; not clean-HEAD-only evidence.
Initial1911-input hash: `baad44817bf891c9ef6dcb22c32628c90cd6fab8325baa95afff27bcd1e7e6d6`.
Complete initial hash including legacy transport: `7bb1ac458d5f54480979e7d79832bb7cb468755a9d176c23f62206c6800b72ba`.
Observed post-build1911-input hash: `5a74db8afe0ae7d9af78e88aa63459d214cf98a2e40503905511f949bb78f5e6`.
Stable1859 non-output input hash, before=after: `cae7b25d8aed4efa5cf584f7f9de57ef24f65fafd6822be9f606b41fdc3628a0`.

The capture contains69,218,823 bytes and regular current tracked/relevant untracked inputs, with root locked dependencies copied once. Old snapshot/oracle build trees, scratch, historical output copies and dependency aliases are excluded; explicitly needed GNU/P09 fixtures and actual compiler inputs are added. Offline installed versions/lock integrity metadata and copied content hashes were verified; registry tarball integrity was not independently re-established. No installs or live import aliases. Exact copied GNU binary SHA256: `49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66`.

Actual global `tsc --listFilesOnly` input equivalence is1079 paths:136src+718tests+6benchmark type inputs+167dependency+52generated declarations. Live/frozen pre-build paths match; post-build paths still match, not all bytes. List hash: `22cd23648aa9db2b4f417fe3653e7151af41ed6aa8b96b78d8136cea06ac0af1`. No benchmark/FS suites were run. All exact command argv, cwd, env, exit codes and output hashes are in the raw run; scoped types uses the owned scope config, global commands are actual `npm run typecheck` and `npm run build`, and built4 uses `node tests/commands/archive/built-package.mjs` inside the snapshot.

Raw evidence hash: `96e8be34a76f5741fb9b92e83cea0b126e581a22f365775c0615e63e9b2bf72f`. `evidence/postflight.json` hash: `4822b2100cc05d63dbf0612f7d9ede3678e51dc6c9c018c5ebf5f02fce306408`. Postflight explicitly derives accounting because the final driver check threw before writing its usual final accounting fields. It records the five changed generated declarations, later live drift and protected-history checks.

Reviewed author hashes remain exact: format `05445d1d80023bbd5a59ff3a47b14bcea038f1f8476835fd973a01ee89fd19ac`; extract `fc2f8a4151ca7c5398cd64fe4a55156f2a1ac6feb75404cfb96c8f5b6d4a1536`; corrected options `4c69757278c40d65e037018a867daa5f416c0dfb824aa6230a6769788a4b266d`. All10 author handoff hashes match. Historical90 files, accepted273 evidence files, accepted baseline1778 inputs and pinned historical-control1629 inputs reverify. Original author167 entries were checked against historical/current provenance, distinguishing the explicitly authorized new source/README delta. No historical byte updates.

The historical control remains pinned to `/tmp/safe-bash-pax-independent-YKSbHc/tree` and its historical MemoryFS reference-guard profile; it is not a current filesystem claim. Native8 research vectors are durable exact copies in `evidence/native-profiles.mjs` and `.json`, with `primary-source-manifest.json`. They were not rerun or counted as product tests. GNU/BSD empty-time/global-header limitations and AppleDouble native profiles remain explicit counterevidence, not universal product expectations.

Later live HEAD `3d8f96e4ad557d7a644f85cda032a23c3faf1b09` and seven selected-input drifts are recorded separately; one is our disclosed D04 fixture correction. Moving root changes do not invalidate immutable non-output snapshot evidence or turn it into a current-live gate. No owned test children remain; runner cleanup records no leftover native fixtures. Snapshots and raw failures are retained. Next action requires root disposition of D07 and driver generated-input handling, then a new sealed gate; no source or expectation fixes are silently authorized by this report.
