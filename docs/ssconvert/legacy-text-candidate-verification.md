# Legacy text candidate verification — September 20, 2026

The three existing read-only providers were audited and repaired rather than replaced. Their released probe signatures/priorities and lack of writers remain as recorded in [the reference profile](legacy-text-reference-profile.json). Primary archive SHA-256 was freshly verified as `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. Native executable and Applix/Oleo/SC plugin hashes freshly matched that profile. Source and oracle remain exclusively under `out`; no product fallback or native unit-test execution was introduced.

## Candidate binding

This is a working-tree candidate, not a Git commit. SHA-256 after final implementation:

| File | SHA-256 |
| --- | --- |
| `packages/ssconvert/src/codecs/applix.ts` | `90f99b795b3068d62a59c60f50352cb169c5af695cc2ec37ae998151a379c4bb` |
| `packages/ssconvert/src/codecs/oleo.ts` | `dfc995fcd4d6b884bda37c5e538be06d447b3b0cd8ebc08c0dff83913bda5a68` |
| `packages/ssconvert/src/codecs/sc.ts` | `a0f41b3dd45c323eb48987362d854383227af7cf48a179756b4c571f66675c7d` |
| `packages/ssconvert/src/codecs/legacy-text-independent.test.ts` | `4e939ea5f6c01d7f6eb6bb4130c9a94ceeffeb0c115af95a320b3aab06430fb5` |
| `packages/ssconvert/src/codecs/legacy-text-candidate-stress.test.ts` | `7d35f7f697ab3012320c10457a720f9a2015525029036bc65eff3094f0378bb7` |
| `packages/safe-bash/tests/commands/ssconvert-text.test.ts` | `a1e8bda7cb6ef3d90bd4a6691d03880335582b24cd0b0882575042985f2ed24f` |

## Regressions and independent verification

Two original Oleo regressions failed before repair: `r1x;c2` and `c2x;r1` incorrectly continued parsing fields after the unconsumed `x`. The reader now advances over exactly the consumed integer, preserving native record termination and coordinate side effects. A default-style replacement negative control passed without requiring changes.

A different agent reproduced four SC failures: malformed label/leftstring/rightstring records created cells, enlarged dimensions and added boundary warnings before validating quotes. Validation now precedes cell fetch. Independently verified native malformed labels leave a 65536×256 sheet with only A1=7; an invalid out-of-bounds label followed by `let ??? = 1` returns status 1 with exactly `W On worksheet SC:\n  W Cannot parse let ??? = 1\n\n`.

The independent agent also reproduced Applix missing shared-expression IDs replacing a prior value. The released NULL-expression guard makes assignment a no-op: new targets stay blank and prior targets retain their value. Separate native runs confirmed status 0 and CSV `\n` or `7\n`, respectively. Formatting still applies before assignment. Product emits the static native assertion through injected diagnostics.

Original Oleo conversion/checkpoint/replay was independently measured against native: malformed coordinate followed by C1 cached 7/formula `1+2` gives CSV `,,7\n`; XML omits the supplied cache, and reopened CSV is `,,3\n`. An initial replay expectation of 7 failed and was corrected only after native confirmation; no product code was changed for that behavior. The virtual integration case checks the same sequence and untouched sentinel/namespace contents.

The [manual procedure](../plans/ssconvert-legacy-text-candidate-qa.md) and [independent stress procedure/results](../plans/ssconvert-legacy-text-candidate-stress-qa.md) cover unsupported directives as data, expression translation, bounded cells, replacement controls and cooperative cancellation. Fixtures are original, deterministic and in memory; no generated seed is involved.

## Checks

| Check | Result |
| --- | --- |
| Final `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache` | PASS; maintained three-workspace closure |
| Final `npm test --workspace=@poe-code/ssconvert` | PASS; fresh execution, 194 files / 4,719 tests |
| Final `npm run lint --workspace=@poe-code/ssconvert` | PASS; provider generation, ESLint, source/test TypeScript |
| `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache` | PASS; 18-workspace closure and native postbuild; followed by final ssconvert rebuild after the last Applix repair |
| Final six registered ssconvert command test files via `node --import tsx --test` | PASS; 77 tests, no skips/cancellations |
| Maintained screenshot route, actual virtual SC conversion | PASS; captured and visually inspected `7,9` |
| `npm run lint:eslint` | PASS, exit 0; complete guarded run, 16,848 configured/linted subjects, zero errors and four warnings |
| Safe Bash maintained `npm run typecheck` | FAILED before compiler; zero consumer/runtime checks |

Safe Bash typecheck failed on `tests/plugins/qualified-current-release/peer.mjs:245`: legacy public SafeFS identity requires root `./safe-fs` export to map to `./packages/safe-js/dist/safe-fs.js`, but current manifest has no such export. Current boundary tests explicitly expect this fail-closed rejection. No unrelated export/authority guard was changed. This gate is incomplete, not a pass or a compiler failure.

One intermediate full ssconvert workspace run failed while the independent agent's initially incorrect unknown-shared-ID rejection expectation was present. That expectation was investigated against source/native and replaced with the valid no-op regression. The final entire workspace run passed; a focused rerun alone was not counted as the workspace gate. One screenshot attempt failed with ENAMETOOLONG from a generated filename; the supported explicit output option completed successfully.

## Mismatches, skips and unverified cells

Exact diagnostic compatibility remains incomplete. Native Oleo warnings and Applix missing-shared-expression critical messages contain dynamic PID/time wrappers. Product preserves static messages but does not emit native process-shutdown `Leaking N values.` or its shutdown ordering. No native leak is reproduced.

The pre-existing [unmeasured syntax/profile matrix](legacy-text-verification.md) remains unverified: exhaustive malformed syntax, C overflow, floating-point boundaries, all expression constructs, multibyte Applix cache mutation, rename collisions and alternative locales/fonts/dependencies. This cohort does not qualify browser/workerd/foreign realms, packed consumers or every compatibility runtime cell. No performance measurement or generated corpus is claimed. Unsupported/unmeasured cells are not passes.

No full repository `npm test`, root `npm run build`, complete root lint chain, complete Safe Bash suite, E2E or release gate is claimed. The change is confined to importer internals and their focused tests; workspace closure and command integration were selected. Workflow checks were not applicable. No commits, pushes, publication or README edits were made. Unrelated edits and inherited source/oracle artifacts were preserved.

The root ESLint completion summary reported `complete:true`, `failed:false`, empty unprocessed directories/entries and no unknown descendants. Its four warnings concern `docx/src/operation-types.test.ts`, Safe Bash's `docx/table-model.test.ts` and `zip-review.test.ts`; these files were not edited. The tool output was truncated when returned to the agent, so no complete raw receipt-output artifact is claimed. The explicit completion summary and process status were observed; this does not qualify the separate root types/workflow lint stages. Owned temporary oracle fixtures and screenshot were purged after extracting these findings.
