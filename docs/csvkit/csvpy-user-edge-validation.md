# csvpy user edge validation — September 18, 2026

This review used the existing live worktree, preserving unrelated edits and staging. Results qualify the scoped JavaScript PythonSession console, not full csvkit 2.2.0, exact `code.interact`, IPython, or complete Agate object libraries. No native Python console differential measurement was performed. No commit, push, publication, or README changes were made.

## Validated fixes

- Shadowing `type`, `str`, and `isinstance` originally made a following exception terminate csvpy with status 78. Exception formatting also overwrote/deleted a user `_csvpy_error`. A separate private guest namespace now preserves user names and maintains exception recovery. Exact stdout, stderr and status regression passes.
- A nested unfinished class/function suite originally produced IndentationError at a synthetic EOF dedent. Parser metadata now records this as incomplete input. The regression also checks a real following dedented statement remains a diagnostic. Execution waits for the final blank line.
- Stateful guest exception `__str__` is evaluated once during error formatting.
- Independent registered-shell tests reproduced DictReader blank-row line_num (4 instead of 2), blank-tail line_num (3 instead of 2), and reversed replacement-header consumption after resetting fieldnames. The scoped library now follows CPython's source ordering. Source evidence and the independent procedure are recorded in `docs/plans/csvpy-user-stress-qa.md`.

## Passing maintained checks

- `npm run build:workspaces -- --workspace=@poe-code/safe-python`: selected maintained closure passed.
- `npm run build:workspaces -- --workspace=@poe-code/csvkit`: final four-workspace maintained closure passed.
- `npm run test --workspace=@poe-code/csvkit`: 87 files passed; 4,117 tests passed, one skipped, six TODO. Skipped/TODO cases are not passes.
- `npm run lint --workspace=@poe-code/csvkit`: ESLint and source/test TypeScript checks passed after final product edits.
- Focused csvpy, PythonSession interactive, and object-bridge regressions: 28 tests passed, including 14 csvpy cases.
- Registered-shell csvpy suites: 20 cases passed, including nine new independent edge cases. Inputs/effects use MemoryFileSystem; exact streams/status, unchanged CSV contents, borrowed stdin and exactly-once closure are checked.
- Integration inventory: 109 checks passed; the new shell test is registered by exact literal pathname.
- Focused ESLint on shared parser/test edits passed; scoped diff whitespace check passed.
- Root `npm run lint:types` and `npm run lint:workflows` passed.
- A real registered-shell console was rendered with the maintained screenshot utility and visually inspected. It showed DictReader output, corrected line_num 2 across blank rows, shadowed builtins, a recovered exception, the retained user value and EOF text. Transient screenshot/script/log evidence was kept in `out` and purged after recording observations.

## Repository-wide gate blockers

`npm test` reported repeated five-second timeouts across codecs, docx, browser shell/playground and lint-runner tests. It was stopped with SIGTERM after those failures; it did not complete or pass. `npm run lint` did not finish its root ESLint traversal before the review-owned broad checks were stopped; it is unmeasured, not a pass. Only processes identified as holding this review's output logs and their descendants were stopped.

Targeted one-worker rechecks passed the initial codec timeouts, image-replacement, control-bindings, sequence-prefix and public-browser shell cases (12 cases total). The playground help-pipeline case still timed out and its worker-zero assertion consequently failed. These reruns do not repair or replace the repository-wide gate. Later docx and lint-runner timeout cases were not requalified.

Full streaming filename/decoding timing, guest Agate Table/Decimal/temporal libraries, complete Python stdlib, precise traceback/syntax-error behavior, KeyboardInterrupt recovery, nested asynchronous input and optional IPython remain explicit blockers in `docs/specs/csvpy.md`. No exhaustive edge-case or full compatibility claim is made.

### Observed broad-run failures before interruption

- `packages/safe-python/src/runtime/shift-jisx0213-codec.test.ts > matches every strict Unicode encoding and fault in plane 1`
- `packages/safe-python/src/runtime/euc-jp-codec.test.ts > matches JIS X 0212 triple splits under 'strict' in block 3`
- `packages/safe-python/src/session-codec-utf7-user-audit.test.ts > UTF-7 user audit: 'ordinary and incremental batch 59'`
- `packages/safe-python/src/runtime/euc-jisx0213-codec.test.ts > matches JIS X 0213/0212 triple splits under 'replace' in block 14`
- `packages/docx/src/image-replacement.test.ts > rejects replacement inside an admitted tracked insertion before source acquisition`
- `scripts/bundle-safe-bash.test.ts > runs nested env/xargs, truncate, csplit, pr, tsort, factor, getopt, hexdump and hd through the public default browser entry`
- `packages/safe-bash-playground/src/session.test.ts > PlaygroundSession > supports real help pipelines, redirects, and command dispatch`
- `packages/docx/src/control-bindings.test.ts > preserves an unrelated unsupported binding beside a supported target`
- `packages/safe-python/src/runtime/euc-jisx0213-sequences.test.ts > matches prefix 652 with every BMP suffix in block 3`
- `packages/docx/src/style-workflow-variants.test.ts > style workflow 035`
- `packages/docx/src/text-replace.test.ts > does not bridge structural barriers: <w:r><w:t>co</w:t><w:drawing/><w:t>ast</w:t></w:r>`
- `packages/docx/src/template.test.ts > preflights scalar formats in later discarded nested prototypes`
- `scripts/lint-eslint.test.ts > single-operation loader admission > keeps optimized read and close identity for {}`
