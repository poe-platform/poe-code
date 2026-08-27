# Separate8670 package cohort: failed runtime-harness profile

Executed August 27, 2026, 15:34:20.264–15:35:29.715 UTC. This is a **separate
failed package/runtime-consumer cohort**, not completion of mutated whole-gate
attempt-v4, not a release, and not a rescoring of its 17,454 pass / 12 fail /
0 skip result. No canonical suite, native oracle bodies or actual SafeJS engine
was executed in this cohort. Later live source, including rg and numeric-sort
changes, never entered the archive.

## Candidate and execution binding

- Product: `8670ebe8f0d39966c2de2638780437398e5f8490`.
- External cohort harness: `eaed12f8`; runtime policy source `6dc79cd5`,
  independently accepted `c7489e14`. The separate 45/45 Node24 affected-body
  acceptance is not a result of this package cohort.
- Fresh archive: 24,879 entries, manifest SHA256
  `5e3555f04b114fff5aca005b827b4689c342d9f1eb49b9ad02a46a6c048a2cdf`;
  all 49 required native assets authenticated before the first phase.
- Installed Node24.11.1 Darwin arm64, SHA256
  `4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0`.
  Direct/default-PATH probe identities match; no sampled absolute Node child
  mismatch was observed. This is not exhaustive tracing of all short-lived
  subprocesses. Product Node >=22 metadata is unchanged.
- Package manifest SHA256
  `2127bbfed020aeb7873462ae65224e6ee73069425c878aa2ceee9816b2191245`;
  lock SHA256
  `9c04bb7d2c7d1894479f0c37ce367987c2130256e5bfbf426cfa1bd2729d740b`.
- Produced npm package SHA256
  `96d8256f3d763caa5442ba27b44e6b1f586d82d83d07d7d10369bed12426b5c1`.
  The tarball is preserved inside the authenticated raw capture, with 708
  emitted build files and 710 installed files recorded before public execution.

The pinned runtime executes captured npm explicitly. The unchanged nested
current-consumer helper builds once from its own authenticated candidate copy;
the outer cohort reuses exactly those emitted bytes, not moving-checkout dist.
Its permission-isolated runtime children use the helper's minimal environment,
not the outer import-hook environment. Do not claim those children were hook
traced. Strict consumer resolution and explicit permission denials are separate
checks; the denial was attempted but **not demonstrated** here.

## Actual results, including blocked checks

| Boundary | Observed result |
| --- | --- |
| Candidate build | Exit0; one build reused for pack |
| Maintained strict consumer groups | 19/19 compile and resolution checks pass |
| Declared runtime consumer groups | All 16 launcher attempts exit9 before bodies; three groups are intentionally compile-only |
| Existing exact negative type groups | One passes; two fail their prerequisite because the positive runtime never starts |
| Existing source-denial control | Exit9, not expected exit1/ERR_ACCESS_DENIED |
| Pack and offline moved install | Both exit0; installed package has no `src` and zero runtime dependencies |
| Public moved package | Exact70 names, 25 root/subpath imports, four byte/status workflows pass |
| Additional strict public consumer | Exit0; declaration resolution bound to that same candidate package |
| Additional missing-export negative | Exact TS2305 / exit2 and same-package declaration binding pass |
| Missing root/contracts runtime fallback | Not reached; no passing claim |
| Final complete package/dependency sweep | Not reached; no final installed-package immutability claim |

All raw failed commands and their stderr remain captured. The 16 runtime
groups are named individually in `SUMMARY.json`; their zero completed runtime
results are not skips or successes. No test-body product defect was established
by these pre-body failures.

## Exact blocker and routing

Frozen `scripts/verify-current-consumers.mjs:60` launches every runtime consumer
with `--experimental-permission`. Line100 uses the same option for the source
read-denial control. The actual pinned Node24.11.1 reports:

```text
bad option: --experimental-permission
```

Each child exits9. The nested helper eventually fails its line102 assertion
`9 !== 1`; the outer package harness independently fails on that same captured
denial at `package-only-8670/run.mjs:191`. Two time-env negative type groups
remain blocked by the helper's deliberately preserved positive-prerequisite
rule at line81, not by newly observed type errors.

This is a **current-consumer harness/runtime-profile integration blocker** for
the root harness owner, not a product engine-minimum change or reason to disable
permission/authentication controls. The accepted loader feature probe does not
exercise this permission CLI. A successor should qualify the actual permission
invocation and enforce successful positive execution plus real denied-source
access before a broad launch. That needs an explicit reviewed harness/candidate
delta; no frozen script, expected status or permission check was changed here.
No retry or another whole-suite launch was performed.

## Integrity and cleanup qualifications

Fresh admission checked exact entries/blobs/modes; original tracked paths were
checked after each phase and finally, with **zero changes**. Nested helper
source/tests and its original root-dist state also remain unchanged. Post-phase
tracked checks do not detect arbitrary new entries; this is not an append-proof
tree claim. Final installed-package and dependency sweeps were after the failed
denial and were not reached. The preserved package tarball still authenticates
what was installed, not an unavailable final runtime filesystem observation.

All six supervised phases reported clean owned-process cleanup, without a
sampled mixed-runtime path. The exact owned temporary execution tree was removed;
the external output/capture remains. No private checkout was accessed. Foreign
worktree edits/staging were preserved. No production source was modified.

`RAW-MANIFEST.json` and `CAPTURE.json` authenticate all 88 raw files, including
the package, complete logs, 19 consumer group compiler/runtime records, import
receipts and final failure report. To verify evidence without executing product:

```sh
node tests/integration/full-gate-20260827/package-only-8670/attempt-v1/verify-capture.mjs
```
