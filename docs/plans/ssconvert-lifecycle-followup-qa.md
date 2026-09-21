# Conversion lifecycle follow-up QA

## Procedure

Preserve the inherited implementation and evidence. Authenticate the official archive retained only in `out/ssconvert-lifecycle`, and compare `src/ssconvert.c` conversion stages with the shared JavaScript engine. Use the separately captured dependency/plugin/locale profile described in [the oracle procedure](ssconvert-lifecycle-oracle-qa.md); do not use native code as a product fallback.

Before repair, run the original memfs compound regression combining graph export, explicit recalculation and `resolution=0b10`/`0o10`. Confirm exact diagnostics, recalc ordering and unchanged namespace. After repair, have a different agent independently stress the actual CLI/SDK engine and negative controls. Run the maintained package unit and lint routes and the selected uncached build closure, followed by the existing Safe Bash virtual-command integration suite.

For visible diagnostics, run the maintained screenshot route against the built public virtual-command host retained in `out/ssconvert-lifecycle/visual-host.mjs`, with `ssconvert --export-graphs --recalc -T png -O resolution=0b10 input.csv graph.png`. The host has no formula binding, so separately inspect `ssconvert --export-graphs -T png -O resolution=0b10 input.csv graph.png` to observe the image-option diagnostic. Inspect the resulting image. Store temporary captures under a new owned `out/ssconvert-lifecycle-followup` directory and remove only those new captures after inspection.

## Evidence and limits

Archive SHA-256 reauthenticated: `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. No primary source acquisition outside `out`. The inherited source confirms image-option validation belongs inside the selected-sheet save loop, after transforms; moving it earlier would be incorrect.

Two new regressions failed before the repair: JavaScript accepted binary/octal values and reported missing rendering capability instead of invalid image options. Both passed after decimal-prefix parsing replaced general JavaScript number admission, retaining the supported whole hexadecimal integer form. This finding is authenticated-source evidence (`cb_image_export_options` calls `atof`), not a newly executed full-native differential case. The captured Gnumeric profile remains the reference; its removed container and absent host native binary mean fresh native runtime cells are unavailable.

Full C hexadecimal-float, signed hexadecimal, trailing hexadecimal junk, and non-ASCII whitespace parsing remain unqualified. Injected formula callbacks validate ordering rather than numerical fidelity. All other mismatches in the inherited lifecycle QA remain outstanding. Checkpoint/replay, real provider permissions, native rendering and binary-format fidelity require separate qualification; they are not passes from these focused tests.

## Executed checks

- `npm test --workspace=@poe-code/ssconvert`: passed fresh, 399/399 before independent follow-up tests.
- Independent follow-up added 26 cases and initially passed the cumulative 425/425 run. Cumulative lint then rejected its empty async-generator fixture (`require-yield`) and warned about an unused destructured filesystem binding. The reviewer corrected those test fixtures without product changes; final cumulative checks are recorded below.
- `npm run lint --workspace=@poe-code/ssconvert`: passed ESLint, product and test TypeScript.
- `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache`: passed selected one-workspace build; maintained graph reported 85 workspaces/235 edges.
- `node --import tsx --test packages/safe-bash/tests/commands/ssconvert.test.ts`: passed 19/19 actual virtual-command integration cases, including URI/streams, mounts, bytes, authority/accessor denial, input budgets, aliases, publication and diagnostics.
- Markdown visual procedure: screenshot capture passed; underlying invalid-option command exited 1 as expected. Inspected the image and verified the complete readable option diagnostic. No screenshot test added.

Full repository build/test/lint were not run for this package-local parsing repair; focused checks are not broad-gate passes. No workflows, exports, shared infrastructure, README, Git delivery or publication changed. The inherited failed SafeFS consumer typecheck remains unresolved and is not replaced by the passing virtual-command suite.

Product candidate source hashes: `image-options.ts` SHA-256 `897447a2927b7287eb0eca3506326ae5e4403a4e0dff3dccfa113cf672aed142`; shared `engine.ts` SHA-256 `4196eae7ef8892762a40cdf3c6a0b0e710bad9a32572d47fd9202f13fb9e4904`; `output.ts` SHA-256 `b9176ef721eb09a96d58c7057dd732cd0946e13170a3bf278cbb6d30ca6440af`; `transforms.ts` SHA-256 `707cc27e6882843b88913f6f9f49d155762a6741a9ffba6ffb6ba85b61583da3`. No new local commit was created. Independent tests must assess these same product bytes.

Final corrected-candidate maintained checks: fresh package test passed **425/425 in 29 files**, zero skips/failures; package lint passed ESLint and product/test TypeScript. The [independent reviewer procedure](ssconvert-lifecycle-followup-stress-qa.md) records 26/26 uncached focused passes and its own final maintained lint pass. Product bytes remained unchanged through these checks, build, integration and screenshot inspection. No tests spawned native utilities, wrote fixture files to the host or queried LLMs. New temporary screenshot evidence was purged after inspection; inherited source/profile captures were preserved.
