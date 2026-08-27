# Independent static freeze acceptance — 2026-08-27

**GO for ROOT's exact-hash announcement and then the already-authorized comparison command.** No additional reviewer approval is required between that announcement and execution. This is static identity acceptance, not measurement, packed runtime acceptance, release qualification, or global green.

## Immutable binding

| Item | Exact identity |
| --- | --- |
| Candidate | `e33974b8c643077453227a9679d8ceca8367998c` |
| Git tree | `f559246f1317af7691de00333e13dfc8f44ef428` |
| Source archive SHA256 | `903784b4a5b1123d285e81fff65883b44d486759fb5ce3f4d28c602ed66736cf` |
| Source inventory SHA256 | `00e2633c564a461bf095e7fb9444d165e2c261b3d3b02a0143194044b36a70dd` |
| Built candidate archive SHA256 | `bc4f0e01d9daba5dc7c99a7d66615e52808a83a162140d59e88544c7c71fbd51` |
| Execution binding SHA256 | `1c74655402eba80a12e1c190fa43ba6923faace8a7db81c7f17da8a3b4528b1e` |
| Proposed ROOT receipt SHA256 | `c0f9468f33d1df5ec468bc98830c06fc8fcadb797f3595b0a7fa18f346f607a5` |
| Published just-bash 3.4.2 tar SHA256 | `f3a90ecffb1150e786201d9bd408ae30bcc1f64f3b10b7de22353f7e1373841d` |
| Selected Node SHA256 | `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011` |
| Freeze manifest SHA256 | `5e0ae4878a1512f2b279d09413a71dcc93aa5b754c0e23a089669deb71d81ecd` |

The receipt's `PENDING` independent-check text and proposed status remain immutable creation-time statements. This separate acceptance supplies the completed independent check; ROOT's announcement remains the execution trigger. No freeze artifact was rewritten.

## Actual selected-byte checks

- All 220 source archive members match the inventory, selected committed Git paths/modes/blob identities, and extracted build inputs. This is the explicit source selection, not an all-tests inventory. Earlier six-ancestor proof remains in `PRE_EXECUTION_REVIEW.md`.
- All 710 built archive members match both actual build outputs and MOVED public package bytes; no source/output inode aliases. Exact candidate closure: 711 regular single-link files, no symlinks or unlisted files. Public package metadata preserves the committed root exports and empty runtime dependencies.
- Seven primary records match commit `010411eff3dd210b9575e061914efccd65c13547` and their frozen copies. Actual baseline tar matches registry SHA1/SHA512 SRI; all 955 package members match the primary published inventory AND the MOVED package. Exact selected closure: 3,844 files matching primary post-run records, including modes. Original 3,842 members remain byte-identical; only the two recorded auth-observer files distinguish profiles. No silent repair of the historical 3,842-profile membership failure.
- Both actual offline closures, all 29 baseline asset references, five lock references, and public entries are bound. All 15 runtime files and 15 cohort files match candidate Git blobs, including old cohort seals. Both engines select 256 MiB heaps. Unchanged caps remain expanded 5s guest/28s total and breadth 30s/120s guest within 50s/140s total; cleanup failures remain sticky failures.
- The hash-checked frozen Node resolves both package names through their actual moved package root exports to their bound public entries, without importing either package. Exact child environment: only `PATH=/usr/bin:/bin`, bound HOME/TMPDIR, `LANG=C`, `LC_ALL=C`, `TZ=UTC`; bound host cwd. `NEXT_COMMAND.txt` uses that Node, frozen runner, scrubbed environment, binding, and exact receipt hash.
- Fresh successful check reads/hashes 413,701,504 bytes, covers 5,565 distinct selected files, checks end-of-check stable file identity, and rehashes Node/binding/receipt. All 35 manifest artifact records and five authored-script records match. The measurement output directory does not yet exist. No broad filesystem audit, product import, oracle, measurement, download, install, or timing trial occurred.

## Reproduction and retained failures

Static reproduction only: `/usr/bin/python3 -I -B benchmarks/reports/current-comparison-20260827/measurement-review/static-freeze-check.py`.

Successful attempt 003: exit 0; `static-freeze-check-attempt-003.stdout.json` SHA256 `408652b6744c174e3af905f2a6088b7b4ee5455fc28937aab01d91658351039a`; stderr empty. Verifier SHA256 `4e082865fce63a328b270f4590bd8029d498f11a8047103b4f51c78444db3894`.

Attempts 001/002 remain unmodified and are reviewer-checker failures, not product outcomes. Attempt 001 incorrectly expected no source-tar `package/` prefix (original verifier SHA256 `3b3c48a227c28e1c0f8e56ea81b5fed653c8d4842d49d5f1fa0608f496955243`); correction strips that actual prefix before comparison. Attempt 002 used whole-stat equality after executing Node (verifier SHA256 `860f6e4dd9f986b7fdb26f3a14e43d0de7a0c78be0dc839665b403b42fb04139`); correction excludes mutable access time, compares device/inode/mode/link count/size/mtime/ctime, and rehashes Node after execution. No artifact byte mismatch was observed. Original stderr hashes: attempt 001 `e73c5efc8e88a854473e103fbe839c68c788beb23924f08de5079423ee5bcfc6`; attempt 002 `ba25cf4cc535fa2717afa9873e0eccbd7de06fdbbd583090a27bf5e7755e9398`.

Two metadata-only Node children executed across attempts 002/003, both returned exit 0 and were synchronously waited/closed; no forced cleanup. Attempt 002 did not emit its PID before the verifier assertion. Attempt 003 PID 73084 is recorded and subsequent `ps` confirms absent. All reviewer command sessions ended. No product/sentinel children were launched.

## Remaining boundary

Proceed only after ROOT announces the receipt hash, using `../measurement-freeze/NEXT_COMMAND.txt:2` unchanged: original 224 and aligned 224 for both engines, plus separate breadth 54 targets/7 controls/7 unscored diagnostics per engine. No additive score, retries hiding failures, old-score reuse, new holdouts, native capture, or timing. Independent raw-result/table/import/cleanup binding remains after the run. env-S remains partial, shebang unsupported, fixture validity unresolved. Dependency assets are hash/lock-bound, not individually publisher-authenticated; resolution is not proof of all module/worker evaluation, and selected Node does not authenticate every system dynamic library. Whole-gate cleanup is not a prerequisite to this comparison-only authority.

Only measurement-review files were written; index and other owners' changes were untouched. No commit before measurement-result review.
