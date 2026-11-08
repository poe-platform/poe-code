# Independent type-workflow review — bounded, one guard gap

## Verdict

The unmodified **b9559de5c62fb679c8558fc2444ecb99f1d9eee1** workflow passes its
declared typing phases. Independent acceptance of the new harness is **withheld**:
one mixed-package-resolution mutation escapes both the moved-consumer helper
and the complete warm `npm run typecheck` command. This is a verification-harness
gap, not an observed product type error or an incorrect unmodified package
resolution. No root configuration, product source or author fixture was changed.

| Independent frozen observation | Result |
| --- | --- |
| Cold `npm run typecheck` | exit78, clear build prerequisite, no compiler phases or dist |
| `npm run typecheck:all` | exit0, exactly one build and28 compiler phases |
| Global source/tests and selected-GNU dedicated consumer | both exit0 |
| Strict current source-consumer groups |3/3, four `.ts` files |
| Strict copied-build consumer groups |19/19, zero consumer runtime executions |
| Exact negative diagnostics |1+2+5, unchanged and all matched |
| Independent outer controls |**20 pass /1 fail /0 skip** |
| Existing mandatory-runtime-coverage unit controls |24/24, no skips; not provider successes |
| Author evidence authentication |33 original captures, separate from independent execution |
| Input/output/tool integrity |22,001 tracked inputs,318 regular tool files,708 emitted files unchanged after controls |

The21 outer checks contain15 negative/guard controls:14 reject as intended and
one fails to reject foreign public declarations. The other six cover the cold
prerequisite, combined command, compiler discovery, capture authentication,
existing24 controls and post-control integrity. Do not add the negative compiler
errors or author captures to runtime-pass counts.

## Concrete finding for Curie

`scripts/typecheck-consumers.mjs:7` implements `assertBuiltConsumerResolution` with
two substring-presence checks and one repository-`src` denial. It does not require
**every successful public package resolution** to use the copied candidate.
Its call at `scripts/typecheck-consumers.mjs:61` therefore accepts a mixture of
current package declarations and a different build's declarations.

The isolated control uses the real, freshly built candidate and the unchanged
`env-split-public-types` group, with two explicit temporary input mutations:

1. Make a regular-file copy of the actual fresh dist in an owned `decoy-dist`.
   Add `export declare const independentMissingExport: number;` only to that
   copy's `contracts/index.d.ts`. The real candidate does not export it.
2. Add an import of that name from `virtual-bash/contracts` to the current
   `tests/shell-stress/env-split-validity/public-types.mts`. **Without** a paths
   override, the actual moved-consumer compiler rejects it with **TS2305**.
3. In the isolated `tests/plugins/qualified-current-release/tsconfig.consumer.json`,
   map only `virtual-bash/contracts` to the decoy declaration with `compilerOptions.paths`.
   Keep the root `virtual-bash` import on the actual moved candidate.

Actual successful TypeScript resolutions, with only the owned temporary prefix
abbreviated here (complete paths remain in raw evidence):

```text
virtual-bash           -> …/consumer/node_modules/virtual-bash/dist/index.d.ts
virtual-bash/contracts -> …/decoy-dist/contracts/index.d.ts
```

**Expected:** refuse qualification because the current candidate cannot supply
the imported name. **Actual:** the helper returns pass; the complete warm
`npm run typecheck` returns **0**, global typing passes, all3 source groups and
all19 moved groups pass, and the exact1+2+5 negatives still match. The full
command runs27 phases with the already fresh, hash-bound dist and no extra
build. It is not a stub compiler, forged trace or hypothetical helper-only gap.

Raw repro: `evidence/final/foreign-build-resolution-full.report.gz.base64`.
The missing-export rejection without the mapping is in
`evidence/final/moved-consumer-negative.report.gz.base64`. The focused helper
trace is in `evidence/final/foreign-build-resolution.report.gz.base64`.
The audit deliberately exits1 for this unrejected mutation; it is not relabeled
as successful safety or an expected-defect acceptance pass.

**Requested ownership action:** Curie should minimally validate actual successful
public resolutions against the installed candidate for each group, not just
look for one copied-build substring. Retain the supported `localPackage` leaf
route and explicit companion imports. A regression should keep the mixed root/
subpath control, missing-export negative, normal19 groups, and current source
group fallback denial. This is a trusted development configuration mistake
detector, not a claim that arbitrary host JavaScript must be sandboxed. No fix
is applied here; a changed harness needs a different acceptance checkpoint.

## Coverage and preserved exclusions

The compiler reports1,737 actual input files. All five current `src/contracts`
counterparts are included, along with the four declared current `.ts` consumers.
Exactly the five authenticated flattened captures are absent; the sixth
`src__contracts__errors.ts` is still included. A new `.ts` neighbor beside those
captures produces exactly TS2322. No directory-wide historical exclusion is
introduced or endorsed.

The179 standalone inventory remains30 current /4 declaration /1 frozen oracle /
141 frozen evidence /3 negative types. Tests independently reject an unknown
tracked `.mts`, removal of an existing current `.mts` execution/type route,
missing `.mts` and `.ts` consumers, missing current contract source, missing
built public subpath, broader exclusions and removal of the current-test include.
Captured-byte tampering fails before compilation. A real source TS2322 stops
after the failed build, without using stale dist for consumers. An invalid
`CommandInvokeOptions` in the current source consumer is rejected. The strict
source-consumer guard also rejects an actual repository-src resolution after
a successful compiler exit; that guard is not the failing moved-package guard.

All original author captures at **547160e8a81d07a7f78de3092321c217e51c5f3c** are
authenticated directly from Git objects, not mutable working files. The33 raw
records preserve v1(14checks), v2(15) and v3(15), including v3's exact ten repair
overlay hashes matching b9559de5. This authentication is **not** an independent
rerun of the author's15-check harness. Our independent21-check harness is new.
The three callback annotation changes from1a18cb18 are present in the frozen
candidate, but their separate author status is not self-certified here; Dirac
owns that independent review.

## Source binding, attempts and cleanup

The candidate is a full `git --no-replace-objects archive` of the explicit commit,
not mutable HEAD, a private worktree, stale live dist or an overlay. Tool files
are copied as regular files from the cached development dependencies; no install
or network is used. The isolated Git index is read from the fixed candidate;
its object alternate is read-only repository Git objects, never source fallback.
All mutation effects are restored. Every synchronous child settles without a
signal or timeout; the exact owned source/tools/dist/consumer/decoy temporary
directory is removed. No private checkout or live dist was written.

- Source tree: `cb32675239f13e86dfcc8f702b4d1b5328dac3ec`.
- Git archive SHA256: `edb1db5cf4a7a476f4dead186995b3d6c60cc24e926641fd6126dd9771c8da7f`.
- Before/after source-census SHA256: `57ca330a241334eaa512161554e4020a854d13b7079b3f3c17efd8eaf896e0e9`.
- Emitted-census SHA256: `12801a0b1723648ebab6826d4bb5ee1f06e388ca948f86b5e0b303223251f1f1`.
- Node22.22.2 / TypeScript5.9.3 / @types/node22.20.1, Darwin arm64.
- Final interval: August27,2026,12:32:45–12:34:01 UTC.

The first attempt remains **19/21**, including the same real binding gap and an
audit-only path-comparison defect: macOS's `/var` temporary directory is reported
by TypeScript as `/private/var`. The first raw input list already contains the
current contracts. The revised harness canonicalizes its owned temporary root
with `realpathSync` before capture. It does not normalize away a type error or
alter any candidate expectation. Original runner bytes are preserved as
`evidence/first/audit.mjs.data`; first/final logs and counts are separate.

No whole gate, service, native-oracle comparison or product runtime suite runs
here. Prior b494 results and every other historical failure remain unchanged.
This review does not qualify later concurrent changes or establish overall
compatibility. The cleanup migration is a separate handoff at source026e20cf
and evidence9167913d, still requiring its assigned different verifier.

## Reproduce and authenticate

```sh
node tests/integration/typecheck-workflow-independent-20260827/verify.mjs
node tests/integration/typecheck-workflow-independent-20260827/authenticate-author.mjs
node tests/integration/typecheck-workflow-independent-20260827/audit.mjs /tmp/NEW_EXCLUSIVE_OUTPUT
```

The first command verifies the sealed evidence and reports the retained red
audit, without rerunning compilers. The second reads fixed author Git evidence.
The last reruns the frozen independent audit; exit1 is the reproduced unresolved
guard failure, not an instruction to accept it. Each `.gz.base64` file preserves
exact raw bytes with its uncompressed length/SHA256 in the corresponding report.
