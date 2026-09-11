# #605: provenance-bound historical caller type models

## Status and ownership

September 4, 2026: candidate first prepared and tested in home scratch while root's
milestone gates ran at `be36bc1ca`. After root reported milestone push `ed2a6fa4e`,
the six owned files were integrated with explicit authorization. The final focused
suite has 36 passing tests. The earlier current source-and-tests audit exited zero;
root owns the post-freeze source audit after the reporting and separator fixes.
The complete integrated root gates, commit/push and delivery remain root-owned and
pending. Root separately registered the script test; this patch does not edit its
`package.json` or `integration-inputs.test.mjs` changes. Helmholtz's
`evidence.test.ts` and `invocation-cleanup.cases.ts` corrections remain untouched.

Owned candidate files:

- `packages/safe-bash/scripts/historical-type-models.mjs`
- `packages/safe-bash/scripts/historical-type-models.test.mjs`
- `packages/safe-bash/scripts/historical-type-models/gnu-oracle.d.mts.fixture`
- `packages/safe-bash/scripts/historical-type-models/native-delivery.d.mts.fixture`
- `packages/safe-bash/scripts/typecheck.mjs`
- This plan.

## Defect and authorized correction

Root reported thirteen remaining source-type diagnostics caused by six immutable
historical callers of two intentionally retired helpers. The bounded compiler
baseline independently confirms TS2307 at each of those six import edges.
Retirement `94cf8b10de0189255be6a8e3ebdf8d3d448a6809` deliberately removed runtime
GNU gates. Do not restore helpers, rewrite sealed callers, exclude callers,
filter diagnostics, introduce broad `any`, or add ambient module success stubs.

Declaration-only, compile-only caller-slice models apply only to authenticated
caller/specifier pairs. This establishes no runtime availability, native execution,
GNU qualification or historical gate success.

## Provenance and byte bindings

The module binds literal paths, byte counts, SHA256, exact import specifiers,
historical source path/commit/blob/digest and retirement. Six callers total 20,014
bytes; two model texts total 1,242 bytes. Every caller/model read uses existing
`readRegularInput` with boundaries and the exact individual byte bound. Length and
SHA256 must match. The compiler parses those same authenticated bytes, not a later
reread. The immutable module records contain all six caller hashes.

GNU source:

- Historical commit `4d4f5ca2338cc0020dd17bf2d6b3627c6bbeb78f`, original path
  `tests/commands/diff-patch-stress/gnu-target/oracle.ts`.
- Blob `ffc3617ce5d95d980144df0aa170726908ca684d`, SHA256
  `ad9920197aa38291dfff5d04170c5e1b87cd225bf590c8073a8ebba8c68181cc`.
- Last-retired blob is different: `d51b79cf421f48858a818abb9925fdf0f1191b95`, SHA256
  `f5b758e894e3c867a39740d73f1fac06d9d76f40bcf716a1f59331aa24805095`.
- Model only the shared one-argument `oraclePath`/`oracleIdentity` caller slice,
  not the full last-retired API or an assertion that both source blobs match.
- Model: 229 bytes, SHA256
  `eb7edfd43ad49520012a43d27449005c4282e2f9b0b224f87827643ac640e06c`.

Native source:

- Commit `fa4c80035848ce5eab1efe3ae47862eac03ae7c9`, original path
  `tests/stress/harness-timing-20260827/native-delivery.ts`.
- Blob `100db5ba504bcd9f75db882f7022ef1f95955067`, 8,550 bytes, SHA256
  `3e415abe8d16c9e42037fa16793632c9ea23feb199580c5e6837cb9d886f1bb4`;
  this matches the last-retired source binding.
- Models only `NativeOptions`, `NativeEvidence`, `TimingEvent`,
  `NativeHarnessError` and `nativeDelivery`. Preserve optional arguments/fields,
  literal unions, readonly evidence, nullability, Promise and `NodeJS.Signals`.
- Model: 1,013 bytes, SHA256
  `a8d2bc1b767cd3b31ba1514c29c799dd7b3828dfe03f1886399d0762d2416b84`.

Historical object/path/digest verification was recorded during preparation. The
compiler executes neither Git nor historical helpers. Provenance constants document
that verification; invocation-time admission binds current caller/model bytes and
requires the retired paths to remain absent.

## Compiler boundary

Only the `source-and-tests` subprocess selects the new driver. Build, historical
build-first consumer, source/current consumers, negative checks and resolution
tracing retain the original `tsc` command/arguments. Existing subprocess timeout,
output bound and prerequisite checks are unchanged. Successful source-phase stdout
is now forwarded by the parent, visibly reporting six authenticated compile-only
edges and no runtime availability/qualification in normal maintained typecheck
output. Other successful phases stay quiet; ordinary failure, stderr, negative and
resolution-phase handling are unchanged. The optional report JSON is not required
to see this historical classification.

TypeScript's config parser reads the same `tsconfig.json` with only the existing
CLI `noEmit: true` override. File names, options, project references and config
diagnostics are retained; existing strict mode is required. `createProgram` and
`getPreEmitDiagnostics` retain every diagnostic. No additional source glob, root
exclusions or virtual model roots are added.

`resolveModuleNameLiterals` preserves normal NodeNext modes. Only the exact
authenticated containing-file/specifier pair receives a nonexistent virtual
`.d.mts`. Ordinary resolution must still fail for that pair: restored helpers or
alternate-root resolutions fail rather than hiding a real implementation.
`fileExists` is unchanged. New/current, sibling, wrong-specifier, case-alias and
direct model imports do not receive modeled resolutions.

Real-compiler negatives additionally exposed direct triple-slash references and
explicit virtual source roots as alternate entry points. Both are now rejected.
The host checks only each already-parsed SourceFile's `referencedFiles` against the
two exact virtual paths, including normalized relative aliases; it does not run an
additional source scan or expose virtual `fileExists`. Explicit virtual entries
in parsed root membership fail admission rather than being removed or substituted.
Ordinary triple-slash references and the default root/options arrays are unchanged.

Independent review then found that POSIX path resolution alone did not match
TypeScript's backslash separator normalization. The reference guard now converts
backslashes to forward slashes with `split`/`join` before resolving the exact
virtual path. Both backslash-only and mixed-separator controls reproduce RED and
pass after the correction. This closes a missing-file diagnostic-suppression route,
not an arbitrary API-access or runtime-execution exploit; direct current imports
were already rejected. Plain, dot-path and explicit-root guards remain active.

Original `.ts` runtime paths, adjacent `.js`/`.d.ts` shadows and physical virtual
model filenames must remain absent. Metadata walks reject symlink ancestors and
detect dangling symlink leaves rather than calling them absent. Held paths are
rejected before payload reads. Non-code `.fixture` model texts contain exported
declarations only, with no implementations or ambient modules.

This inherits the existing trusted-checkout/read-admission contract, not atomic
filesystem-race protection or a hostile-host JavaScript sandbox. Injected
filesystem/compiler-host seams are test support, not hostile-host boundaries.

## TDD and bounded evidence

Evidence base: `/home/kjopek/kamilio-validation-569-575.RoFXyZ`.

- `605-models-red.log`: tests precede implementation; RED is the absent module,
  not a claim that behavioral assertions had executed yet.
- `605-historical-provenance.log`: historical digests, byte count and original
  versus package-prefixed last-retired path verification.
- `605-models-scratch-green-attempt-1.log`: 20 pass / 2 fail; corrected synthetic
  unparented import literals to use TypeScript-parsed nodes.
- `605-models-scratch-green-1.log`: 22 pass.
- `605-models-scratch-compiler-controls-attempt-1.log`: 23 pass / 1 fail; alternate
  root fixture initially placed the replacement at the wrong path.
- `605-models-scratch-green-2.log`: 24 pass / 1 fail; standard-library fixture
  needed a matching default-library directory for referenced declarations.
- `605-models-scratch-green-3.log`: 24 pass / 1 fail; incorrect `emitSkipped`
  assumption replaced with an actual no-output spy. TypeScript can report false
  there while producing no output for a noEmit program.
- `605-models-scratch-green-4.log`: 25 pass.
- `605-models-scratch-green-final.log`: 28 pass.
- `605-models-scratch-baseline-green.log`: final 28 pass, including baseline
  TS2307 at six edges and model symbols for the same authenticated callers;
  a current same-directory import still fails. Prior logs remain preserved.
- `605-models-scratch-syntax.log`: Node syntax checks pass for three MJS files.
- `605-models-scratch-declaration-types.log`: two declaration models only,
  TypeScript 5.9.3 / Node 22.22.0, strict/exact optional types, real installed
  Node declarations, `skipLibCheck: false`, `noEmit: true`: zero diagnostics.
- `605-models-repo-green-1.log`: original 28 tests pass after authorized integration.
- `605-models-virtual-access-red.log`: 29 pass / 2 fail; already-loaded direct
  imports remain rejected, but triple-slash access and explicit virtual roots
  initially bypassed edge-only admission. This is a real boundary finding, not a
  fixture mistake or evidence that current direct imports obtained model exports.
- `605-models-virtual-access-green.log`: 32 pass, retaining all original
  controls and adding direct import, triple-slash/relative-alias, explicit-root
  negatives and an ordinary-reference positive control.
- `605-models-current-source.log`: current source-and-tests driver, Node 22.22.0,
  September 4, 2026, 23:32:39.934–23:33:09.709 UTC: exit 0, no signal, no compiler
  diagnostics. Used the maintained 180,000 ms / 33,554,432-byte subprocess bounds.
  No build, historical/current consumer phases or broader gates were run here.
- `605-models-reporting-red.log`: the actual maintained compile function, extracted
  by its parsed declaration and run with a stubbed child launcher, failed to expose
  successful source-phase stdout. No actual compiler subprocess runs in this test.
- `605-models-reporting-green.log`: 33 pass. The reporting control covers
  success/failure for source, ordinary consumer, negative and resolution phases;
  only successful source stdout becomes newly visible. The earlier source-phase
  audit remains preserved; root owns the post-freeze integrated/source audit.
- `tmp/605-independent-models.Zl0I6m/probe-current-ts.log`: independently reported
  separator-alias evidence; retained separately from this worker's reproduction.
- `605-models-separator-alias-red.log`: first reproduction fails on the backslash
  alias; `605-models-separator-alias-red-both.log` separates the controls and records
  plain/dot paths passing and both backslash-only/mixed aliases failing (2/2).
- `605-models-separator-alias-green.log`: final 36 pass, including the reporting
  control and four separately counted reference-path controls. No source-wide
  audit rerun was substituted for root's post-freeze audit.

Tests mutate only memfs. Real standard declarations are bounded-read into memfs,
not fabricated ambient success stubs. Controls cover caller/model drift, held,
oversized and symlink inputs, guarded read delegation, restored helpers/shadows,
declaration-only syntax, ordinary imports, six exact edges, strict/config errors,
root/options preservation, and a clean tiny compile with no output. The six-caller
isolation fixture intentionally lacks unrelated dependencies and remains a failing
compiler program; those diagnostics are neither suppressed nor called a full pass.

## Integration handoff and limitations

Root reported exact registration of `scripts/historical-type-models.test.mjs` in
the runner and its literal membership assertion, with separate
`605-runner-registration-red.log` and `605-runner-registration-green.log` evidence.
Those two root-owned files were not edited by this worker. Root should include
the now-complete six-file implementation in its reviewed integrated gate snapshot.

Root must run the complete maintained integrated gates and delivery checks. The
current source-and-tests phase now passes, clearing the reported thirteen remaining
historical diagnostics in that phase; this is not a whole typecheck/consumer or
root-gate pass. No README,
runtime helper, sealed caller, boundary or unrelated owner file changes. No broad
gates, native oracle execution, resource experiments, CPU/RSS guarantees, runtime
availability, commit/push or release claims.

## Root integration verification

The independent reviewer confirmed both separator-alias refusals against final
module SHA256 `d14a4b8085883e2e072444dcbb69a71f947add66f90d63d17f3fc94a5fcb46eb`.
Root then ran the complete maintained command
`npm run typecheck --workspace=virtual-bash`, not just its source phase.
It exits zero: source/tests, historical build-first consumer, three source
consumer groups, all 26 current consumer groups and all three expected negative
groups pass. The six-edge historical-only qualification is visible in normal
output; runtime execution remains zero. Evidence is
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/batch605/initial-full-typecheck.log`.
Normal full build, workspace units, lint and a repeated full typecheck remain
required on the committed delivery candidate before push and issue closure.
