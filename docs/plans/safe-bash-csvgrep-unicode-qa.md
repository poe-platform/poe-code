# csvgrep Unicode flag candidate verification

## Manual QA steps

1. Build the maintained safe-bash workspace dependency closure.
2. Import the built safe-bash root and public csvgrep command entry. Create a
   memory VFS containing `x,id\n١,1\na,2\n1,3\n` at `/input` and explicitly
   register `csvgrepCommands()`.
3. Execute `csvgrep -cx -r'(?u)\d' /input`. Require status 0, empty stderr and
   output `x,id\n١,1\n1,3\n`. Compare the complete result to a registered SDK
   command using `{ columns: 'x', regex: '(?u)\\d', filePath: '/input' }`.
4. Execute `csvgrep -cx -r'(?au)\d' /input`. Require status 1, empty stdout and
   `error: ASCII and UNICODE flags are incompatible\n` on stderr.
5. Capture the terminal output with the maintained screenshot tool, inspect
   the rows and diagnostic, then remove task-owned temporary evidence.

## Grammar and semantics cells

| Form | Expected candidate behavior |
| --- | --- |
| Initial `u` | Default Unicode-13 digit and Python whitespace semantics |
| Initial `ui`, `um`, `us` | Unicode mode plus case, multiline or dotall behavior |
| Initial `au`, `ua` | Invalid pattern, status 1, no CSV output |
| Scoped `u`, locale `L`, verbose `x` | Explicit unsupported error |
| Groups, references, lookbehind, repetition | Still unsupported; no native compatibility claim |

The independent matcher controls include Arabic-Indic digits, U+001C whitespace,
BOM exclusion, dotted capital I case matching, multiline anchors and dotall.
The initial test run failed on rejection of `(?u)` before the implementation
change. No host regex engine or native executable is used in unit tests.

## Scope

This is a narrow command-package increment. Existing CSV parser/codec/quoting,
open/zero range, full Python grammar, adapter containment and checkpoint/replay
qualification gaps in the acceptance ledger remain unresolved. Candidate
semantic checks are distinct from native version qualification and bounded
performance measurements. No standalone package publication is authorized.

## Verification receipt

- Command workspace maintained unit route: 35 passed; no skips or cancellations.
- Shared CSV engine maintained unit route: nine passed; no skips.
- Public Shell memory-VFS boundary: one passed.
- Maintained artifact/publication suites: 224 passed across four files, including
  isolated packed command imports and canonical branded argument identity.
- Command maintained lint and source/test typechecks passed. Selected safe-bash
  maintained build closure passed, including guarded integration and postbuild.
- Built-entry manual QA steps above passed. The initial temporary QA driver had
  an incorrect relative import; correcting that driver resolved the failure.
  This was not a product defect. Screenshot inspected: rows and diagnostic are
  readable except the Arabic-Indic digit renders as a missing font glyph;
  exact UTF-8 output is separately asserted. Temporary driver/image were purged.
- `git diff --check` passed. Absolute `/out` is unavailable for writes; temporary
  evidence used task-owned workspace `out/csvgrep-unicode-qa`.

No full repository test/lint/build gate was run for this narrow increment.
Actual browser/workerd engines, native Python 3.9 oracle execution, original/
checkpoint/replay execution and full compatibility remain unverified here.
No unit test relies on a host executable. No performance measurement, local
commit, push, verified remote-main delivery, release or private publication is
claimed. The initial failing semantic test was repaired; all final focused
verification completed successfully.
