# Independent rg stress verification

Verified on 2026-08-26 with native ripgrep 15.2.0 (e89fff89ac), Node 22.22.2.
The transferred baseline was 107 passing tests, including 86 native fixture
comparisons. Source exports remain `searchCommands()` / `createSearchCommands()`.
No contracts, shell, registry, jq, or other command implementation is owned here.

## Reproduction and recorded results

```sh
node --import tsx --test 'tests/commands/search/**/*.test.ts' 'tests/commands/search-stress/**/*.test.ts'
npm run typecheck
npm run build
git diff --check -- src/commands/search tests/commands/search tests/commands/search-stress
```

- Focused suites: **689/689 pass**, no skipped or cancelled tests.
- The **57 new stdin metadata regressions** (21 direct consumer, 36 shell/invoke)
  pass independently with `PATH` empty. They never require native rg and are not
  added to the native-comparison denominator.
- New top-level strict native comparisons: **504** (486 deterministic command
  cases, 10 Bash/rg versus virtual-shell pipelines, 8 minimized review cases).
  Including the baseline's 86 comparisons gives **590** top-level equality
  comparisons. Four additional isolated streaming comparisons (three delayed,
  one whole-write) bring the combined equality count to **594**. The former
  unlike-delivery review comparison is now a virtual-only streaming assertion;
  the explicit correction and both native expectations are recorded below.
- JSON comparisons replace only `elapsed` / `elapsed_total` values, preserving
  object member order and every other field. Non-JSON output is byte-exact.
- The safety wrapper separately runs **10 isolated tests**, including three
  native closed-stdout repetitions. Four additional tests deliberately record
  non-parity: three unsupported Rust regex syntaxes and one catastrophic-regex
  probe killed by the external harness, not by the library.
- The streaming wrapper runs six isolated tests: three matched 25 ms producer
  comparisons, one whole-write comparison, and two backpressure/cancellation
  checks proving output is awaited before reading the next input chunk.
- At the streaming checkpoint, ten repetitions with `--unhandled-rejections=strict` passed: **100 safety
  checks** (30 native EPIPE runs) and **60 streaming checks** (30 matched delayed
  native comparisons, 10 whole-write comparisons, 20 backpressure checks).
- Fresh whole-repository typecheck, build, and owned-path diff-check pass. The
  foreign typecheck errors recorded at the previous checkpoint are now resolved.

The native command timeout is three seconds; virtual batches are killable Node
children with ten-second deadlines and 16 MiB capture limits. The catastrophic
probe has a one-second SIGKILL deadline. Isolated safety checks have a five-second
outer deadline. Fixtures are deterministic, use a seeded content matrix, and
native temporary trees live in this owned subtree and are removed after each
probe. The native Bash wrapper retains fixture-parent ignore rules for explicit
subdirectory roots; direct probes disable external parent/global ignores.

## Fixed defects

- Empty only-matching output and literal-empty byte offsets, including UTF-8,
  malformed input, and unterminated records; match-count limits remain enforced.
- CRLF only-matching terminators; explicit line-number precedence; columns on
  real matches rather than selected/nonselected status alone.
- Inverted JSON context submatches; quiet JSON summary/statistics; max-count
  after-context classification, statistics, and fixed window length.
- Native JSON summary member ordering after timing-only normalization.
- Positive directory globs no longer implicitly select descendants; reopening
  ignored directories does not rescue excluded or hidden children.
- Literal unmatched brackets in ignore files retain following rules; nested
  repositories reset inherited VCS ignore rules.
- Followed cycles report native-style diagnostics before ignore filtering and
  do not prevent searches of later siblings.
- Malformed UTF-8 no longer falsely matches replacement characters or consuming
  regex atoms. Matching fragments preserve whole-record anchor meaning.
- The reviewed binary/context no-match case and fragmented-input lost warning.
- Stdout EPIPE stops traversal successfully, without diagnostics or later writes;
  cancellation wins races, and uncooperative iterator cleanup cannot hold EPIPE.
- Auto-input selection uses provenance without probing; nondefault empty chunks
  yield to cancellation rather than starving it.

## Matched-delivery correction

The original `bebfc27` review fixture compared virtual one-byte chunks against a
native **whole write**. That comparison passed only after speculative output
staging, which hid a real streaming/backpressure defect. The subsequent review
found three identical failures with both producers delivering one byte every
25 ms; this worker independently reproduced all three failures before this fix.

Input is exactly `foo\n\0\nno\n`; arguments remain `foo -`. Both native schedules
return status 0 with empty stderr, but their exact stdout differs:

```text
Whole write:       "binary file matches (found \"\\0\" byte around offset 4)\n"
25 ms byte writes: "foo\nbinary file matches (found \"\\0\" byte around offset 4)\n"
```

The whole-write expectation is unchanged and remains enforced against both
implementations. The unlike-delivery assertion in `review.test.ts` is explicitly
replaced by a virtual-only assertion that already-emitted `foo\n` is retained.
It is no longer counted as a native comparison. `streaming-cases.ts` now enforces
the delayed native expectation in three matched-producer repetitions and proves
the whole-write expectation separately. No output alternatives are accepted by
these assertions. Native back-to-back one-byte scheduling was variable in the
independent review (one warning-only result and two text-plus-warning results),
so it is not assigned the whole-write expectation or called a parity pass.

The fix removes speculative stdout staging, not the late-warning fix. Matching
records are written immediately and their sink promises are awaited before the
next input read. No production timing heuristic, extra buffering, dependency,
or host process is introduced. Existing incomplete-record/input/output bounds,
cancellation, and EPIPE cleanup remain enforced. Native reader/mmap heuristics,
other chunk groupings, and arbitrary scheduling remain comparison limits.

## Stdin metadata integration

The upstream contract/core work landed in `1c0d9ae`, and shell propagation landed
in `27e5c58`. Both `CommandContext` and `CommandInvokeOptions` now declare
`readonly stdinIsDefault?: boolean`. This consumer compiles against those actual
interfaces without casts, replacement declarations, or edits to upstream files.

- `true` means the host's implicit no-input default: ordinary rg auto-selection
  searches cwd without acquiring stdin.
- `false` means nondefault input, not a promise that bytes remain. Ordinary
  auto-selection reads stdin, including empty or previously exhausted streams.
- Omitted metadata means legacy/unknown and deterministically selects cwd. No
  stream inspection attempts to recover the missing information.
- Explicit operands, configured defaults, `--files`, and pattern-stdin precedence
  remain intact. Simultaneous pattern/data stdin (`-f - -`) returns status 2
  before input acquisition. Existing native expected bytes were not changed.
- Test helpers derive metadata from whether the caller supplied input, never
  its content or byte count. Dedicated legacy tests omit the property entirely.

The four formerly failing empty-pipe, empty-file-redirection, empty-heredoc and
explicit-empty-`Shell.exec` cases now pass, returning status 1 and no output even
with a matching cwd file. Always-runnable tests also cover empty bytes/sources,
exhausted sources, zero chunks followed by data, descriptor setup order and
duplication, output-only redirects, groups/functions/substitutions, nested env,
and custom literal-argv invoke inheritance/replacement/transparent forwarding.
Middleware observations assert the metadata received by rg, not just output.

Invoke tests verify that replacement stdin defaults to nondefault, an explicit
replacement metadata value is honored, and a metadata-only override without
replacement stdin cannot change inherited provenance. Literal arguments with
shell metacharacters are passed unchanged and never evaluated as shell source.

```sh
node --import tsx --test tests/commands/search-stress/stdin-metadata.test.ts tests/commands/search-stress/stdin-shell.test.ts
```

All 57 tests also pass in a child Node process with `PATH` empty. There are no
skipped, expected-failure, or native-availability-gated metadata regressions.
Ten fresh `--unhandled-rejections=strict` repetitions with empty `PATH` pass
**570/570 metadata checks**.
No outstanding cross-owner failure remains in the exercised stdin cases.

The output-only redirection fixture uses `.result`, keeping the output artifact
out of the search inventory. Its first version used `result`, which rg then read
as another matching file. That unrelated stdout-file exclusion behavior was not
changed in this metadata task and is not covered by its acceptance claims.

Legacy callers relying on inferred nonempty input must provide metadata or an
explicit input mode. JavaScript/Rust regex differences, nonliteral zero-width
edge cases, and lack of hard in-process regex preemption remain. This work does
not establish general rg parity, full shell support, or superiority to just-bash.
