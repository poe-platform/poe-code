# Current text import candidate QA

## Procedure

1. Authenticate the retained official 1.12.61 source archive under `out` against
   SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
2. Inspect `stf.c`, `stf-parse.c` and GOffice encoding helpers. Reproduce an
   original failing in-memory case before changing runtime code. Include a
   negative control on the opposite side of the detected boundary.
3. Execute maintained uncached ssconvert build/test routes and package lint.
   Exercise existing actual SDK/Safe Bash command tests against rebuilt exports.
4. Have a different agent independently stress and fix the implemented importer,
   with no export/integration/Git ownership. Reverify after its changes.
5. Render and inspect actual virtual-command output through the screenshot tool.
   Keep generated evidence under `out` and remove task-owned files after review.

## Fresh evidence

The retained archive hash matches the required official hash. The reference
dependency/plugin/locale profile in `ssconvert-text-import-csv-tsv-qa.md` is a
historical capture; this run has not remeasured it. Docker is unavailable
(`docker ps` cannot connect to `/var/run/docker.sock`), so the native oracle
profile and native runtime matrix are currently unverified.

Before the runtime change, `text-sampling.test.ts` failed the original thousandth
line case: it imported `a,b` as one cell instead of `a` and `b`. Its adjacent
999th-line negative control passed. Both passed after the source-derived fix.
The stable helper starts its line counter at one and stops after incrementing
to 1000, yielding 999 sampled lines. Detection now materializes only that prefix.
This is deterministic source-derived evidence, not a fresh native differential
or bounded performance measurement.

Remaining inference, encoding, diagnostic framing and locale limits in the prior
task report remain unqualified unless explicitly measured in this report.
No README edits, commits, pushes or publication are authorized by this task.

## Candidate binding

The checkout HEAD was `b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`. The package
already existed as untracked work; no commit identifies this candidate. The final
runtime source SHA-256 bindings are:

- `src/codecs/text.ts`: `d3431a2a168253a88ec26dc442da916ad1e449a067d671077a1dcc9eb7caae92`
- `src/codecs/text-values.ts`: `c9acc06102071a280f2142791933bdc6db15749adbf48a9b19e2782bf38e8e36`

Paths above are relative to `packages/ssconvert`. These hashes bind the actual
dirty candidate, rather than attributing existing implementation to this turn.
The separate agent's source-derived accounting/locale regressions and fixes are
recorded in `ssconvert-text-current-stress-qa.md`.

## Root verification

| Check | Outcome |
| --- | --- |
| Maintained selected workspace build with `--no-cache`, repeated after reviewer fixes | Passed |
| Initial package `npm run test --workspace=@poe-code/ssconvert -- --no-cache` | Passed 130 files / 3429 tests before reviewer fixes; final run recorded separately below |
| Initial package lint, including source/test TypeScript | Passed before reviewer fixes; final run recorded separately below |
| Separate reviewer's final maintained uncached package test route | Passed 131 files / 3440 tests |
| Separate reviewer's final maintained package lint | Passed ESLint and product/test TypeScript |
| Separate reviewer's final maintained uncached selected workspace build | Passed one-build dependency closure |
| Actual SDK/Shell command test files, repeated against final rebuilt exports | Passed 41 tests, zero failures/cancellations/skips |
| Markdown manual screenshot procedure | Passed after inspecting listing alignment, multiline checkpoint values, successful status 0 and assistant status 1 / GUI diagnostic |
| Maintained Safe Bash typecheck | Failed before compilation with exit 2; public SafeFS identity guard expected `./packages/safe-js/dist/safe-fs.js`, actual root export undefined; zero builds/consumer groups/runtime executions |

The first screenshot driver had no exporter configured. Its unknown-exporter
status 1 and cannot-infer-exporter status 2 were investigated and corrected by
injecting an original checkpoint exporter into the QA configuration; no product
exporter was added. The final screenshot used the actual Shell and plugin, injected
memory filesystem, original multiline fixture and checkpoint writer. The shared
repository screenshot renderer was used because this is an opt-in virtual command,
not the poe-code host CLI. Generated task evidence is removed after inspection.

Existing passing text suites cover probing/name/empty inputs, invalid encodings,
UTF-7/16/32, Unicode, binary controls/NUL, parsing/row limits, size expansion,
literal/formula inference, input/cell admission and diagnostic cancellation.
Existing command tests exercise SDK equivalence, preserved namespace on assistant
denial and original/checkpoint/replay paths. These tests establish their asserted
deterministic semantics only; they do not establish native parity outside their
fixtures or bounded performance.

## Unverified and incomplete cells

- Fresh native execution, current native dependency/plugin authentication and
  upstream variant runtime matrix: unavailable. Retained source/profile inspection
  does not count as native execution.
- Non-C native locales, complete iconv aliases, full `number-match.c` date/time
  grammar, exact native diagnostic process framing and workbook style metadata:
  unqualified, as detailed in the historical task report.
- Exhaustive Unicode equivalence, maximum row overflow and bounded performance:
  not measured. The current generated boundary fixtures are deterministic with
  explicit repeat counts; there is no random seed or performance claim.
- SafeJS realm/host execution and its original/checkpoint/replay matrix: not
  executed here. The changed importer introduces no new host/realm capability;
  existing Shell/SDK tests do not certify this separate runtime cell.
- Repository-wide test/lint/build: not run for these two package-local runtime
  repairs. Focused checks are not represented as a completed broad gate.
- Safe Bash maintained typecheck remains incomplete at its guard, despite focused
  runtime integration passes. No guard or unrelated manifest edits were made.

There are no fresh native differential passes or claims of complete Gnumeric
parity. Local changes, remote-main delivery and release publication remain separate:
no commit, push or release was performed.
