# Comparison-only preliminary review — 2026-08-27

**Ancestry confirmed; waiting for ROOT's immutable execution-receipt announcement.**
No product imports, CLI/selfcheck execution, sentinel tests, native oracles,
comparison runs, installs or network activity occurred. This review used Git
metadata/committed blobs and static JSON/hash reads only. No freezer polling.
Only this new measurement-review document is written; no commits or other edits.

## Independently resolved ancestry

Candidate: `e33974b8c643077453227a9679d8ceca8367998c`.
Tree: `f559246f1317af7691de00333e13dfc8f44ef428`.
Parent: `b9559de5c62fb679c8558fc2444ecb99f1d9eee1`.
Working HEAD at initial inspection was `b5d4b2f60a7e6f13b7d80e3157ea5432542dd2ca`;
it and concurrent dirty work are not substituted for the selected candidate.

Each ref resolved with `git rev-parse --verify REF^{commit}`; each
`git merge-base --is-ancestor FULL_REF FULL_CANDIDATE` returned0:

| Required ref | Resolved commit | Ancestor |
| --- | --- | --- |
| 1ad428ed | `1ad428edb7bce7d30f081c0e9bd4332eb280c677` | yes |
| 7d7dce7c | `7d7dce7ced596b24e60e1ab3fea5bcd50c070755` | yes |
| b2821599 | `b282159921ce530e932b02f90c64eca987de2704` | yes |
| 3bf672f | `3bf672f722da2bdf1591ed112290b702987bf63a` | yes |
| c3fbda62 | `c3fbda6279028fd2bde9f6d967970870ff7546aa` | yes |
| 84ab66ca | `84ab66ca717e0dff21abf57051b41cb553f3c7f3` | yes |

None missing; no cherry-pick or branch/worktree change.

## Committed bridge inspected

All15 runtime blobs at e339 match its committed independent final receipt:
receipt SHA256 `ea60bfb798cf66e6e38788066cc3063f629e6465c196393168a6e553a1c1bbee`;
runtime-manifest SHA256 `de7dee52dc4616f3a86534fd51b0cb1062c1dc31512273866b9d7fb564cc5547`.
The effective expanded adapter is the R1/R2 revision,
`761bf2422d03f5dcc6162df7d42e1d2fd2bb974ec2e42b9fe0d51e3e406fe3e2`, not the
historical pre-fix adapted hash retained in REUSE.json. Both copied predicates
match their named historical Git blobs byte-for-byte. Read committed CLI,
binding/public-resolution, cohort selection, assessment, reuse and limit code.
Expanded guest5s/total28s and breadth guest30/120s within total50/140s remain fixed;
receipt hashes do not turn those bounds into measured timing guarantees.

## Minimal checks after ROOT resumes this reviewer

1. **Freeze/authority:** bind the announced immutable receipt and exact candidate
   tree/source/pack/member/export bytes, selected Node and runtime15 hashes, host
   cwd/env, budgets and cohort/profile/golden hashes. Verify the newly moved offline
   package's actual paths and public root resolution against that freeze, including
   dependency/lock/worker/WASM/data membership; no ambient fallback or silent
   relocation. New pack identity is not an old inventory or old score. Legacy
   `qualificationAccepted` means ROOT's **comparison-only** acceptance here, not
   release/global-green certification. env-S partial support, unsupported shebang
   behavior and unresolved fixture validity remain explicit; no whole-gate demand.
2. **Local published-baseline chain:** reauthenticate the selected local tar and
   moved955-member just-bash package against primary commit
   `010411eff3dd210b9575e061914efccd65c13547`, particularly download.json,
   published-files.json and package-comparison.json. Tar SHA256 is
   `f3a90ecffb1150e786201d9bd408ae30bcc1f64f3b10b7de22353f7e1373841d`; public entry
   SHA256 is `70dd1320d921b736e965b1545e50ab57af2b2807a26de7fa624d4f519a953b7c`.
   Preserve the3842 original versus3844 observer-augmented closure distinction.
   Dependency bytes/locks are not independent publisher authentication. The primary
   committed records were read/hashed now; **local frozen package reauthentication
   has not yet occurred**. No install, download or live-native recapture is needed.
3. **One authorized run, exact accounting:** original224 and aligned224 each run
   once per engine:448 observations per profile,896 total; breadth54 targets+
   7 controls+7 diagnostics per engine:136 outcomes. Separate tables, diagnostics
   unscored, no additive union, old-score reuse, retries or new holdouts. Preserve
   original TMPDIR omission/no explicit /tmp versus aligned TMPDIR=/tmp/precreated
   /tmp, exact recipes/fixtures and loopback-only optional curl configuration.
4. **Independent post-run table binding:** match every profile/engine/ID and recipe
   hash to exact-inputs, raw attempt and journal, with no duplicate/missing slots
   concealed. Independently recompute the unchanged native-golden four-field
   predicate and breadth intent assessments from captured data—not another engine
   run. Check raw/projected stdout/stderr, guest status, expanded fixture effects
   and breadth full-root census. Retain baseline stderr's public UTF-8 boundary;
   do not claim reconstructed raw bytes. Bind actual public-resolution/import
   identities and pre/post closure membership to the new freeze, without claiming
   all-module evaluation or unmeasured dispatch completeness.
5. **Failure/cleanup separation:** report guest utility results separately from
   setup/import/capture/harness failures, Node crashes and cleanup errors. Keep
   unresolved fixture/oracle validity distinct, not waived. Check result/phase,
   exit/pipe/group/server closure and evidence-write completeness independently;
   forced cleanup remains failure even with matching output. Preserve initial raw
   failures and remaining not-run slots; never forgive a crash or mask it by retry.

Stop now. The freezer handoff will be reviewed only after ROOT's resume/immutable
receipt announcement. No current measurement result or release claim is made.
