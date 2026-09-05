# Bugfix #642: sed NUL-delimited records

## Assignment and baseline

- Baseline: `df8595cf668e56be7dcd6fee4d066cfdcfd2ae5a` (root-qualified; this worker
  does not rerun full qualification).
- Exclusive writes: `packages/safe-bash/src/commands/text-programs/sed.ts`, new
  `packages/safe-bash/tests/commands/sed-null-data.test.ts`, this plan, and optionally
  new `packages/safe-bash/src/contracts/sed-null-data.md`.
- No shared reader/regex changes, registry edits, README changes, Git mutations,
  upstream merge, build, lint, type guards, or shared dist writes. Root owns test
  registration and final qualification. Other workers' changes remain untouched.

## Current issue fetched September 5, 2026

`gh issue view 642 --repo poe-platform/poe-code --json author,body,title,url,updatedAt`
returned author `kamilio` (Kamil Jopek), title "safe-bash: sed lacks -z
(NUL-delimited records)", updated `2026-09-05T18:43:32Z`.
Issue locator: `poe-platform/poe-code#642`. An initial lookup mistakenly treated
the author as a repository owner; `kamilio/poe-code` did not resolve.

Current body:

> ## Gap
>
> `sed` has no `-z` / `--null-data` mode. NUL-delimited records are essential for filename-safe pipelines (`find -print0 | sed -z '...'`), where filenames may contain spaces or newlines. Without `-z`, such pipelines silently corrupt on awkward filenames.
>
> ## Evidence
>
> - `packages/safe-bash/src/commands/text-programs/README.md` ("Known sed gaps") — null-delimited records (`-z`) listed as unsupported.
> - `rg` already supports `--null-data` (`src/commands/search/`), so the streaming architecture can handle NUL record separators.
>
> ## Sandbox-safety assessment
>
> Fully sandbox-safe. `-z` only changes the record separator from LF to NUL; it is a streaming parsing change with no host interaction. Existing per-record/per-output budgets apply unchanged.
>
> ## Proposed approach
>
> - Add `-z`/`--null-data`, switching the input record separator to NUL (and output separator to NUL on print).
> - Ensure addresses/substitutions operate per NUL-delimited record.

## Implementation and validation plan

1. Independently run two failing option/record tests and a passing LF/NUL-byte
   preservation control before editing product code.
2. Keep the separator in sed's own record reader and interpreter. Preserve
   original LF behavior, bounded byte strings, cancellation,
   source cleanup and awaited output. Do not change awk's shared reader.
3. Cover addresses, pattern/hold spaces, text commands, regex byte/newline profile,
   file and stdin sources, separate/in-place modes and output destinations.
4. Capture tiny native GNU controls as bytes; canonical tests use in-memory VFS
   and embedded expected bytes, not disk fixtures or subprocesses.
5. Run only the new and adjacent focused suites with `TSX_DISABLE_CACHE=1` and the
   existing toolchain/base pointers. Record RED/GREEN counts, native provenance
   and explicit limits. Full qualification remains root-owned.

## Initial rejected-candidate evidence

This section preserves the first implementation's evidence; its passing tests
did not justify its incorrect native-output expectations. The root rejected the
new-mode append and repeated-print discrepancies. No user instruction authorized
those discrepancies, and the earlier attribution of a universal NUL text-command
requirement was false. See the correction section for current results.

- Initial independent RED on the stated baseline: 3 tests, 1 pass and 2 failures.
  Both new flags produced exit 2 (`unsupported option '-z'` / `unsupported option
  '--null-data'`). The LF-mode embedded-NUL byte-preservation control passed. This
  validates unsupported options, not a claim that existing LF mode strips NUL.
- Expanded pre-product RED: 54 tests, 2 pass and 52 fail; no skips/cancellations.
  The two passes were LF preservation controls. A subsequent product run passed
  all 54. Ten additional boundary regressions were then added without further
  product edits. Rejected-candidate combined GREEN: 145/145 passed (64 new + 81 adjacent),
  0 failures, cancellations, skips or TODOs; process exit 0, 2072.552721 ms.
- Sandbox Node test children exited without diagnostic test output. Those harness
  failures are not counted as product RED. Authorized unsandboxed runs produced
  the concrete assertions above. Native subprocess controls were separately
  bounded to 2 seconds and 8 KiB; the initial unbounded sandbox control was stopped
  with Ctrl-C. No host fixture files or captures were written by these tests.
- Native control host: Linux x86_64, `/usr/bin/sed`, GNU sed 4.7 (Debian),
  `LC_ALL=C`, `LANG=C`. Initial sandbox `spawnSync` controls timed out without
  producing bytes; authorized unsandboxed bounded controls succeeded. These
  failed harness attempts are not product failures or passing controls.
- Native binary: regular file, 121288 bytes, SHA-256
  `a0b422c771464c25afd6d6c708ae695f1901c5e7e8686e5d2cbee18462f13688`.
- Initial native controls: 11 exploratory + 31 matrix invocations, all 42 successful
  authorized invocations exited 0 with empty stderr. They used explicit argv,
  byte stdin and hex stdout capture, not shell evaluation. The 31-case matrix has
  28 stdout captures initially embedded in `nativeCorpus`, one `w /dev/stdout` capture
  reproduced against an in-memory `out` destination, and two explicit profile
  differences (append terminator and list width). Only 29/31 matched that rejected
  candidate; declaring its append difference acceptable was an error. This is GNU 4.7 evidence, not
  a new GNU 4.9 qualification or a change to the existing approved anchor policy.

### Original mismatches, preserved as historical evidence

- GNU `sed -z 'a after\ninside'`, input hex `610a6200`, produced
  `610a620061667465720a696e736964650a`. The rejected candidate instead produced
  `610a620061667465720a696e7369646500`. This was a bug, not a user requirement;
  the current candidate matches the native LF-ending append bytes.
- GNU `sed -zn l`, input 61 `61` bytes followed by `00`, produced 61 `61` bytes
  followed by `2400`. Existing local 60-column wrapping is preserved: 59 `61`
  bytes, then `5c00`, then `61612400`. Neither difference is hidden by editing
  a native expectation or claiming full compatibility.
- Exploratory GNU `sed -zn 'p;p'`, input `610a62007461696c`, produced
  `610a6200610a62007461696c007461696c`. The rejected candidate omitted the NUL
  between the two `tail` writes by carrying an old LF bug into new NUL mode.
  The current NUL candidate matches native insertion; only old LF behavior remains.

### Focused verification commands

Toolchain pointer: `/tmp/kamilio-toolchain.path` resolves to
`/var/tmp/poe-code-kamilio-toolchain.GzqQj3` (Node v22.22.0).
Temporary-base pointer: `/tmp/kamilio-unit-tmp.path` resolves to
`/var/tmp/poe-code-kamilio-unit.ln3MC7`. No installs, large copies, shared dist,
builds, lint or type guards were run. `TSX_DISABLE_CACHE=1` was set for every test
invocation. Earlier runs did not set TMPDIR because no fixture files/cache were
needed; the final run also explicitly binds TMPDIR to the existing base pointer.

New suite:

```sh
TOOLCHAIN="$(cat /tmp/kamilio-toolchain.path)"
TMPDIR="$(cat /tmp/kamilio-unit-tmp.path)" TSX_DISABLE_CACHE=1 \
  "$TOOLCHAIN/bin/node" --import tsx --test --test-concurrency=1 \
  packages/safe-bash/tests/commands/sed-null-data.test.ts
```

Nine adjacent files (81/81 passed in both the original and corrected combined runs):

```text
packages/safe-bash/tests/commands/text-programs/sed.cases.ts
packages/safe-bash/tests/commands/text-programs/quit-regressions.cases.ts
packages/safe-bash/tests/commands/text-programs/lookahead-regressions.cases.ts
packages/safe-bash/tests/commands/text-programs/list-command.cases.ts
packages/safe-bash/tests/commands/text-programs/capture-regressions.cases.ts
packages/safe-bash/tests/commands/text-programs/file-commands.cases.ts
packages/safe-bash/tests/commands/text-programs/cancellation.cases.ts
packages/safe-bash/tests/commands/text-programs/sed-file-output-budget.test.ts
packages/safe-bash/tests/commands/text-programs/substitution-admission.test.ts
```

Run the same Node command with those literal paths for adjacent checks; the final
combined run supplies all ten literal files. Some adjacent files also contain
shared-regex/awk controls, unchanged and included in the 81-test denominator.

### Delivery boundary

- Production changes are confined to sed.ts: local NUL reader, option parsing,
  separator-aware interpreter and pre-allocation space-join admission. No shared
  reader/regex or other worker's files were edited; no expansion was needed.
- The optional contract records corrected native semantics and unchanged profile
  limits without touching the README. Existing LF file-output/newline and
  repeated-print policies are retained only for LF mode. NUL output maintains
  per-destination pending-separator state and pattern/hold termination metadata.
- Root still owns registration of the new literal test path, full qualification,
  any Git delivery, and release. No commits, pushes, branches or upstream merges
  were performed. Unrelated #636 partial plan/test files remain untouched.

## Root-review correction, September 5, 2026

### Rejected candidate identities

The worktree was still based on `df8595cf668e56be7dcd6fee4d066cfdcfd2ae5a`, with
no #642 commit or registry entry. These SHA-256 hashes were captured before any
correction edit; they identify the rejected files, not the corrected candidate:

| Path | Rejected SHA-256 |
| --- | --- |
| `packages/safe-bash/src/commands/text-programs/sed.ts` | `e67266df573cd4714f54d964f11022473b75fe0fe62058e42410f993ed0f1860` |
| `packages/safe-bash/tests/commands/sed-null-data.test.ts` | `dad23a5dc74e012a9171f2b1d0c4a16af816c27359510ac264d971a4a28a7e3d` |
| `docs/plans/bugfix-642-sed-null-data.md` | `71313c1fcddb38b1c6a9849903b9a94e293995c23263af94f7d858bf1e371d17` |
| `packages/safe-bash/src/contracts/sed-null-data.md` | `3310f7e66bc14800db372dab388f104d63abf575a037575a3ef069d5611c37c6` |

The rejected product's `textArgument()` returned `text + separator` for all
`a`/`i`/`c` commands. Its `print()` wrote the pattern plus the input terminator
without remembering a missing terminator for the next write. Its corresponding
wrong assertions expected `after\ninside\0` for append text and
`("a" + tail).repeat(2)` in both LF and NUL modes. These facts, original hashes,
native bytes and the earlier 145-test outcome are retained here; there is no
claim that the original uncommitted files were stored as Git objects or as a
separate immutable source archive.

### Primary-source and native recheck

- Rechecked GNU sed 4.7 at the same `/usr/bin/sed` binary hash and C locale.
  Nine separate `a`, `i`, `c` controls cover terminated, unterminated and empty
  records. `a` ends its queued text in LF; `i`/`c` end output in NUL. This distinction
  is now asserted, not described as an acceptable implementation difference.
- Primary manual supplied by root:
  `https://www.gnu.org/software/sed/manual/html_node/Execution-Cycle.html` and
  `https://www.gnu.org/software/sed/manual/sed.html`.
- Primary implementation inspected through GNU sed's mirror, pinned to
  `0c1fe22ccacf4887e0be6c11deb4e9c83acc287d`:
  `https://raw.githubusercontent.com/mirror/sed/0c1fe22ccacf4887e0be6c11deb4e9c83acc287d/sed/execute.c`
  and the corresponding `sed/compile.c`. Inspection confirms distinct queued
  text versus record output, per-stream pending termination, raw queue writes,
  and hold-space termination metadata. No upstream code was copied or merged.
  The direct Savannah fetch timed out; pinned GitHub API inspection succeeded.
  Source inspection is not a native run of GNU 4.9 or the current upstream build.
- Native stdout controls add repeated `p`/`P`/automatic output, empty patterns,
  `=`/`l`, transitions to `a`/`i`/`c`, queue ordering before `N`, and `q` at EOF.
  Eight further hold controls cover termination transfer and empty initial hold.
- Raw `r`, explicit `w`/`s///w`, separate input files and independent destinations
  use disk-free Bash pipe descriptors only as oracle setup. Arguments are passed
  as literal positional parameters to `/usr/bin/sed`; known raw byte fixtures
  are emitted by fixed `printf` calls. In-memory tests map `/dev/fd/3` etc. to
  `raw`, `out`, `first` and `last`. Native `w` data was piped to the captured stderr
  channel deliberately; those captures are file bytes, not diagnostic output.
  No host fixture files or native subprocesses were added to canonical tests.
- A first empty-text probe used bare `a`, which GNU rejected with exit 1 and
  an expected-backslash diagnostic. That invalid probe is not a product failure
  or a passing control. It was replaced by valid `a` + backslash + newline,
  which emitted `7461696c000a` after a quiet print of unterminated `tail`.

### Correction RED/GREEN and current corpus

1. Replaced wrong expectations and added native captures before changing product
   code. Against rejected product hash `e67266...1860`: 106 tests, 69 pass,
   37 fail, zero skips/cancellations; exit 1. This is independent correction RED.
2. Corrected `a` to LF text, tracked missing NUL per output destination, drained
   raw queues without inspecting/changing payload, retained output state across
   `-s` and script-file writes, reset in-place streams independently, and corrected
   NUL-mode queue ordering on `N`. All 106 then passed.
3. Added native hold/leading-NUL and resource-boundary controls. Intermediate
   product SHA-256 `c981211ac061eca2b7ae2a6a8fabe4ec6a33857b378dacc3174969186244e85c`
   produced another RED: 124 tests, 118 pass, 6 fail; exit 1. The six failures
   isolated NUL-mode hold termination metadata. Added that metadata only in sed;
   existing LF hold behavior remains unchanged.
4. Final corrected combined GREEN: **205/205** (124 new + 81 adjacent), zero
   failures/cancellations/skips/TODOs, exit 0, 2049.041913 ms. Same ten literal
   test paths and toolchain/base-pointer command, with `TSX_DISABLE_CACHE=1`.
   No build, lint, type guard, shared dist or root registration was run.

Native accounting: **94 successful bounded invocations** total (42 original +
52 correction/recheck), plus the one invalid empty-text probe, with sandbox
failures excluded. The correction/recheck successes comprise 50 matrix cases
and two duplicate pipe-setup probes. Across the original 31 and additional 50
matrix rows, **80/81 match native**: 29 current stdout captures in `nativeCorpus`,
one original file-output capture, and 50 `nativeTransitions` captures. Only the
unchanged pre-existing `l` wrapping profile differs. The append and repeated-print
mismatches are fixed, not waived. Matrix rows are not claimed to be deduplicated
across all exploratory and matrix invocations.

The 124-test new suite additionally covers byte ownership, falsey cancellation,
awaited separator writes, independent file state, in-place reset, zero/exact/over
budgets, inserted-separator output charging and raw leading/trailing NUL bytes.
All product edits remain within sed.ts; shared reader, regex, runtime, filesystem
and registry code are untouched by this worker. Full qualification remains root-owned.

### Corrected candidate SHA-256

| Path | Corrected SHA-256 |
| --- | --- |
| `packages/safe-bash/src/commands/text-programs/sed.ts` | `944d30fdccbcf28a72933b7fd488d51379c88f2740e24cc52c505d1a8247f1fe` |
| `packages/safe-bash/tests/commands/sed-null-data.test.ts` | `ecda767360ffee55e57577021171fcc210c629b21e4ef4afa79e3f55ab44bc08` |
| `packages/safe-bash/src/contracts/sed-null-data.md` | `6a5dff9cf4b8d2798758a74f2d7891efe8f364bc623584c6f4e1c9c343f96bda` |

The plan's own final hash is reported separately to avoid a self-referential hash.

## Independent root verification

On September 5, 2026, root reviewed the corrected sed source and independently
reran the ten literal files listed above with Node v22.22.0, `TSX_DISABLE_CACHE=1`,
the validation base's private TMPDIR, and serial test concurrency. All 205 tests
passed, with no failures, skips or cancellations (2019 ms). The full output is
preserved in `tmp/issue-642-root-focused.log` under the directory identified by
`/tmp/kamilio-569-575-validation.path`. Root added the literal new-suite assertion
to `packages/safe-bash/scripts/integration-inputs.test.mjs`. This independent
focused pass does not establish full qualification, remote delivery or release.

The combined literal registration check subsequently passed 98/98 tests in
7969 ms, logged in `tmp/issues-636-642-registry-root.log` under the same base.

## Test promise typing correction, September 5, 2026

Root reported maintained gate `2d70e2745` build, full npm test, lint and package
lint passes, but a Bash source/test compiler failure. This worker inspected the
bounded regular-file evidence at
`issues-636-642-gate.74Wx9p/bash-types.log` under the base identified by
`/tmp/kamilio-569-575-validation.path`
(`/home/kjopek/kamilio-validation-569-575.RoFXyZ`). The log confirms eight #642
diagnostics: two TS2339 `.then` errors, three TS2769 `assert.rejects` overload
errors, and three consequent TS7006 callback errors. They match the current test
sites and `CommandHandler`'s declared `CommandResult | Promise<CommandResult>`
return type. The compiler log is the concrete RED evidence; no compiler/full guard
was rerun by this worker. Unrelated #636 diagnostics remain root-owned.

Only four direct `sedCommand().execute(...)` result sites in the new test were
wrapped in `Promise.resolve(...)`. This normalizes the declared union without an
unsafe cast, keeps execution timing and the existing promises, and preserves all
byte, backpressure, cleanup and falsey-abort assertions. No product or contract
files were changed, and all prior plan/history sections remain intact.

The requested ten-file focused rerun passed **205/205** (124 new + 81 adjacent),
zero failures/cancellations/skips/TODOs, exit 0, 2120.108547 ms. It used the existing
Node toolchain pointer, `TMPDIR="$BASE/tmp"` from the validation-base pointer,
`TSX_DISABLE_CACHE=1`, and `--test-concurrency=1`. This is runtime regression GREEN,
not a maintained compiler/typecheck pass. Root will rerun maintained types after
freeze. No production edits, Git mutations, shared dist, build or full guards
were performed by this worker; native corpus accounting is unchanged.

Handoff SHA-256:

| Path | SHA-256 |
| --- | --- |
| `packages/safe-bash/tests/commands/sed-null-data.test.ts` | `56ed711446c81bccfa13dc35d04efcd1b099b916c3f3020e832e74f9634f47ee` |
| `packages/safe-bash/src/commands/text-programs/sed.ts` (unchanged) | `944d30fdccbcf28a72933b7fd488d51379c88f2740e24cc52c505d1a8247f1fe` |
| `packages/safe-bash/src/contracts/sed-null-data.md` (unchanged) | `6a5dff9cf4b8d2798758a74f2d7891efe8f364bc623584c6f4e1c9c343f96bda` |

The previous test hash `ecda767360ffee55e57577021171fcc210c629b21e4ef4afa79e3f55ab44bc08`
and pre-append plan hash `6c9fa26d1e53ab37c859419763adda4b911ff8e5ec60ec577006e4303a1c1963`
identify the inputs to this typing-only correction. The plan's final hash is
reported in the handoff rather than embedded in itself.
