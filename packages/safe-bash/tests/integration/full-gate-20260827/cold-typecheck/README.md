# Cold source typing versus built consumers

## Configuration-author handoff — independent verifier required

Configuration patch **0c8cf157971e8e8e6aa8bb0e70f97240c41bc609** changes only:

1. `tsconfig.json`: exclude exactly the noncanonical historical program
   `tests/commands/table-text-stress/shared-stdin-review/selected-gnu.ts`.
   Compiler strictness, `src/**/*.ts`, `tests/**/*.ts`, and actual test discovery
   are unchanged. No directory-wide or actual-test exclusion.
2. `package.json`: add `typecheck:consumers`, which runs the existing production
   build and then the dedicated consumer compiler. No exports/dependencies or
   existing scripts change; no package-lock change is needed for a script.
3. `tests/commands/table-text-stress/shared-stdin-review/tsconfig.consumer.json`:
   explicitly list the original entire consumer file, inherit strict options,
   set `noEmit:true` and `skipLibCheck:false`, and override inherited include/
   exclude lists. The file is deliberately checked after build, not hidden.

This is **author validation of a configuration patch**, not independent
acceptance. Root must assign a different verifier before accepting it.
No product, historical assertion, private engine or old evidence was changed.
No whole suite was rerun. The original e36dab2 full gate remains
15,769pass / 110fail / 79skip, explicitly red.

## Why this boundary is appropriate

Root README's development commands place `npm run typecheck` before build;
the script is `tsc --noEmit` and the root configuration includes source/tests.
In contrast, historical `shared-stdin-review/run.mjs:29` and
`corrected-alias.mjs:74` explicitly build before running the `built71` consumer.
Package imports requiring dist are intentional there. The defect is accidental
discovery of that standalone built consumer by the cold source/test compiler,
not an invented defect in package-root imports.

The new command is:

```sh
npm run typecheck:consumers
# npm run build && tsc --noEmit -p tests/commands/table-text-stress/shared-stdin-review/tsconfig.consumer.json
```

It typechecks all branches of the unchanged file; it does not execute the
historical READY gate or obsolete runtime56-command assertion. The dedicated
compiler demonstrably rejects missing dist before build and a type error in
the historical file after build. Meaningful packed API/declaration checks are
also replayed separately, using actual installed tarballs rather than aliases.

## Frozen results — do not conflate the cohorts

The patch parent is **37cc89594a708951d454e3a13c443d701ea9df68**, not the earlier
1836795 inspected while preparing the patch. Another committed test introduced
an unrelated diagnostic before this atomic configuration commit. It is retained:

`tests/commands/stream-next-stress/independent.test.ts:91:95`, **TS7053**:
`keyof Actual` includes `thrown`, absent from the inferred native-result object.
Route this to the stream-next test owner. This patch neither fixes nor suppresses it.

| Check | Frozen0c8cf15 source | Separate e36dab2 + config-only control |
| --- | --- | --- |
| Original root config, no dist | exit2: original6 + unrelatedTS7053 | exit2: original6 |
| Fixed root config, still no dist | exit2: **only unchangedTS7053** | **exit0**, no diagnostics |
| Canonical files included by compiler | **485/485** | **470/470** |
| Source files included by compiler | all | all |
| Standalone historical consumer in cold discovery | absent | absent |
| Dedicated consumer before build | exit2: original6 missing-dist diagnostics | same |
| `npm run typecheck:consumers` | **exit0** | **exit0** |
| Dedicated discovery includes historical file | yes | yes |
| Fresh package/runtime/type controls | pass | pass |

The e36 control overlays only the two config files and the added package script
onto a new regular-file archive. It never edits the earlier historical evidence
or changes product bytes. Config overlays, source revision, archive hashes and
original consumer SHA are explicit in each report. The original consumer SHA
still equals its e36dab2 SHA. The 0c8cf15 cold command is **not green**; the control
isolates the requested fix while retaining the actual new baseline failure.

## Exact negative controls

No assertion uses `@ts-ignore`, `@ts-expect-error`, `any` substitution, broad
exclusions or diagnostic filtering to obtain success.

- A temporary **actual `.test.ts`** file with a string assigned to number causes
  **TS2322** in cold root typing. At0c8cf15, the unrelatedTS7053 remains alongside
  it. The new test file is removed before further checks.
- A temporary appended number/string mismatch in the historical consumer causes
  **TS2322** under its dedicated built config. The original bytes are restored
  and verified; no live author assertion is changed.
- Dedicated consumer typing with no dist rejects the two unresolved public
  imports (**2×TS2307**) and their four downstream implicit-any diagnostics
  (**4×TS7006**). Build is an explicit prerequisite, not stale output reuse.
- The unchanged packed invalid-API fixture rejects missing credentials
  (**TS2345**), a missing credential secret (**TS2741**), and numeric region
  (**TS2322**). The exact diagnostic multiset is required, with compiler exit2.
- The unchanged packed S3 runtime guard rejects an attempted product-source
  import outside the installed consumer. All actual product imports resolve
  within the tarball's dist; the runtime fixture sends **zero requests**.

Packed positives include the existing aggregate/stream-inspection consumer and
S3 root/subpath declaration fixture, strict checking including library checks,
**20 public import resolutions, 60 unique default commands and four actual
virtual pipelines**. Consumer type file lists are realpath-checked against the
installed consumer plus copied TypeScript/Node development declarations; no
product-source fallback is allowed. These are config/API checks, not new native
tool or real-service acceptance.

## Evidence and reproducibility

`evidence/current-final/` records all14 phases for frozen0c8cf15.
`evidence/e36-control-final/` records all14 phases for the separate paired control.
Both retain expected nonzero negative-control statuses, actual cold failures,
source/dependency checks, package hashes, compiler file lists and public results.

Three preliminary failures are preserved rather than overwritten:

- `current-initial/`: the harness expected the old six diagnostics but discovered
  the newly committed TS7053. Its complete original compiler output remains.
- `current-path-check/`: compilation passed; the containment assertion mistakenly
  treated relative `aggregate.mts`/`consumer.mts` as outside paths. Correction
  resolves them relative to the consumer and checks realpaths, not an allow-all.
- `e36-control-initial/`: all cold/built checks passed, but olde36 lacked this
  later audit's public validation scripts. Final control obtains those scripts
  from committed0c8cf15 as explicit **validation fixtures**, not product fallback.

The successful current runner version is preserved in
`runner-before-fixture-origin.mjs.txt`; the final runner adds explicit validation
fixture origins for the older-source control. Both load identical fixture bytes.
No failure denominator is silently rewritten. `patch-scope.json` checks the
three-file scope and unchanged package fields/options; `capture-manifest.json`
hashes every captured byte. `cleanup.json` records exact owned cleanup.

```sh
node tests/integration/full-gate-20260827/cold-typecheck/run.mjs \
  0c8cf157971e8e8e6aa8bb0e70f97240c41bc609 /tmp/full-gate-cold-REVIEW-NEW
node tests/integration/full-gate-20260827/cold-typecheck/run.mjs \
  0c8cf157971e8e8e6aa8bb0e70f97240c41bc609 /tmp/full-gate-cold-CONTROL-NEW --e36-control
```

Use new output directories. These commands do not run `npm test`, access the
private SafeJS checkout, install new tooling, mutate the live product tree or
replace source hashes with mutable HEAD. The verifier should independently
confirm exact exclusion/inclusion, preservedTS7053, prebuild failure, dedicated
consumer negative control and packed positive/negative resolution.
