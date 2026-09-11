# Issue 652: sed program instruction admission

## Root delivery validation

After isolating unfinished issue 649, the maintained selected virtual-bash build
passed, including its derived dependency closure. Combined focused regressions
passed 620/620 and maintained runner/inventory checks passed 279/279. Repository
lint passed with these unchanged product/test edits. The earlier combined full
suite is not claimed as passing; its remaining failures concern isolated 649.
The installed-package refusal diagnostic screenshot was visually inspected.

## Validated problem

The current sed parser compiles each address and substitution pattern before
execution budgets apply. Inline read-only witnesses with 20 and 100 substitutions
(140 and 700 source bytes) and empty input compiled 20 and 100 patterns despite
maxSteps and maxBufferBytes both being 1. No budget step, buffer check or checkpoint
ran. Twenty two-address substitutions compiled 60 patterns. Existing source and
per-pattern bytecode caps do not admit aggregate instruction count.

No OOM, large-heap workload or 30,000-instruction input was run. The alleged per-
substitution heap size and 128 MiB failure threshold are not verified.

## Authorized implementation

- Add optional maxProgramInstructions to TextProgramOptions; sed validates a
  positive safe integer before reading scripts, with a default of 1,024.
- Admit the next instruction after ignoring separators/comments but before
  parsing its addresses. Count every stored instruction, including opening and
  closing braces and labels. Already admitted instructions may compile; the first
  excess instruction must not compile any address or substitution regex.
- Count the combined program across positional source, repeated -e and -f inputs.
  Keep execution and buffer budgets independent and preserve admitted behavior.
- Existing derived aggregate text and portable-search sed options forward the
  field without new CLI syntax or duplicate configuration. This is a sed-only
  instruction cap, not an awk AST limit, aggregate regex-bytecode budget or RSS
  guarantee. No environment variable is added.

## TDD and verification

The dedicated suite covers small empty-input regressions, invalid limits,
configured/default boundaries, comments and payloads, labels and brace paths,
cumulative sources, malformed-regex precedence, observed regex compilation,
stdin/output/in-place effects, and direct/text/aggregate/portable configuration.
Fixtures use MemoryFileSystem only; compilation spies are restored in finally.
Default-boundary tests use only 1,024/1,025 non-regex print instructions.

Verification used Node v22.22.0 from /tmp/kamilio-toolchain.path,
TSX_DISABLE_CACHE=1, TMPDIR=$(cat /tmp/kamilio-569-575-validation.path)/tmp,
and NO_COLOR unset.

- RED before product changes: 55 tests, 22 passing controls and 33 failing
  admission/validation witnesses, exit 1. No skipped, cancelled or TODO tests.
- GREEN after product changes: the same 55 tests all pass, exit 0; no skipped,
  cancelled or TODO tests.
- The per-case RED/GREEN command was `node --import tsx
  packages/safe-bash/tests/commands/text-programs/sed-program-budget.test.ts`.
  Initial process-isolated --test attempts exposed only a file-level failure
  (0/1), not per-case results; these are not counted as the TDD denominator.
- Focused maintained regression command: `node --import tsx --test
  --experimental-test-isolation=none --test-concurrency=1 --test-reporter=tap`
  with the seven literal files below. Result: 399/399 passing, exit 0, no skips,
  cancellations or TODO tests, reported duration 3343.86823 ms.

Focused files:

- packages/safe-bash/tests/commands/text-programs/sed-program-budget.test.ts
- packages/safe-bash/tests/commands/sed-null-data.test.ts
- packages/safe-bash/tests/commands/text-programs/sed-file-output-budget.test.ts
- packages/safe-bash/tests/commands/text-programs/substitution-admission.test.ts
- packages/safe-bash/tests/commands/text-programs/allocation-admission.test.ts
- packages/safe-bash/tests/commands/text-programs/text-programs.test.ts
- packages/safe-bash/tests/plugins/agent-commands.test.ts

## Ownership and handoff

Owned changes are sed.ts, the shared TextProgramOptions definition, the dedicated
test file, and this plan. No awk-runtime, README, root file or integration inventory
edit is authorized. Root owns literal registration of the new test in
packages/safe-bash/scripts/integration-inputs.test.mjs, integrated validation,
Git and release delivery. No lint or full build is run in this writer window.
Implementation and dedicated tests are frozen after the focused GREEN run;
this plan records the completed handoff. These scoped results do not claim an
integrated build, typecheck, lint, root unit gate, push or release.
