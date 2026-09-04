# Issue 557: bounded grep pattern admission

## Validated scope — September 4, 2026

The relocated `packages/safe-bash/src/commands/search/grep.ts` still collected
each pattern file, split it completely on LF, and appended with argument spread.
An in-memory file containing 131,072 `x\n` patterns (262,144 bytes) reproduces
exit 2 with `grep: Maximum call stack size exceeded`, before worker creation.
The initial maintained regression run reports 8 tests: 3 pass, 5 fail. The
count rejection and cumulative byte rejection assertions fail as well.
This is concrete evidence for the current defect, not an attempt to allocate
the historically reported approximately 11 million patterns / 222 MB RSS.
Those historical measurements are not independently re-established here.

Issue 551 did not fix pattern preparation. Its provider's `maxQueuedBytes`
policy intentionally bounds waiting requests, not requests dispatched into a
free slot. That behavior is documented, is not classified here as a defect,
and is unchanged. No active-subject ceiling or queue-policy reinterpretation
is part of this fix.

## Implementation and compatibility

- Admit at most **1,024 patterns per grep invocation**, choosing the existing
  rg count ceiling rather than adding another configurable public option.
  Grep did not previously have this count ceiling; this is an explicit safety
  restriction, not a claim of unchanged support for arbitrary pattern sets.
- Admit **33,554,432 raw pattern-input bytes cumulatively**, reusing the
  existing `bufferLimit` (32 MiB). Previously that collector ceiling applied
  separately to each pattern file, not the combined invocation. Count LF
  delimiters and the UTF-8 bytes of argv, not JavaScript string length or the
  protocol's separate transport-memory estimate.
- Share both counters across all `-e` arguments and `-f` files/stdin; also apply
  them to the positional pattern. Preserve existing explicit-option/file order,
  empty-file versus empty-argument semantics, trailing LF behavior, CR/NUL,
  Latin-1 byte-string descriptors, and all matcher modes including `-F`.
- Inspect argv before UTF-8 encoding. For pattern files, admit each chunk
  before the existing line decoder can copy or retain it. Iterate LF boundaries
  without split arrays or argument spread. Carry the unfinished-pattern state
  between chunks; a continuation does not consume another pattern slot.
- Pass remaining bytes to whole-file fallback reads. Reject before provider
  dispatch or subject reads; observe cancellation and close cooperative input
  generators on failure. Filesystem/provider allocations already made before
  yielding are outside this command's retention guarantee. This is not an RSS
  limit and does not change worker-side regex validation or matching limits.

No shared protocol/provider, filesystem capability, package export, or type
changes are required. The only implementation edit is grep-owned source.
Root owns registration of the new test path and the integrated build/gates.

## Focused evidence

Evidence directory: `/var/tmp/poe-code-kamilio-unit.ln3MC7`.

- `557-grep-admission-red.tap`: **8 tests, 3 pass / 5 fail**, including the
  actual RangeError diagnostic before the implementation edit.
- `557-grep-admission-green.tap`: initial **8/8 pass** after the edit.
- `557-grep-admission-boundaries.tap`: expanded **13/13 pass**. Includes count
  boundaries, cumulative files/options, split and reused buffers, exact 32 MiB
  acceptance and one-byte rejection with UTF-8 argv accounting, early closure,
  cancellation, no provider dispatch on rejection, and no subject consumption.
- `557-grep-search-provider-adjacent.tap`: **188/188 pass**, zero skipped,
  cancelled, or failed; approximately 8.24 seconds. Includes actual Node
  workers, portable browser/provider tests, search capabilities, grep aliases,
  queue/deadline/cancellation/disposal coverage, and the existing 9 MiB subject
  compatibility test. New admission tests use a protocol-only recording
  transport, not a purported regex implementation; adjacent worker tests
  supply real matching coverage.

All new unit fixtures use in-memory filesystem/byte sources. No unit fixture
writes host files or queries an LLM. TAP capture is external orchestration in
the isolated temporary directory. No root build, staging, commit, or push was
performed by this worker.

## Repeat the focused checks

From the checkout root, outside the sandbox while root guards may be active:

```sh
TOOLCHAIN=$(cat /tmp/kamilio-toolchain.path)
UNIT_TMP=$(cat /tmp/kamilio-unit-tmp.path)
env -u NO_COLOR PATH="$TOOLCHAIN/bin:$PATH" TMPDIR="$UNIT_TMP" TSX_DISABLE_CACHE=1 \
  node --import tsx --test --test-concurrency=1 \
  packages/safe-bash/tests/commands/search.test.ts \
  packages/safe-bash/tests/commands/search/grep-pattern-admission.test.ts \
  packages/safe-bash/tests/commands/search/rg.test.ts \
  packages/safe-bash/tests/commands/search/safety.test.ts \
  packages/safe-bash/tests/commands/search/pipelines.test.ts \
  packages/safe-bash/tests/commands/search/capability-requirements.test.ts \
  packages/safe-bash/tests/commands/regex-execution/commands.test.ts \
  packages/safe-bash/tests/commands/regex-execution/executor.test.ts \
  packages/safe-bash/tests/commands/regex-execution/provider.test.ts \
  packages/safe-bash/tests/commands/regex-execution/portable.test.ts \
  packages/safe-bash/tests/commands/grep-aliases/aliases.test.ts \
  packages/safe-bash/tests/commands/grep-aliases/safety.test.ts
```

Root must run the normal integrated build and full maintained Bash gate after
all owners freeze. Focused tests do not establish an integrated gate or release.
The published 0.1.54 workerd evidence for issue 551 predates this fix; it is not
published acceptance evidence for issue 557. Delivery/publication remains
root-owned and must be reported separately from local implementation.
