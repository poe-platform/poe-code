# pptx tables CLI verification

Ownership: safe-bash table command integration tests and exact test discovery registration. The existing injected engine adapter remains generic; domain edits and command schemas belong to packages/pptx.

Use original memfs decks and actual registered Shell script execution. Verify plural table commands, one-based table/cell selectors, Unicode and empty cells, SDK-equivalent publication, unchanged-package hashes, dry-run nonpublication and invalid input statuses. Extend with supported theme fill/borders/margins and dimension assertions after the domain API is available.

Run the focused maintained safe-bash test route, exact discovery registration assertion, and targeted lint/type checking. No fixture downloads, host product I/O, native runtime, README changes, push or release.

Initial TDD evidence: the actual registered Shell rejected table add/list with status 2 and `Unsupported operation`; both positive cases failed before the table implementation. A malformed-input case succeeded as a rejection but is not counted as meaningful behavior evidence until positive commands work.

The authored checks now independently parse DrawingML with Saxes: a 101 by 61 EMU box divides into widths 51/50 and heights 31/30; all four physical cells survive, including an empty cell. Formatting checks assert theme references, four borders, explicit zero margins, exact point conversions, and selected row/column changes. SDK byte parity supplements these independent assertions.

The exact maintained discovery-registration assertion passed. Targeted ESLint passed. After the declared pptx build, all four new registered-Shell tests passed. A rectangular-grid cardinality mismatch is a semantic validation error (exit 1); malformed dimensions and length flags are usage errors (exit 2). No adapter source change is required.

The theme fixture is assembled entirely in memory from original authored XML using bounded parsed splices and the original stored-ZIP fixture helper. No test depends on downloads. The public raw-XML replacement route deliberately rejects adding namespace declarations, so fixture construction does not use that restricted edit surface.

Terminal QA procedure: use `npm run screenshot -- --output /tmp/pptx-tables-help-20260913.png --no-header -- node --import tsx --input-type=module -e ...` with an inline driver that creates MemoryFileSystem, an explicit pptx engine with the unit-test limits, and a Shell registered with pptxCommands. Execute `pptx tables set --help` and a `tables add` with zero rows, print their actual stdout/stderr and exit statuses, then dispose the Shell. No QA program is persisted or shipped.

Screenshot evidence: `/tmp/pptx-tables-help-20260913.png` was captured and visually inspected. Table help, explicit one-based selectors, publication flags and the invalid-dimension diagnostic are legible and unclipped; statuses are 0 and 2. This verifies terminal presentation only, not slide rendering. The screenshot is disposable and remains outside the repository.

Final integration regression: the exact five safe-bash pptx files (`create`, `fields`, `inventory`, `selectors`, `tables`) passed with `node --import tsx --test --test-concurrency=1 --test-reporter=dot` and their explicitly listed paths. The maintained discovery assertion independently includes the new table test. Final ESLint passed for the new test and discovery-registration file. No commits were made by the delegated worker; Git ownership remains with root.
