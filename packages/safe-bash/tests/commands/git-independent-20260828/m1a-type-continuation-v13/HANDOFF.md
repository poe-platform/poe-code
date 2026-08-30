# M1A v13: HOLD; no corrected-negative acceptance

Friday, August 28, 2026, America/Chicago. One actual cohort, no retry.
Only this new directory changes. Product, root exports, package, instructions,
shared evidence and old working paths remain untouched.

## Commits and precise blocker

Preseal: `1d981b9f0c4874bc129691d8ef0c2781b341da40`, nine explicitly owned
files, committed with hooks disabled before any compiler subject execution.
The evidence commit is the commit containing this handoff and EVIDENCE-MANIFEST.

The existing positive companion launched once and exited **1**, not the required
0. Its wrapper asserted `emitted.emitSkipped === true` after `program.emit()`;
the pinned compiler returned false. Exact capture: `RUN-01/positive.stderr.raw`;
exact sealed assertion: `compiler.mjs:75`. The child reports
`M1A-v13-wrapper-failure`, not a TypeScript error verdict. This is a **new harness
assertion defect**, not a product/type failure or evidence that the missing export
exists. Static inspection afterward finds TypeScript's whole-program noEmit path
returns `program.emitBuildInfo(...)`; noEmit does not establish the asserted
emitSkipped value. No code or expectation was patched after this execution.

The positive produced zero stdout bytes and 628 stderr bytes. The outer preserved
both streams, then its unconditional JSON parse of empty stdout produced the
secondary `Unexpected end of JSON input` failure at `outer.mjs:106`. That outer
message does not replace the original raw wrapper failure. No accepted compiler
report or complete actual read/source-file trace was published. Therefore no new
positive pass, full actual routing acceptance or corrected-negative proof is claimed.

Dependent work stopped. **The negative consumer was never launched.** Its two
exclusive raw files remain empty, meaning UNRUN, not PASS. All observed owned
processes and streams closed naturally; the exact owned work census passed before
removal. No retry, new controls, syntax child, build or semantic replay occurred.

## Qualified assessment and separate denominators

| Evidence | Result |
| --- | --- |
| Immutable v12 semantic layouts | historical 71 each; 284/284 PASS |
| Immutable v12 raw type cohort | historical 4/5; TS2305 expectation mismatch retained |
| v13 positive companion | 1 launch, wrapper exit1; 0 fresh accepted type passes |
| v13 corrected negative | 0 launches, UNRUN; no corrected-one proof |
| Composed type acceptance | remains 4/5, **not composed5** |
| Historical loaded mutants | 3 detected; not rerun |
| Historical fresh-child restores | 3 PASS; not rerun |
| Historical binding negatives | 3 refusals; not rerun |
| v12 coordinator | original exit1 / overall HOLD, unchanged |
| v13 outer/coordinator | exit1 / HOLD |

Original evidence commit `b94bd13b156320d713d692c11f85f655cda68690` and target
preseal `c5af63a2f6b9053ccd1d4b7b0fa2e99f4f74175a` are immutable. The original
negative really rejected with TS2724/exit2, but its old TS2305 expectation remains
failed. Compiler-native createTarCommand suggestion is not a product fault.

Private writer settlement remains historical **SOURCE_LINKED_CONDITIONAL_JOIN**,
not a private-Promise timestamp. Historical per-layout 295 closed streams and
167 fulfilled registrations (1180 / 668 across four layouts) are separate from
that source-qualified claim. No new runtime/mechanical credit is added.
Defaults remain 78; root exports unchanged. M1A remains scoped and limited:
no native Git/oracle, private engine, network, packed-readiness or superiority claim.

## Exact bindings and disclosed scaffold delta

- Git source: `9885390fb11454fa194a3e60fdbef198dbfdf633`.
- Original base: `8437e4eda904e1248c25eeef0d9d455b1d251495`, derived-only
  five-component tree, recomputed from authenticated canonical tree bytes;
  no stored-commit claim. All 279 selected source paths bind stored revisions/blobs
  through NUL-delimited Git inventories; this is not the full repository tree.
- Source INPUTS SHA256: `091b9bad6694e47ac0f831ed0883db369e1f39e690dc8271b505f527168caacf`.
- Full package: 898/898 original regular members, archive SHA256
  `68541722217fb3f88f7317750c8f1a66042ea090f2c769564b9afc14372dfe68`.
  All 898 were physically rehydrated under v13/work/package with exact modes,
  then guarded through cleanup. No rebuild, install or product import.
- Original negative consumer SHA256:
  `ed9ef7fc39f5d9d2c926d21fabd850fdeb8393a47b9ef37b48876b30b38f1b55`.
- Original positive consumer SHA256:
  `864908fc03222fbed3631a103dce49eda597c28ac00ad3074696f711895e8648`.
- Node v22.22.2 SHA256:
  `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
- TypeScript 5.9.3 public API entry typescript.js SHA256:
  `3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675`.
- Original tsc.js entry SHA256:
  `2cffde0b8c6760dfb0b5b0382bbb7e00ba6a8b2d981b9205b256a700a481d983`.
- PRESEAL SHA256:
  `359b1d3310bcd133329e6e89c653f58aabeb2d60910915f8d47e2de0776dd5c3`.

Both consumers keep the same actual files, bytes and logical paths under
v12/types. Their exact original CLI argument arrays are sealed unchanged.
Scaffold change is explicit: public CompilerHost/API replaces the CLI entry to map
original logical v12/RUN-01/work paths to authenticated new v13 work, not ambient
dist. Type-root/source-package rehydration comprises 112 additional files from
the authenticated original working archive. Full routing membership is 1260 files.
This mapping was presealed, but the failed wrapper prevents completed routing
acceptance. The old working directory was not recreated.

The corrected **expected**, not newly observed, primary diagnostic is exactly:

```text
../../../types/negative-public-root.ts(1,9): error TS2724: '"/Users/kjopek/Workspace/safe-bash/tests/commands/git-independent-20260828/m1a-continuation-v12/RUN-01/work/physically moved app/node_modules/virtual-bash/dist/index.js"' has no exported member named 'createGitCommand'. Did you mean 'createTarCommand'?
```

EXPECTATION additionally binds code/category/start8/length16/line1/column9 and one
supplemental TS2728 message at archive/index.d.ts line5/column25, start309/length16:
`'createTarCommand' is declared here.` No arbitrary compiler failure is accepted.

## Capture, resources, integrity and preparation

Outer/coordinator PID65407 and one compiler PID65426: **2 controlled processes**,
peak2 (ceilings6/2). Compiler exit1/signal-null, stdout/stderr/process close all
observed; zero rescue signals, zero unknown owned retirement. Child reports zero
nested-process and zero network attempts. This is not an OS-global process census.

Measured outer through publication and descriptor closure: **4771.265833 ms**,
well below300000 ms. Final timing record marks its own write tail unmeasured;
the later outer summary includes completed publication/closure. Captured files
total **11933 bytes** including duplicated role/aggregate stderr; ceilings16MiB.
Observed owned-disk peak **8374197 bytes**, ceiling128MiB, not RSS. Work removed.
Post-run data inspection, evidence authoring and Git publication are separately
scoped metadata activity, not additional compiler children or subject runtime.

Seven complete censuses pass before, after positive and before cleanup; six pass
after cleanup. Their entries are v5=25, v11=36, v12=126, TypeScript=147,
@types/node=83, undici-types=41, owned work=1069 (1010 files plus59 directories).
Each checks modes/content and new entries, not only original tracked paths.
Individual archive/source/tool/consumer hashes also pass; owned harness/capture
membership checks reject unexpected entries. Fresh publication audit is AUDIT.

PREPARATION records two DATA-only failures before sealing: directory-as-file tool
manifest handling, then incorrectly demanding a stored commit for the derived
base. The latter wrote only authenticated new owned rehydration; preparation
subsequently verified those exact bytes/modes without overwriting them. Original
terminal failures and corrections are disclosed, not compiler retries. The final
preparer has nine metadata Git children plus its Python owner; earlier attempts
have four/five known processes. Interactive shell/read/patch helpers are separately
outside that count; no universal preparation-process total is asserted.

The preserved preseal should not be rerun. Further correction/execution needs a
new root assignment and version; this leaf stops with the precise blocker above.
