# in2csv user workflow stress QA

Run `node --import tsx --test packages/safe-bash/tests/commands/in2csv-user-edge.test.ts` after the maintained csvkit build closure. The test host injects codecs, locale, clock and terminal. All input and output files exist only in MemoryFileSystem. Canonical tests never invoke Python/native programs, network services, databases or LLMs.

Replay all 62 released csvkit observations in `docs/csvkit/in2csv-reference.json` through the registered literal executable in actual Shell. Quote each argv token independently so empty arguments, Unicode selectors, comma lists, negative-looking values and `--` survive shell parsing. Compare stdout, stderr, status, every side-file byte payload and preservation of each original input file. The frozen observations cover CSV/JSON/NDJSON/GeoJSON/fixed/DBF/XLS/XLSX, format precedence, active sheet and XLS first sheet, names-only short circuit, ignored/redeclared options, Unicode indices and malformed selectors, streamed workbooks, output BOM/line numbering and side-file enumeration/deduplication.

Exercise three additional VFS workflows:

- Request `First,Missing` with an existing `/book_0.csv`. Main stdout must complete before the missing-sheet diagnostic, and selection validation must preserve the existing export without truncation.
- Make `/book_1.csv` a directory and request all sheets. Compare exact directory diagnostic and status; `/book_0.csv` must contain the first export, and the directory and original workbook must survive.
- Inject EACCES on the second named-workbook read. Main stdout must precede the reopen diagnostic, the read must occur twice, and existing exports must remain unchanged.

2026-09-18 results: the initial replay passed 56 and failed eight, all DBF cases reporting the explicitly unsupported `codec ascii` because the test host injected UTF-8 only. This was test capability setup, not a product mismatch. Injecting the exported JavaScript `pythonCodecs` set resolved all eight. The final focused run passed 65 tests, zero failures/skips/TODO, in approximately two seconds. Focused ESLint passed. No importer change was justified by these observations, and no commit/staging/README change was performed.

These tests establish the measured fixture/workflow scope only. Existing documented workbook/DBF driver, parser preemption, quoting/locale/temporal and non-Excel all-sheets decoding blockers in `docs/csvkit/in2csv-validation.md` remain unqualified. Unmeasured arbitrary workbooks and capabilities are not passes. Root owns maintained build/typecheck/integration inventory and any broader verification.

Maintained safe-bash typecheck initially failed the new test's three-argument FsError construction. Corrected it to the actual typed `{ syscall, path }` options contract. All 26 consumer groups passed that run; the source-and-tests phase was then rerun successfully through `node packages/safe-bash/scripts/historical-type-models.mjs --noEmit`. The initial aggregate typecheck remains a failed run, not an aggregate pass.

Root's additional frozen observations in `docs/csvkit/in2csv-user-edge-reference.json` are also replayed through the same literal Shell path. The initial 24-case expansion against the original built engine reproduced 18 failures: schema error evaluation order, DBF integer precision/padding/float text and invalid hex, and JSON scalar-container diagnostics. Root owns corresponding TDD fixes and rebuild. Rerun the entire expanded test after that build before calling the new cases verified.

After root completed the maintained build closure with fixes, the final expanded actual Shell run passed all 89 tests in approximately three seconds, with zero skipped/TODO/failures. Focused ESLint also passed the final expanded test. Root separately owns final aggregate typecheck and build verification.

The final DBF F-padding observation adds `* *`: outer star stripping leaves one space, which the frozen driver diagnoses as an invalid float rather than treating as null. Root reproduced and fixed this case, rebuilt csvkit, and the complete automatically expanded Shell replay passed all 90 tests with zero failures/skips/TODO in approximately three seconds. No test source change was needed for this added fixture.
