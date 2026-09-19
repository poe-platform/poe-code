# Public SDK integration validation — 2026-09-18

This session continued the existing csvkit implementation. It does not qualify
full csvkit 2.2.0 compatibility, publication, or the separate ssconvert plan.
The frozen archive/profile remain those in reference-profile.json.

## Regressions and changes

An original compile-only regression reproduced five requests accepted by the
old public SDK signature: csvcut inference, array selectors, scalar SQL query
repetition, malformed DB option tuples and an invented executable. Strict
TypeScript reported five unused expected-error directives before the change.
Generated command-specific settings now reject those requests. The frozen
inventory supplies 387 setting applications across fourteen commands;
this is declaration coverage, not 387 runtime compatibility passes.
JavaScript runtime rejection tests remain active.

A public constructor regression failed because WorkbookInput and Runtime were
not exported. Both now expose the actual CLI workbook reader/invocation classes.
The maintained public-consumer route then rejected transitive @e965/xlsx types.
CsvkitWorkbook, CsvkitWorksheet and CsvkitWorkbookCell now own the public data
shape; the guard was not widened. The separate ssconvert plan is linked from
docs/specs/csvkit-public-routes.md without modifying or executing its tasks.

A separate browser build regression denied optional engine imports and failed
on workbook/office-package dependencies reached through codec diagnostics.
Codec routes now import the portable exception implementation directly.
Compiled UTF-8 and Python-codec bundles have no workbook/database/command
dependencies. Both decode/encode correctly in isolated browser-like module
contexts without process or Buffer. This build QA does not run a native bundler
inside canonical unit tests or qualify the full engine for browsers.

Independent stress/fix reproduced sql2csv losing null-prototype execution
options. Its original failing test preceded the fix; producer Buffer-view reuse
and finalization tests also cover owned retained bytes. Details:
[safe-bash stress validation](csvkit-safe-bash-session-stress-validation.md).

## Completed checks

- Maintained selected csvkit workspace build closure passed, including the final
  domain-owned workbook declarations and generated interface names.
- Normal repository build, including root suffix stages, passed.
- Final domain unit route with explicit one-worker concurrency: 89 files,
  4,132 passed, one skipped, six TODO; incomplete cases remain blockers.
  Two earlier default-concurrency domain runs timed out in different cases.
- Actual rebuilt safe-bash csvkit suite: 371 passed, one TODO, no failures.
- Final complete CSV-family selection from safe-bash's maintained discovery:
  70 files, 2,009 passed, one skipped, one TODO, no failures/cancellations.
  This is a focused family check, not the full safe-bash workspace unit gate.
- Domain ESLint and strict product/test TypeScript checks passed.
- Strict NodeNext compiled public imports passed for domain/root engine,
  workbook, codecs and safe-bash registration routes, including a final check
  without skipLibCheck.
- Maintained safe-bash public consumers passed all 26 current groups;
  the final rerun passed against the final rebuilt declarations. This is
  declaration qualification, not runtime acceptance.
- Exact root package export inventory and related metadata: 22 passed.
- Repository type routes passed NodeNext/Bundler with DOM and Node settings.
- Workflow lint passed.
- Final sequential guarded repository ESLint passed, exit 0: all 16,005
  configured subjects linted, zero gaps, zero errors, two existing docx warnings.
  All 18,065 input opens were closed; receipt/path/byte guards remained active.
- Guard subject-budget regressions passed: 284 tests across three files. The
  requested `.stress.ts` file was outside default Vitest discovery and is not
  credited as executed.
- Compiled public Shell/MemoryFileSystem/plugin screenshot QA checked duplicate
  csvcut selection and csvlook raw table rendering. Both returned status 0 with
  empty stderr; the rendered image was visually inspected and was readable,
  aligned and unclipped. This is ad hoc QA, not a screenshot test.

The normal build precedes the final domain-owned workbook declaration and
generated interface-name changes; later selected final build/tests/typechecks
cover those focused changes.

## Broader gates and remaining blockers

The repository-wide `npm test` invocation failed: 19 failed files, 2,874 passed,
two skipped; 19 failed tests, 133,573 passed, three skipped, six TODO, and two
worker-start errors. Its shared unit stage failed before later workspace unit
stages ran; those later stages are not credited as passes. Failures include
interpreter/docx/pptx/tiny-http timeouts and a process-launcher child timeout.
Four affected interpreter files passed 2,345 focused cases. A later attempted
yield experiment did not clear the timeouts and was removed; see
[shared-unit investigation](shared-unit-runtime-retirement-validation.md).
Neither focused passes nor removed experimental changes clear the full gate.

The first repository ESLint invocation failed closed with filesystem identity
drift while builds changed directories. It reported zero style errors and two
docx warnings, but 343 gaps make it an incomplete invocation, not a lint pass.
A stable sequential rerun completed with zero gaps but failed at the 16,000
subject cap after discovering subject 16,001. A failing budget regression preceded
raising only that cap to 17,000; byte, metadata, path and receipt controls remain
unchanged. The final real guarded rerun passed as recorded above. The two earlier
incomplete lint invocations remain historical failures, not passes.

Full operation/reference coverage, input quoting modes 2/4/5, output-encoding
profiles, temporal hypothesis scanning, broader locales/codec/workbook/DBF
semantics, full Python/Agate/IPython and actual external driver/service
interoperability remain explicit blockers from implementation-status.md.
Public APIs and successful finite tests do not resolve them. README additions
remain unauthorized. No staging, commits, pushes or publication occurred.
Owned session logs, consumer scratch, browser bundles and the inspected PNG
were reduced into this report and purged; prior workbook evidence was preserved.

Procedure: docs/plans/csvkit-public-sdk-session-qa.md.
