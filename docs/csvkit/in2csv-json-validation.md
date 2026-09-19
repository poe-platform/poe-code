# JSON/NDJSON native-type validation

The implementation changes are restricted to the existing JSON importer, a native-value table caster in the csvkit domain package, decoder diagnostics, and independent safe-bash test registration. The fourteen executable descriptors, argv syntax, public engine entry points and explicit capability boundaries remain in place. No product subprocess or Python fallback was added. README files, unrelated edits, staging and Git delivery were not modified.

The original executable was acquired with the frozen CPython 3.14.2 runtime dependency hash lock, including csvkit 2.2.0's source archive SHA-256 `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`. All 49 captures use the exact recorded minimal environment. `in2csv-json-native-reference.json` retains stdout, stderr and status. Canonical tests inject the recorded warning deployment path without accessing that path on disk.

TDD initially reproduced 13 failures in 17 native-value cases plus SDK execution: native precision, scaled Boolean values, mixed booleans/numbers, locale reinterpretation, native string-null policy and empty iterable roots. Five additional cases reproduced unnamed-header/iterable-root gaps. Expanded malformed-record inputs reproduced the CPython 3.14 trailing-comma diagnostic. A different agent reproduced explicit UTF-8 BOM rejection and bare-CR borrowed stdin splitting against the actual safe-bash plugin and native reference. Fixes followed those failures.

Completed verification:

- Maintained uncached selected workspace build: `npm run build:workspaces -- --workspace=@poe-code/csvkit`, including the declared office-package dependency closure.
- Maintained package unit route: `npm run test:unit --workspace=@poe-code/csvkit -- --reporter=dot`; 51 files, 2,776 passed, one skipped and six TODOs. The latter seven are not compatibility passes. Final failing regressions were fixed so native values do not silently qualify unmeasured inference locales, and zero-column rows match the original warning with injected provenance.
- Maintained package lint: `npm run lint --workspace=@poe-code/csvkit`; ESLint plus production and test TypeScript checks passed.
- Focused uncached safe-bash execution: independent JSON review, user-edge, stress and output-ownership files; 134 tests passed, none skipped. Following the zero-column fix, the different agent's latest uncached independent review passed all 35 tests, including exact original empty-object warnings for stdin and named memory inputs.
- Integration-input declaration checks: 109 passed, none skipped.
- Actual safe-bash output captured through the repository screenshot utility and visually inspected: the full large integer and inferred Boolean render as the original CSV bytes. The generic screenshot target binds the explicit csvkit plugin; the root interactive CLI does not provide those capability settings.

The maintained safe-bash typecheck passed its source/test and 26 current consumer groups, including expected negative-consumer rejection. Repository ESLint completed with zero errors and two warnings; the final csvkit code changes additionally passed the maintained package lint. No full repository unit run or release qualification is claimed.

The source/case map and explicit unsupported profiles are in `docs/specs/in2csv-json.md`. Nested serialization remains a requirements conflict: the request forbids flattening, while Agate 1.14.2 and original csvkit captures flatten recursively. The existing behavior is retained pending resolution. Unnamed/zero-column warnings without injected provenance and other unmeasured cases remain blockers. Temporary oracle installations, logs and screenshots from this task are purged after final verification.
