# csvgrep independent stress QA

Use the injected UTF-8/C/UTC/noninteractive profile and in-memory filesystem.
Never invoke a host csvgrep, Python, database, network or write fixture files.

1. Run `node --import tsx --test packages/safe-bash/tests/commands/csvgrep-stress.test.ts`.
2. Compare complete stdout, stderr and exit status for default column AND,
   `--any-match` OR, aggregate inversion, short rows, empty patterns and
   header-only successful output.
3. Confirm `-l` retains the original input row positions after filtering,
   numeric selectors retain the source offset, and `--zero` shifts it again.
4. Inject a match-file handle and verify `-n -f matches.txt` opens during parsing,
   never consumes match lines and closes exactly once before execution settles.
5. Check exact match-file membership takes precedence over string matching.
   Include trailing tabs/nonbreaking spaces and leading spaces to distinguish
   Python `rstrip()` from line-separator-only stripping or full `strip()`.
6. Have the integration owner register the exact test path in the maintained
   integration inventory and run the maintained narrow test/build/lint routes.
7. Compare Unicode decimal matching against ASCII-mode matching, and verify
   supported ASCII ignore-case separately from explicitly unqualified Unicode
   ignore-case inputs. A tested status-78 blocker is not a compatible pass.
8. Give one regex invocation a small work budget: a single matching row succeeds,
   while two matching rows exceed the cumulative bound with exact partial output.
9. Hold the header sink write, cancel, and confirm no data rows are emitted and
   the borrowed stdin iterator is retired before execution settles.

Initial reproduction: the match-file membership case returns status 78 with
`Python regex / match-file operation`, proving the existing unsupported path.
Aggregate matching, numbering and eager names-only file ownership passed.
This focused suite does not certify full csvkit, regex, encoding or driver parity.

Independent follow-up detected duplicate match-file close calls; the integration
owner corrected that issue. Current narrow execution: all 10 node:test cases
pass, and ESLint passes for the owned test file. One case validates a declared
Unicode ignore-case blocker, while another validates intentional budget refusal;
these do not establish regex compatibility for refused inputs.
