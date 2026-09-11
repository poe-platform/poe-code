# NumberFormat CLI bundle initialization failure

## Validated evidence

NumberFormat ecf4cf21b is on remote main and scoped package 0.1.450 published.
CLI release 34224902433 remains active, but checks job 102057743652 failed its
CLI smoke commands with SyntaxError: Unexpected reserved word. Local
`node dist/bin.cjs --version` reproduces the error on Node 22.23.2.
`node --check dist/index.js` identifies line 127339: `await init_values()` inside
the non-async initializer for packages/safe-js/src/interp/intrinsics.ts.
The generated __esm wrapper is invalid JavaScript; no CLI publication is claimed.

The NumberFormat backend introduced conditional top-level await to import the
portable engine. Inspect its propagation through the circular value/intrinsic
graph before choosing a fix. A candidate is synchronous static backend imports
with the same feature-based native/portable selection and lazy locale data;
do not drop Node 18 support or substitute incomplete native rounding behavior.

Required checks: reproduce invalid bundled syntax in a focused regression,
preserve Node 18 and modern NumberFormat behavior, run maintained root bundle
and packed CLI smoke commands, measure fresh startup, and verify appropriate
unit/build/lint checks. Commit and push this separately from ListFormat.

ListFormat's unexcluded workspace regression 13918 is currently active with
source/tests unchanged; no initialization fix has been made yet. Its log is
/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-listformat-unit.T1rqPYmTPU.

## Minimal in-memory reproduction and candidate

Bundling `export async function load(){return import("./packages/safe-js/src/run.ts")}`
with esbuild bundle:true, platform:node, target:node18, format:esm,
packages:external and write:false reproduces the defect in about 0.34 seconds.
Reparsing the emitted JavaScript with esbuild.transform fails at generated line
1021 on `await init_object_model()` inside a non-async initializer. This uses
the actual current source graph, not a mocked esbuild result or stale dist.

An onLoad-only, in-memory candidate adds a static namespace import of
numberformat-portable and changes the conditional backend binding to choose
undefined or that namespace instead of awaiting import(). All other source and
build options remain identical. Its 8083922-byte bundle reparses successfully
(about 0.73 seconds total). No repository source/test/build artifact was edited
for either probe. Store keys bundleInitializationProbe and
bundleInitializationStaticProbe retain the exact commands.

After active regression 13918 terminates, add the failing real-bundle syntax
test, implement the small backend change, verify semantic/startup impact and
root packed CLI smoke behavior. Preserve optional backend selection and all
previously validated precision/locale/snapshot behavior.

Executed the in-memory candidate with vm.SourceTextModule and SyntheticModule
links to the declared external imports, then dynamically loaded run and checked
NumberFormat floor rounding plus ListFormat output. Node 22.23.2 and Node 18.18.0
both returned ["1", "a and b"]. Node 18 initially failed the diagnostic's relative
URL construction from eval import.meta.url; using pathToFileURL with the explicit
working-directory path corrected that probe-only setup. No artifact was written.
The runtime execution probe is stored as bundleInitializationExecutionProbe.
This supports the candidate but does not replace root packed smoke qualification.

Extended the in-memory candidate execution on Node 18.18.0 (20121) and Node
24.14.0 (71403): exact 100 fractional digits, a 30-digit decimal string without
rounding, negative floor rounding, and unchanged host Intl.PluralRules identity
all passed. The same runs retained the original dynamic-load and ListFormat
checks. Store key bundleInitializationPrecisionProbe contains the command.
Source files remain unchanged while regression 13918 runs.

Regression 13918 terminated with 20500 passing tests, 37 skips and the same six
weak-collection/host-promise property failures, no ListFormat failures. Added
numberformat-bundle-initialization.test.ts using actual esbuild output in memory;
77774 failed in 253ms of test execution with the exact non-async await error.
Implemented the two-line static namespace import/binding change. Focused run
11728 covers the bundle regression, portable backend, NumberFormat and ListFormat.
Full maintained root build 95306 is running for real CLI bundle/smoke validation.
This fix remains separate from the uncommitted ListFormat files.

Focused run 11728 passed all 108 tests in four files, and ESLint 38416 passed.
Full root build 95306 passed 70 declared workspace builds plus root codegen,
TypeScript, wrappers and bundle generation. Python's undeclared build is not
counted as a pass. The actual rebuilt dist/index.js now passes Node 22 syntax
checking; node dist/bin.cjs --version exits successfully instead of failing.
Packed-consumer smoke 66124 is active with --prebuilt, so it qualifies the
completed build without rebuilding during installation. Protected user staging
remains patch ID 69df99c443cea05ae0f9e88dae5d20292332d8b8.

Packed smoke 66124 passed all 20 CLI commands and all four SDK/public-import
checks, including the previously failing workflow prompt previews. Node 18
syntax/startup checks also passed (58079). Screenshot 10454 used the maintained
renderer directly on the completed bundle, avoiding a rebuild during packed
qualification; screenshots/node-dist-bin.cjs-help.png was visually inspected and
shows coherent, complete help output with no syntax error. The source test
regression, full build, focused lint and packed smoke now support delivery of
the initialization fix separately from ListFormat. No claim that the six
unrelated explicit JavaScript gap tests have been fixed or that CLI release has
already published.
