# Independent packed public/default verification

**PASS, bounded public integration only.** Root verified actual author closure
and released immutable source commit
`02b84ae2badc57cb7c3c9004ad8131e3808c5788`. Its source tree is
`7ccd34f44ee42c192950c132ff24318f196a352d`. No author unpublished tests were read;
the documented pre-freeze public/type exposure is in README.md.

## Frozen inputs and outcomes

- Nine independent synthetic byte fixtures were frozen before integration
  execution: SHA256 `d15b0852401a4c09da680a5ef05247b02c33db3e1b0223e97ac3d03db77745c7`.
- The gated **27 runtime checks pass, 0 fail, 0 skip**. They include separate
  default dispatch of tac/expand/fold/strings; all-four invalid-UTF8/NUL pipelines;
  explicit producer/consumer boundaries; MemoryFS redirection/readback; explicit
  temporary-root RealFS; long/reused chunks; public BytePipe and actual Shell
  backpressure/cancellation; exact shared/family limit positive/negative cases;
  plugin collision/replacement; optional plugin absence and guarded imports.
- Measured default factory and actual Shell registry both have **60 unique
  commands**. Each new command occurs once. curl and SafeJS do not register;
  their existing explicit root factories and network subpath remain importable.
  The historical expected baseline 56 was not independently repacked here.
- Strict NodeNext consumer compilation passes with `skipLibCheck:false`, strict
  optional/index checking, public root/subpath option/limit types, no casts or
  declaration shims. Four separate wrong-type controls yield exactly four
  TS2322 diagnostics. Missing declarations cannot count as passing negatives.
- Full execution occurred 2026-08-27T05:31:50.822Z–05:31:57.178Z. Preparation
  began around 05:17Z. This is actual bounded work, not evidence of 72 hours.

## Packed artifact and isolation

- Tarball SHA256:
  `50c4bb16174543136f6b7708a6e14b98f615c550cc12b99174ededd910c67d9b`.
- Installed packed namespace SHA256:
  `9c4afd811d8d8a32b4f38e90c4b6cf1f2273b73ec621942e4ec16d4fab3a8cfe`.
- Source manifest SHA256:
  `e9e63de848eda02408065ae39eb36af8de87fbac9b0646da7ca798360bb6b4f0`.
- Actual Node v22.22.2, npm 10.9.7, TypeScript 5.9.3. Already available
  TypeScript, @types/node 22.20.1 and undici-types 6.21.0 were copied and hashed
  as isolated development tooling. Package runtime/optional/peer dependencies
  are empty; installed consumer initially contains only virtual-bash.
- Git archive supplies tracked source/config/packaging inputs. Build uses the
  exact declared `tsc -p tsconfig.build.json` command with the copied compiler.
  Repository dist is neither used nor emitted; its before/after digest matches.
- Runtime is ordinary Node, non-repository cwd, sanitized environment, no tsx
  or source loader. Imports resolve only to installed packed JS under
  `/private/tmp/safe-bash-stream-public-independent.p8j8em/final-attempt-2/consumer/node_modules/virtual-bash/dist/`.
  Root, stream-inspection and network subpath paths and all import edges are
  recorded. Declaration resolution is separately checked from listed TS files.
- OS network denial covers build/pack/install/runtime/typecheck; runtime also
  denies repository reads. Frozen runtime controls observe EPERM on both TCP
  connect/listen, reject external-source import, and reject unexported subpath.
  A separate post-run OS read control observes EPERM opening repository source.
  It is reported separately, not added to the frozen 27 count.
- Product/source/consumer trees contain no symlinks. Source, compiler configs,
  original/copied development dependencies, executable hashes, frozen acceptance
  files, installed namespace and consumer inputs remain unchanged. Sandbox policy
  is intentionally strengthened for runtime then restored, not falsely claimed
  to be one immutable policy file. No ambient credentials or runtime network
  dependencies are used.

## Exact attempt accounting

1. Initial non-product npm lifecycle control failed its helper expectation:
   npm pack with ignore-scripts still executes prepare, sentinel exit 91.
   Original raw evidence is retained. Official npm v10.9.7 pacote source was
   inspected. This is not a virtual-bash bug or an install-script execution.
2. Four refined setup controls reproduce that bypass as a negative, prove
   prepack/postpack suppression with prepare absent, prove all three install
   hooks suppressed, and observe ENOTCACHED offline. Product manifest hooks are
   explicitly absent before packing; flags alone are not trusted.
3. Final attempt 1 stops before build/pack/runtime/types: the helper incorrectly
   rejects npm's existing internal .bin/arborist symlink. **0 runtime tests
   executed**, not 27 failures/passes. Its report/logs remain unchanged.
4. A narrow helper-only inventory correction records contained npm-tool file
   symlinks and hashes their targets; it does not permit product/source/consumer
   symlinks. Final attempt 2 passes all 27 original checks and strict typing.

Initial, gated and final helper freezes are preserved. The gate hash is
`47c7f321594dedcc38c25260f440a096a7afe2ec4d8372653ad6dbb73145080f`;
the final helper freeze is
`5f4cd29790a2f8a42639bc95ceb9b40f9ae3897dbd102ee3a57265bb61d8b48a`.
All runtime, boundary, positive/negative type and byte fixture hashes are
identical across that correction. No acceptance expectation was narrowed.
There are **no observed genuine product bugs** in this bounded run.

## Evidence and limits

`evidence/attempt-2/report.json` records commands, raw log paths, package inventory,
versions, exact module/dependency realpaths, hashes and compiler resolution.
Source/packed manifests, import edges, raw runtime/typecheck logs, the first
helper failure, both original/refined canaries and post-run hashes are durable.
Durable raw attempt logs/reports/manifests were byte-compared to originals.
The uniquely owned temporary root retains exact snapshots, artifacts, configs,
consumer and copied tooling for immediate replay; no binaries/dependencies or
tarballs are vendored in this repository. No worker/server remains running.

This is one macOS/Node22 package-consumer cohort, not a full suite or cross-platform
claim. Native 85-case tests were not rerun. Preserve original independent 84/85
with manual-dash conflict, separate native semantic 85/85, strict 68/85 with 17
diagnostic differences, and unchanged normative SGID6/env evidence. Nothing here
claims full native parity, superiority over just-bash, all-backend behavior,
deployed-provider support, or project completion.
