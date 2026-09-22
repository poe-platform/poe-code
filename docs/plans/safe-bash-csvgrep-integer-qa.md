# csvgrep integer argument increment QA

Candidate scope: preserve the existing private command and supported matching
profile; repair JavaScript numeric syntax admission for `-K`/`--skip-lines`.
This is not full csvkit or Python integer Unicode qualification.

1. Execute the command workspace tests before repair. Require the independent
   `0x1` control to fail because status 0 was returned instead of status 2.
2. After repair, run maintained command tests and lint/type checks, shared CSV
   engine tests, public Shell boundary tests and private artifact controls.
3. Build the maintained safe-bash workspace closure. Through its built public
   command entry, create a memory VFS and opt-in Shell plugin. Run a selected-row
   case, inversion and `--skip-lines=+01` against one skipped physical line.
   Verify CSV stdout and status against fixed expected values.
4. Execute `--skip-lines=0x1`; require status 2, empty stdout and the concise
   `error: Invalid skip-lines value` diagnostic. Confirm no VFS input is read in
   the unit negative controls. Compare valid CLI behavior to numeric SDK
   `dialect.skipLines: 1` using the same VFS data.
5. Capture and inspect a terminal screenshot of these results. Keep temporary
   driver/transcript/image under `/out` if writable, otherwise workspace `out/`,
   and remove only those generated files after inspection.

Keep Unicode decimal integer syntax, signed-negative argument behavior, full
argparse diagnostics, complete regex grammar and the acceptance document's
remaining runtime/version cells open. Do not claim broad gates from focused
tests or publication from a workspace build.

## Results (2026-09-20)

The initial edge control failed at `0x1` (status 0 instead of 2). A subsequent
safe-integer boundary control reproduced arithmetic rounding during digit
conversion; adding the digit's value rather than its code point avoids that
intermediate overflow. After repair, all 30 command/matcher tests and nine CSV
engine tests passed without skips. Command lint/source/test type checks passed.
The public Shell boundary control passed, as did all 158 focused private artifact
tests through maintained root `test:unit`. The initial attempt to execute the
Vitest artifact files with Node's runner failed at harness startup; the corrected
runner passed. This is not a product test failure or a full-repository pass.

The maintained safe-bash selected build closure passed. Markdown QA executed
against its built entry: selected rows, inversion, integer syntax error and
CLI/SDK parity passed. The terminal screenshot was inspected; CSV row structure
and the concise status-2 error were visible. Generated driver/image are removed
after use. No native oracle execution, original/checkpoint/replay qualification,
full repository tests/lint/build, commit, push, release or private package
publication is claimed by this increment. Existing acceptance-matrix open cells
remain open.
