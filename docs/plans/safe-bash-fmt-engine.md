# fmt engine contract and verification plan

Task: `engine-fmt`. The command lives in the private
`safe-bash-command-fmt` workspace and is exported through
`@poe-platform/safe-bash/commands/fmt`. Safe Bash's prior command path now only
re-exports the definition. Default registration stays unchanged.

Acceptance for this engine task requires original failing tests, one byte-based
formatter shared by CLI/SDK, explicit resource/cancellation contracts, maintained
workspace delivery checks and isolated installed runtime/declaration consumers.
Complete native compatibility qualification is tracked separately.

## Source baseline

Downloaded and hashed the released GNU coreutils 9.10 archive:
`16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25`.
Read `src/fmt.c`, the `fmt invocation` documentation section, and all five
upstream fmt test files (`base.pl`, `goal-option.sh`, `long-line.sh`,
`non-space.sh`, `width.sh`). No native fmt utility was executed for this task.

Compared release source with development commit
`b25722854370b8206d7f53f8934c36710cdd9974`:

- Released `src/fmt.c` SHA256:
  `5c14a993ddddf251970e764f81e134128bb73bb585363d3bde1e3e053b52aec6`.
- Development `src/fmt.c` SHA256:
  `dca9737e5dcc0fa12d55887deba66ce8dd5598ee4e32a764599e8fd03793fe8d`.
- Only initialization placement differs: development initializes `prefix` and
  `max_width` statically and removes redundant initialization in `main`.
- Release/development fmt documentation sections and `width.sh` are identical.

These are source-derived findings, separate from the executed native cohorts
supplied in the task. The implementation refactors the existing first-party
formatter; upstream C and test code are not vendored into the runtime.

## Implemented contracts

Default profile `gnu-coreutils-9.10-C-bytes` uses opaque byte ownership, encoded
lengths and explicit ASCII classification. There is no implicit host decoder,
locale or terminal-width dependency. Width includes all line bytes except LF,
with an unsplittable-word exception. The historical
`gnu-coreutils-8.30-C-bytes` profile retains the older exclusive boundary and
is exercised against the existing immutable 1148-case 8.30 snapshot. Historical
expected bytes are never applied to the 9.10 engine profile.

The parser owns byte operands and prefixes, preserves ASCII prefix edge-space
requirements, accepts width/goal 0, validates goal-only against 75, handles GNU
unique abbreviations, option precedence and first-argv legacy width syntax.
VFS filenames must round-trip their byte representation; distinct invalid bytes
remain distinct for prefix matching.

The coroutine owns bounded input copies (4096), text (5000), pending output
(1024) and prefix bytes. It bounds completed words to 998 before flushing;
999 word/sentinel records suffice. Copy/move/scan/DP/output/resumption work is
metered. Arithmetic costs are checked safe integers with integer truncation;
native signed overflow is intentionally rejected. Output chunks are owned by
the receiver and must be written with backpressure before resuming.
Failures, EOF, a started coroutine's return and explicit disposal release buffers.

CLI and SDK use one parser/engine and VFS invocation implementation. Invocation
cleanup is registered synchronously before acquisition, closes input admission,
shares idempotent completion, retires iterators and disposes the engine. Enrolled
stdout operations drain cooperative output work. Opaque metadata work keeps its
existing non-preemption contract. Source chunks/nonstreaming reads have an
explicit retention allowance. Diagnostics are separate from engine-formatting
output accounting; caller-owned argument/output storage is outside engine
retention accounting.

## Test authority and remaining qualification

Original failing tests preceded implementation. Engine tests assert exact bytes
for released width 7/8, missing final LF, encoded UTF-8 lengths, invalid bytes,
Unicode blanks, paragraph boundaries, prefixes, indentation, sentence spacing,
tabs, mode precedence, tagged carry, the supplied ten MAXCHARS lengths and the
996–1004-word all-a width17 window recipes. Expected all-a byte streams are
reconstructed independently from the source and supplied boundary summaries;
these tests do not replace missing captured native byte artifacts. They run each byte fixture at chunk sizes
1, 37 and 4096. Additional failing tests established empty-resumption metering,
copy admission and cancellation at EOF/startup. Failing VFS tests additionally
established remaining-input admission before fallback reads and intrinsic source
fragmentation without producer methods/species or redundant owned fragment
copies. Allocation tests established a fixed admitted input pool instead of
temporarily overlapping chunk allocations. Released-profile VFS I/O failures
now return failure with GNU-style read diagnostics, validated by failing stdin
EIO and directory-read tests against the released `fmt` error-return source.
Historical snapshot behavior remains explicitly versioned. CLI/SDK and producer cleanup tests use
memory sources and mocked capabilities.

The original engine test's three intuitive expectations were corrected against
the actual source semantics before acceptance: final-word penalties favor a
shorter first line for three two-byte words; a tagged first line can be exactly
width; vertical-tab/form-feed/CR delimit word scanning but are not consumed by
`get_space`, and therefore start the following token. No assertions or budgets
were weakened.

The supplied 200 MAXCHARS and 144 MAXWORDS observations are evidence inputs,
not cohorts freshly executed here. All combined punctuation/prefix/crown/tagged/
tab/window native byte gates remain unqualified outside the explicit tests.
Passing engine tests do not claim complete GNU equivalence or native-overflow
compatibility. Packed fixtures additionally exercise public imports, strict
declarations, canonical runtime identity, Shell-created invalid byte argv,
VFS scripts, pipelines and SDK execution without installing the private package.

## Verification receipts

- Final private-workspace tests: 43 passed; package lint and both source/test
  TypeScript checks passed.
- Final-source fmt/registration integration: 77 passed, including all 1148
  historical snapshot comparisons. Adversarial fmt checks: 678 passed after
  explicitly selecting the captured GNU 8.30 profile; captured bytes are unchanged.
- Maintained `npm run build` passed. The final selected Safe Bash workspace
  closure passed with 18 builds. Missing declared build tasks were reported by
  the maintained route, rather than counted as successful builds.
- Repository ESLint completed over all 16092 configured subjects: zero errors,
  four warnings. Root types, workflows and package lint passed. Focused lint
  additionally covered the final integration-test repairs. `git diff --check`
  passed.
- Publication-builder tests: 227 passed across five maintained test files.
- Fresh `0.0.0-engine-fmt-final` artifacts were produced by `package-safe.mjs`
  and packed with lifecycle scripts disabled. Only the three public Safe
  Platform libraries were packed; no private command package was packed or
  published. An isolated offline consumer passed runtime and strict NodeNext
  declaration fixtures. All six private workspaces were absent; AST inspection
  of all 1274 shipped Safe Bash JS/declaration files found no bare private imports.
- Packed Safe Bash SHA256:
  `fe3b4f3d873baf512b750adb583471e6f76c81627001cd525b5d3f5b4b7f761c`.
  Safe FS: `4a2f63394f5af5ec02fd62bc866b12e58ef927bb9400aa8f0872abe288584052`.
  Safe JS: `8f379cc431a704e71d71c2defe839c0eb13d47b4a0213e71cd8f32f26d5bd8ae`.
- Adhoc CLI screenshots were inspected for width 7/8, prefix/uniform formatting
  and the released-profile directory-read diagnostic/status. No native fmt
  executable was run.

The first full maintained unit run exposed historical-profile fixtures and
source/compiled runtime mixing in isolated test bundles. Each cause was reproduced
before repair. Historical fixtures now select 8.30 explicitly, and isolated bundles
derive private-workspace aliases from maintained declarations so contracts retain
one runtime identity. The committed-export refusal test independently compares
committed and current metadata and requires the exact first failed prerequisite
with no build steps; the retired-export identity controls remain unchanged.
The metadata comparison runs after a verifier reports a metadata refusal, keeping
the synthetic startup-poison fixture independent of Git. Both its baseline and
poison controls passed without relaxing the original refusal assertions.
An unrelated PPTX registry unit timeout was reproduced in the full route: eager
capability loading during test setup reduced its timed test from 3.4 seconds to
754 ms while retaining both real conversions and exact byte equality. No test
timeout was increased. A second PPTX ordering timeout passed unchanged in its
focused rerun and subsequent full runs.

Final maintained `npm test`: exit 0, including required build dependencies,
workspace unit tasks and native npm pre/post stages. Safe Bash reported 41890
passed, zero failed and 829 declared skips; its runner additionally reported 558
passed. Unavailable cases remain skips rather than being counted as passes.

No publication of the private package is authorized. Local commits, remote-main
delivery and releases: none. Task-owned temporary source archives, logs,
screenshots, tarballs and installed consumers are removed after verification.

## Follow-up engine review, 2026-09-19

Independently downloaded the 9.10 release archive and verified the recorded
SHA256. Read `src/fmt.c`, the fmt documentation section and all five upstream
fmt tests. Comparing the pinned development `fmt.c` reproduced only the
initialization-placement differences recorded above; no host fmt was executed.

A new original failing test reproduced cancellation being ignored when the
receiver aborts while writing the final output chunk. The engine now checks its
budget/cancellation state before returning successful completion, using the
existing `finally` disposal. The test covers both partial output and the exact
1024-byte output-buffer boundary, and asserts buffer release.

Fresh checks for this change: 44 private-workspace tests, workspace ESLint and
source/test typechecks, the maintained selected workspace build closure,
716 fmt integration/adversarial tests and three private-bundler tests passed.
The bundler tests require Vitest; invoking them with the Node test runner was
an invalid invocation and was corrected without changing their assertions.
No output bytes, snapshots, CLI presentation, package configuration or other
contributors' implementation files were changed by this follow-up.

Installed-artifact receipts above predate this cancellation fix; they were not
repeated in this focused review. Combined native byte qualification remains
incomplete as recorded above and blocks full compatibility acceptance.
No commit, push or publication was performed.

## Coroutine admission review, 2026-09-19

Manual QA steps for this focused change:

1. Download and hash the released archive; compare its `fmt.c` with the pinned
   development revision. Read both fmt manual sections and all five released
   upstream test files. Execute mapped goal, long-line, non-space and base
   controls against the byte engine without running a host fmt executable.
2. Send bytes and EOF during cooperative checkpoints, partial output and full
   1024-byte output events. Require structured `INPUT` failures, zero retained
   invocation bytes and refusal to start the engine again. Verify ordinary
   CLI/SDK resumptions still produce the same bytes.
3. Build the selected Safe Bash workspace closure, generate public artifacts,
   and execute the fmt runtime/declaration fixtures from a consumer containing
   only the three public Safe Platform artifact directories. Exercise the new
   admission rule through the public command export and inspect shipped module
   specifiers for private workspace imports.

An original failing engine test reproduced silently discarded input sent during
a checkpoint. The engine now rejects any non-undefined resumption on checkpoint
or output events, including misplaced EOF, through its existing finally cleanup.
The six negative controls cover both output sizes and checkpoint admission.
Formatting, CLI syntax, output bytes and package configuration are unchanged.

Fresh results: all 45 private-workspace tests, workspace lint/source/test
typechecks and 719 fmt integration/adversarial/registration tests passed.
The maintained selected `@poe-platform/safe-bash` closure passed with 18 builds.
The released archive hash matched; development source differences remained
initialization-only. Mapped released upstream source controls passed, without
native execution. Fresh `0.0.0-engine-fmt-contract` public artifacts passed the
runtime fixture (including cross-realm input, canonical byte arguments, VFS and
CLI/SDK execution), strict NodeNext declaration fixture and the new public-export
negative control. No private workspace artifacts were copied into that consumer.
AST inspection of shipped Safe Bash JS/declarations found no bare private imports.

Initial attempts to write temporary evidence at filesystem `/out` failed because
that mount is read-only; repository `out/engine-fmt-review` was used instead.
An initial selected build used the obsolete `@poe-code/safe-bash` name and was
refused before building; the correct maintained workspace name passed.
The first artifact-import inspection incorrectly classified the public Safe Bash
package as unpublished because its checkout manifest is private. The corrected
inspection derives unpublished names from maintained `integration.privateWorkspaces`
metadata, preserving legitimate public self-imports.
Temporary task evidence was removed after verification.

Repository-wide test/lint/build gates were not repeated for this local engine
protocol change. Screenshots were not repeated because CLI presentation and
formatting bytes are unchanged. Browser/workerd runtime cells and combined native
window/margin/punctuation qualification remain unverified by this review; prior
receipts do not establish current full compatibility. No commit, remote-main
delivery, release or private-package publication was performed.
