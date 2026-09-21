# Cell updates and calculation QA

Task: `cell-updates-and-recalc`. Product: TypeScript ESM `ssconvert` in
`packages/ssconvert`, shared by the SDK and explicit Safe Bash virtual command.
Native utilities are separate QA oracles and never a runtime fallback.

## Procedure

1. Authenticate the retained official Gnumeric 1.12.61 archive in `out` against
   SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Build unchanged source with GOffice 0.10.61 in an isolated Docker context
   `colima` container `ssconvert-updates-oracle`, with only task evidence mounted
   writable and retained archives mounted read-only. Capture dependencies,
   plugins, locale, timezone, binary identity and build configuration.
2. Use original small CSV and OOXML fixtures to measure ordered repeated entry,
   active versus qualified sheet coordinates, ranges, malformed/named targets,
   empty text, inference, apostrophes, formula entry, repeated dependent edits,
   automatic/manual caches and `--recalc` flag order. Capture argv/status and
   independent stdout/stderr/output bytes. Inspect exported OOXML formula caches.
3. Measure clipboard and merge separately. Include a bad second update and an
   existing destination to distinguish first-error effects from successful save.
   Do not infer clipboard transforms from ordinary conversion.
4. Before implementation, run an in-memory regression proving the missing
   default cell-text handler. Unit tests must use injected capabilities and memfs;
   no native processes, host file creation or LLM queries.
5. Implement measured behavior under workbook/updates, then run package lint and
   unit tests without cache. Build the explicit Safe Bash workspace closure with
   the maintained uncached build runner. Run focused virtual command tests and
   shared API checks. Inspect a CLI screenshot for update/error output.
6. Have a different agent stress/fix the implementation, with root retaining
   export/integration/Git ownership. Reverify changed scope after repairs.
7. Reduce actual verified coverage and remaining mismatches here, remove only
   task-owned scratch after reduction, and stop/remove the owned oracle. Do not
   edit README files, push or publish.

## Reviewed source and regression

Authenticated `src/ssconvert.c:1241–1285`: `apply_updates` parses against the
first sheet, normalizes relative references against the active view, applies
text to that active sheet, processes repeated strings in order, stops at the
first invalid reference, and runs `gnm_app_recalc` only after successful updates.
`src/sheet.c:2957–2994` fills a range, clears merged non-corners, and queues
dependents. `src/parse-util.c:824–876` infers values before parsing expressions,
with string fallback. `src/ssconvert.c:1468–1470` forces all formulas only for
`--recalc`, followed by ordinary app recalculation. The clipboard path at1539
applies updates without the ordinary conversion's later transform stage; merge
does not call `apply_updates` on its sources.

The initial six-case regression failed with `Unsupported ssconvert feature:
cell update expression` after correcting its injected I/O fixture. The first run
without injected filesystem failed at read admission and did not validate the
feature; that setup error was corrected before implementation.

## Verification and remaining coverage

The unchanged native binary SHA-256 is
`d7b57fbb10a99097326d381f6e8c6ab9150092fca78cd03d7f41e5c968d64e82`,
matching the retained lifecycle oracle. The fresh reduced
[profile](../ssconvert/cell-updates-and-recalc-profile.json) records archive,
container, dependency, shared-library, plugin activation, compiler and locale
identity; every native invocation retains independent reversible stdout/stderr.
Build setup failed first for an incorrect pxlib package name and then for a
missing librsvg development dependency; both were corrected before unchanged
source compilation. Activation inventory reports no activation errors.

There are 70 retained observations, including five unqualified setup/fixture
experiments. All **61 offline domain comparisons** match for values, formulas,
caches, active-sheet effects, Unknown placeholder namespace, exit status and
diagnostics. These compare original injected workbook fixtures to native OOXML
cell records, not exported binary file bytes. The comparisons include unchanged
caches, dependent repeated writes, manual caches/new formula absence, force flag
order, invalid targets/first errors, range/reversed/span acceptance, mixed-dollar
formula relocation, inference and text-formatted entry. Default/qualified sheet
resolution uses the maintained range parser; the default text handler clips
iteration to the active sheet's bounds as upstream does.

Separate native captures verify clipboard values 8/9/10/99 in automatic mode and
8/2/3/99 in manual mode even with `--recalc`; no later forced stage runs. Native
CSV merge succeeds with malformed `--set` and preserves source data. Corrected
unequal-sheet clipping populates exactly 16,384 Small cells through DX128 and
leaves Large untouched, status 0 and empty stderr. The initial namespace-prefix
experiment changed `gnm` to `ns0`, causing upstream's literal attribute lookup to
ignore dimensions; it is preserved as failed fixture evidence. Likewise the
nonexistent `--export-clipboard` probes, one-input merge usage error and duplicate
XLSX-name merge conflict are not counted as successful product coverage.

Final root verification:

- Fresh maintained `npm run test --workspace=@poe-code/ssconvert`: **592 tests,
  40 files pass**. All file effects use memfs; native and LLM calls are absent.
- `npm run lint --workspace=@poe-code/ssconvert`: clean ESLint and both production
  and test TypeScript checks pass. Package Vitest/lint scripts have no task cache.
- Maintained selected closure `npm run build:workspaces --
--workspace=@poe-platform/safe-bash --no-cache`: passes, including native npm
  build/postbuild lifecycle. No fixed dependency membership was substituted.
- Focused actual virtual command suite: **24 tests pass**, including CLI/SDK
  equality, exact diagnostics and unchanged existing destination after first
  malformed update. Existing unsupported-operation tests now exercise the solver
  capability because recalculation is implemented; their namespace and diagnostic
  assertions remain intact.
- Focused strict ES2023/NodeNext TypeScript compilation of the virtual command
  suite passes with the workspace's exact-optional/unchecked-index settings.
  Focused ESLint of the virtual command and suite passes.
- The maintained broader Safe Bash typecheck fails before candidate checks:
  `Public SafeFS must preserve shared SafeJS runtime identity`, actual undefined,
  expected `./packages/safe-js/dist/safe-fs.js`. Root metadata is preserved. This
  route is **not a pass**; focused checks do not imply a full repository gate.
- Root visually inspected successful repeated updates and first-error screenshots
  from the maintained `npm run screenshot` route with an explicit virtual-command
  SDK host. Output shows A1=8/A2=9/A3=10 and exactly `Failed to set cell Named=9`.
  This command is opt-in in Safe Bash rather than a poe-code top-level command,
  so the generic screenshot route targets its actual invocation.
- A different agent independently stress/fixed flat-AST stack exhaustion,
  aggregate capacity admission, cancellation/error identity, namespace effects,
  text-format inference and clipping. **24 independent cases pass**; see
  [its procedure](ssconvert-cell-updates-stress-qa.md).

Known unsupported behavior: default calculation supports arithmetic/references,
named values/errors and SUM, while other functions, unsupported expression
syntax, general text coercion and circular/iterative calculation fail explicitly.
The existing merge-reference-record boundary is retained. Host-injected cell-text
and formula capabilities remain available; forced versus dirty stages are now
explicit in the formula capability contract.

Unmeasured behavior includes full expression/range relocation grammar, whole-row
and whole-column formula relocation, reversed formula-reference endpoints, 3D
and sheet-scoped name relocation, other locales/date/currency grammars, formatted
entry beyond general and top-left @, wholly outside-sheet diagnostics, very wide
formula/resource graphs, every budget boundary, mid-execution host cancellation,
and missing importer caches without importer-supplied dirty state. Real importer,
exporter and clipboard serializer byte parity is outside this domain comparison.
The profile enumerates these limits; none are counted as passes.

No README changes, branches, commits, pushes, publications or release actions.
Task-owned scratch is reduced into the profile before cleanup; retained prior
`out` directories and all unrelated edits are preserved.
