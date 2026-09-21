# Portable SDK and reusable workbook contract QA

## Procedure

1. Authenticate `out/ssconvert-lifecycle/gnumeric-1.12.61.tar.xz` against released source SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. Primary source stays in out. Use `docs/ssconvert/reference-profile.json` for captured native dependency/plugin/locale provenance; native is a separate QA oracle, never an engine dependency.
2. Before changing exports, run the public SDK regression. Missing `readXlsx` must fail. Then expose the existing implementations and rerun.
3. Build the selected ssconvert workspace dependency closure uncached. Run its maintained tests and lint. Compile `tsconfig.consumer.json` with strict NodeNext and declaration checking, then execute `tests/public-consumer.mts` with tsx against compiled package exports. Both package and root public paths must resolve the same codec implementation.
4. Execute the same consumer with browser conditions. Inspect browser bundling for host builtins; browser-compatible codecs must not imply filesystem/network capability.
5. Independent agent stresses bounded codecs and command/SDK parity after implementation. Preserve failure evidence and record unmeasured cases.

## Complete CLI to SDK mapping

The CLI uses `runCommand` and the same `createEngine` conversion implementation. All calls take an explicit `Operation.signal`; byte I/O is supplied by stream input/destination or configured `FileSystem`. There is no native fallback.

| CLI operation/configuration | Public SDK equivalent |
| --- | --- |
| INFILE / OUTFILE; inferred output | `ConversionRequest.input`, optional `destination`; `Engine.convert` |
| `-I`, `--import-type` | `importType`; `Engine.readWorkbook` import options |
| `-E`, `--import-encoding` | `importEncoding`; explicit `Environment.locale` and `env` |
| `-T`, `--export-type` | `exportType`; `Engine.writeWorkbook` export options |
| `-O`, `--export-options` | Ordered `exportOptions` strings; public `exportOptionPairs` for ordered pairs; CLI scalar is last-wins |
| `-M`, `--merge-to` | `Engine.merge`, ordered `inputs`, `destination`, all inherited conversion controls |
| `-S`, `--export-file-per-sheet` | `perSheet`, resource destination template; engine owns template expansion |
| Exporter `sheet`, `active-sheet`, `sheets` options | Same ordered `exportOptions`; typed `selection` supports sheet IDs |
| `--export-range` | `exportRangeExpression` or typed `exportRange` |
| `--export-graphs` | `graphs`, `exportType`, destination template, ordered options; also `Engine.exportGraphs` |
| Graph resolution | Exporter `resolution` option; injected `RenderingCapability` receives resolved resolution |
| `--set` | Ordered `updateExpressions`; typed `updates`; injected `cellText` capability |
| `--recalc` | `recalc`; `recalculateWorkbook`; explicit formula/runtime function, clock/random/external reference capabilities |
| `--resize` | `resizeExpression` or typed `resize`; explicit resize capability |
| `--clipboard` | `clipboard`, range/destination; `Engine.exportClipboard`; explicit `ClipboardCapability` |
| `--goal-seek` | Ordered `goalSeekExpressions` or typed `goalSeek` |
| `--solve` | `solve`, explicit `SolverCapability`; public solver model/algorithm/run APIs |
| `--tool-test` | Ordered `toolTest` or typed `analysis`; explicit `AnalysisCapability` |
| `-v`, `--verbose` | `verbose`; awaited `Operation.diagnostic`; result diagnostics and exit status |
| `--list-importers`, `--list-exporters` | `Engine.listServices`; `createRegistry.list`, `coverage`, `sourceServices` distinguish source census from installed codecs |
| `--list-image-formats` | `imageFormats`, `profileImageTargets` |
| `--help`, `--help-all`, `--help-gtk`, `--help-libspreadsheet` | Public `referenceText`, `parseCommand`, `CommandProfile.help/groups` |
| `--version`, `--libspreadsheet-version` | `referenceText`, `CommandProfile.version/libraryVersion/configurationRoots` |
| `-L`, `-D`, group aliases | Parsed unused options in released reference; explicit virtual identity `configurationRoots`; never host lookup |
| GTK display/class/name/module/fatal-warning options | Parsed inherited reference options; virtual engine has no implicit GTK host; profile controls metadata |
| Process cwd/env/locale/timezone/system/umask | Explicit `EngineConfig.environment`, resource I/O cwd and injected transport/adapters/descriptors |
| Native optional plugin/runtime services | Explicit codecs, runtimeFunctions, formulas, formatting, rendering, clipboard, solver, analysis, externalReferences; omitted capabilities remain unsupported |

SDK-only operations use the same engine transforms or shared workbook functions: typed cell/range updates, selection, analysis, resize and goal seek, reusable `readWorkbook`/`writeWorkbook`, formula AST editing and rendering geometry. The CLI exposes the corresponding genuine conversion operations through expressions/options; helper APIs do not imply extra native CLI switches.

## Pandoc boundary

Public `readXlsx`, `probeXlsx`, `createXlsxWriter`, `Workbook`, `CapabilityContext` and engine workbook APIs are reusable without private imports. Limits, cancellation, locale and cleanup remain explicit. No Pandoc source or separately blocked gate is changed. This contract does not certify Pandoc XLSX integration.

## Results and limits

Source archive SHA-256 verified against the requested release. Existing captured dependency/plugin/locale profile reused; no new native differential cohort was run in this task.

The preimplementation regression failed at missing public `readXlsx`; after export changes both XLSX editions round-tripped original Unicode and number cells and rejected undersized input limits and cancellation. Further check results are recorded below after execution.

No claim of full Gnumeric compatibility follows from export parity. Optional host capabilities, native plugin implementations, every exporter option combination, locale profile, graph image backend, solver/analysis tool, malformed argv, full browser runtime and complete Pandoc gate remain independently qualified or unmeasured. Historical coverage registers are unchanged and are not current task passes.

### Executed checks (current worktree, September 21, 2026)

- `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache`: passed selected four-build closure.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`: passed selected eighteen-build closure, including postbuild.
- `npm run test --workspace=@poe-code/ssconvert -- --no-cache`: 306 files / 6,192 tests passed. This includes engine conversion, merge, sheet/range/split, updates, recalculation/resize, graph, clipboard, goal seek, solver, analysis, encoding, parser/listing and codec suites. It predates the final compile-time request-field census assertion; subsequent focused public consumer tests passed (two root-owned tests; four independent stress tests).
- From `packages/safe-bash`, `node --import tsx --test tests/commands/ssconvert*.test.ts`: 112 passed, zero failures/skips/TODOs. These are current maintained command tests, freshly executed against the shared package surface. This is scoped integration evidence, not a complete safe-bash gate.
- `npx tsc -p packages/ssconvert/tsconfig.consumer.json`: passed with strict NodeNext, `skipLibCheck: false`, no ambient Node types, public compiled root/package imports.
- `npx tsx packages/ssconvert/tests/public-consumer.mts`: passed compiled codec and engine conversion consumer.
- `node --conditions=browser --import tsx packages/ssconvert/tests/public-consumer.mts`: passed browser-condition resolution on Node; this is not real-browser execution.
- `npx esbuild packages/ssconvert/tests/public-consumer.mts --bundle --platform=browser --format=esm`: successful browser bundle, no unresolved host builtin. Full browser runtime behavior remains unmeasured.
- Scoped maintained lint initially caught the independent test's readonly mutation. Independent agent repaired its test-only mutable view; strict tests/declarations and scoped ESLint subsequently passed. Final maintained lint additionally compiles the persistent published-consumer fixture.
- Standalone `SAFE_BASH_TEST_RG=ssconvert npm test --workspace=@poe-platform/safe-bash` ignored that root-runner selection control and began all 1,346 discovered files. Root terminated this mistakenly broad execution; it is incomplete, never counted as passing. Focused maintained command files were then executed as above.

The request-field census uses `Record<keyof ConversionRequest, string>` so a new SDK conversion control requires an explicit CLI counterpart assignment. It is a compile-time coverage guard, not proof that every assigned operation has native differential coverage. Typed workbook/AST/rendering helper functions remain reusable implementation APIs, with corresponding conversion controls documented above.

No visual CLI output changed. No screenshot claim is made. No README, Pandoc blocked gate, source coverage register, Git commit, push or release was changed. Temporary task logs and browser bundle are purged after summarizing their results; preexisting out source/oracle artifacts are preserved.
