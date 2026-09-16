# cmp compatibility evidence

## Status — September 4, 2026

**Independent review fixes pass locally; root acceptance remains pending.**
The opt-in implementation and its tests are uncommitted. The latest explicit GNU
acceptance run has 97 tests: 97 pass, zero fail, zero skip, zero TODO, including
13 independent review tests. The earlier 91-test run preceded the exact-help and
canonical-metadata regressions. The original
assertions in `tests/commands/cmp/parity.test.ts` remain unchanged. The previous
71/72 result is historical failed evidence, not the current result. No mismatch
was normalized away or converted into an assertion accepting a difference.

The focused review is complete; a clean integrated gate remains unverified. Root
owns integration. No registry, root export, package, build, README or Git commit changes
are part of this work.

## Target and primary sources

The target is **GNU diffutils 3.12, Darwin arm64, C/POSIX message locale,
64-bit signed counts, nonseekable stdin**, invoked with `argv[0] = cmp`, with an
comparison-block selection based on the first input's canonical `ioBlockSize`.
An explicit `comparisonBlockBytes` overrides that metadata. When first-input
metadata is absent, including ByteSource stdin, the fallback is **65,536 bytes**:
an explicit virtual-host policy, not an observation of native metadata.
The selected size is independent of provider chunk size.
It can be set to 16,384 for the separately traced initially unfilled Darwin pipe
profile, or another positive safe integer for a host-selected profile. No VFS
`st_blksize` field is fabricated or inferred from chunk boundaries. Factory
configuration is snapshotted and does not add non-GNU CLI flags.
This is not BSD `/usr/bin/cmp`, GNU/Linux qualification, or a multilingual
compatibility claim.

- GNU manual, invocation and options:
  <https://www.gnu.org/software/diffutils/manual/diffutils.html#Invoking-cmp>
  and <https://www.gnu.org/software/diffutils/manual/html_node/cmp-Options.html>.
- Official source release:
  <https://ftp.gnu.org/gnu/diffutils/diffutils-3.12.tar.xz>.
  Its `src/cmp.c` was inspected for option ordering, saturating count behavior,
  quoting, formatting, EOF conditions and block-dependent exit selection;
  `lib/cmpbuf.c` was inspected for block filling and block-size selection.
- Root's full-build oracle:
  `/tmp/safe-bash-scripting-oracles-20260904/diffutils-3.12/src/cmp`.
  Executable SHA-256, independently checked with `shasum -a 256`:
  `5b0ebf8ed3ef54ae96a1a473ec7f25d1b44cbbe9253edacf88f6350fbe5a233a`.
- Root supplied the release archive SHA-256:
  `7c8b7f9fc8609141fdea9cece85249d308624391ff61dedaf528fcb337727dfd`.
  This worker did not independently hash root's archive.

Before root's binary was available, a Homebrew GNU 3.12 bottle was installed
and used for initial probes. No duplicate source build was performed. Final
acceptance uses root's exact binary, not Homebrew or a BSD fallback.

## Implemented interface and behavior

The internal opt-in family exports `createCmpCommand`, `createCmpCommands`,
`cmpCommands`, `CmpCommandsOptions` and `CmpLimits`. The family contains only
`cmp`; replacement is explicit through `replace: true`. Production code uses
the supplied VFS and byte sinks/sources, not native subprocesses or host files.

- Binary comparison, first difference and line numbers, all-differences octal
  output, control/meta-byte display for every byte value, and silent status.
- `-b`, obsolete `-c`, `-l`, `-s`, `-i`, `-n`, `-v`; corresponding long names,
  including `--print-chars`, `--quiet`, `--silent`, `--help` and `--version`.
  Short clusters, attached/separate values, unique long abbreviations, exact
  ambiguity diagnostics, `--`, GNU option permutation and presence-based
  `POSIXLY_CORRECT` handling.
- Omitted second operand and `-` read stdin. Two `-` operands represent the
  same nonseekable descriptor and do not acquire/consume stdin, including
  unequal skips. A seekable stdin descriptor is not represented by ByteSource.
- Positional skips, separate `-i A:B`, cumulative maxima for skips and minima
  for repeated `-n`; the native already-saturated skip corner is retained.
  Counts use decimal, octal and hexadecimal, optional signs/leading whitespace
  as accepted by the pinned binary, k/K/M/G/T/P/E/Z/Y suffixes, B/D decimal
  suffix variants and iB binary variants. Overflow is bounded during parsing.
- Empty/prefix EOF diagnostics, relative post-skip byte/line numbering,
  verbose position width from known remaining sizes or count limits, and
  exact tested C-locale argument/path quoting.
- Files are checked in operand order. Silent mode suppresses opening errors,
  not argument or reading errors. A zero count still validates file operands.
  Same-name and VFS-proven alias shortcuts occur after opening checks.

`--version` identifies virtual-bash and its GNU compatibility target instead
of claiming to be a GNU-authored executable. This is an explicit identity-only
exception, checked against an independently declared complete version string.
`--help` now matches the pinned GNU C-locale stdout, stderr and status exactly,
including abbreviated and option-ordering invocations. Messages are implemented
for the C profile; translated locales are not supported.

## Streaming, limits and cancellation

All factories accept an optional `comparisonBlockBytes` override,
`limits.maxChunkBytes` (default 1,048,576) and `limits.maxFallbackBytes` (default
8,388,608). Values must be positive safe integers. `replace` defaults to false.
The selected block size bounds each comparison buffer; it is not reduced
when the provider chunk limit is smaller. There are no ambient product environment
reads; `POSIXLY_CORRECT` is read from `CommandContext.env`.

Streaming VFS reads request chunks of at most 65,536 bytes, further bounded by
`maxChunkBytes`. Known regular-file skips use ranged VFS reads; overflowed
regular-file skips behave as empty input. Nonseekable skips discard chunks.
Each cursor owns its retained bytes before producer advancement/finalization.
The comparison retains two admitted chunks and two configured comparison-block
buffers, with transient replacement copies;
there is no input-size-proportional accumulation on the streaming path.
Reads fill a comparison block across arbitrarily short producer fragments before
comparison, left input before right. Block-local difference status, partial final
blocks and zero-count final iterations follow the pinned GNU implementation.
Verbose output is flushed in roughly 16-KiB batches and at comparison-block
boundaries; sink writes are awaited. Flushing before the next block preserves
earlier output if a later read fails.
Total output limits remain the supplied sink/shell's responsibility.

Adapters without streaming support receive a bounded `readFile` request only
after a known-size check. Unknown/oversized fallback inputs are refused rather
than loaded without a bound. This resource refusal is a virtual-host policy,
not a claim that native cmp imposes the same limit. Provider-owned allocations
and retained sink output are outside the command's memory bound.

Comparison and skipped/empty-chunk loops yield cooperatively. Metadata and
fallback reads propagate signals and observe late rejections. Cleanup is
registered before acquisition, is idempotent, closes acquisition through the
invocation signal on external shutdown, and awaits cooperative iterator returns.
Both readers are finalized; cleanup failure becomes trouble after successful
comparison but cannot replace an earlier failure. Root cancellation, including
falsey and errno-shaped reasons, retains identity. Arbitrary uncooperative host
iterator finalizers cannot be forcibly terminated and are not a bounded-time
cleanup guarantee.

## Resolved native difference and read traces

The pinned GNU executable can print differing bytes under `-l` and nevertheless
return **0** when a later comparison block is equal. Its `differing` state is
local to a block; native block size is selected from filesystem metadata. The
first virtual implementation incorrectly remembered any difference and returned
**1**, and stopped immediately when its compared-byte count reached `-n`.

The active reproduction uses two 1,048,576-byte pipe inputs containing `a`,
with only byte one of the second input changed to `b`, and:

```text
cmp -ln1048576 /dev/fd/3 -
```

Both implementations output six spaces followed by `1 141 142\n`, with empty
stderr, and now both exit **0**. The test still compares the exact stdout, stderr
and exit status, without changing its arguments or fixture bytes.

An ad hoc `read`/`fstat` interposer observed root's original GNU binary; the GNU
executable was not rebuilt or patched. The interposer preserved read results,
file metadata and errno, and accumulated FNV-1a-64 over returned bytes. It lives
outside the repository at
`/tmp/safe-bash-scripting-oracles-20260904/cmp-read-trace.dylib` and is not a
canonical test prerequisite. Independent JavaScript hashes of the supplied
buffers agreed with the final native read hashes:

| Trace | Input | Bytes actually read | Non-`a` bytes | FNV-1a-64 |
| --- | --- | ---: | ---: | --- |
| Counted 1-MiB inputs | first | 1,048,576 | 0 | `509a9b97ff722325` |
| Counted 1-MiB inputs | second | 1,048,576 | 1 | `ef6176ec33922326` |
| Short-read/physical-EOF inputs | first | 32,769 | 0 | `3aec95dbda496c8c` |
| Short-read/physical-EOF inputs | second | 32,769 | 1 | `e4d1f14f7edc71a5` |

For the original failure, the native first-input `fstat` reported a FIFO with
`st_blksize=65536`. There were sixteen complete 65,536-byte reads per input,
followed by **`read(fd, ..., 0) = 0` on both inputs**. These final calls did not
probe physical EOF; the byte-count limit was exhausted. GNU nevertheless enters
the comparison loop again and resets its local difference flag before returning
0. VFS now performs the equivalent zero-length comparison iteration without
advancing the input producer. This confirms a GNU 3.12 behavior, not lost input
bytes, truncated pipes, or a fixture mismatch.

The second trace withheld input after seven bytes until the native read trace
confirmed receipt, then sent 4,093 bytes, followed by the remainder. At initial
`fstat` the first FIFO had `st_blksize=16384`; stdin reported 65,536. The native
requests/returns for the first input were:

```text
request 16384 -> 7
request 16377 -> 4093
request 12284 -> 12284    # first complete comparison block
request 16384 -> 16384   # second complete comparison block
request 16384 -> 1
request 16383 -> 0       # actual EOF; final comparison block contains one byte
```

Native and virtual with `comparisonBlockBytes: 16384` both output the same
19-column byte-position line and exit 0. `lib/cmpbuf.c:block_read` fills a block
until the requested count, EOF or error; a short transport read is not a
comparison boundary. `src/cmp.c:373-377` uses the first input's block size for
both arguments to `buffer_lcm`; this explains the 16-KiB choice despite stdin's
different metadata. Its loop at lines 482-643 resets `differing`, and only a
partial final block returns its local status. The new implementation follows
that loop rather than choosing status from producer chunks.

Darwin pipe metadata can grow from 16 KiB to 64 KiB as the pipe fills. Thus an
uncontrolled native launch can select different block profiles, even with the
same eventual bytes. VFS FileStat exposes optional `ioBlockSize`; without an
explicit override, cmp now selects the first input's value. This preserves the
pinned GNU 3.12 source's use of `stat_buf[0]` for both arguments to `buffer_lcm`:
for a positive size the result is that first size, not the LCM of both inputs.
Malformed supplied sizes fail before producer acquisition rather than changing
comparison boundaries silently. Missing metadata uses the documented 64-KiB
fallback, not a claim to discover an unknown native block size. Native pipe
comparisons still require a controlled or independently observed profile;
canonical metadata selection does not infer dynamic FIFO state. Four-byte
synthetic block tests establish chunk independence and final
iteration behavior, not the existence of four-byte Darwin filesystem blocks.

Block-read error precedence is now covered by VFS regressions: a failure while
filling the first input block occurs before acquiring the second input, and an
error in a later block does not discard earlier verbose output. Descriptor close
failures, stdout device optimizations/SIGPIPE, seekable stdin and special device
files remain **not fully qualified** by these VFS/pipe tests. VFS
metadata/access is not an atomic native open/fstat operation. Raw non-UTF-8
pathname bytes are outside the string-path VFS profile. No claim of exhaustive
native compatibility follows from the passing comparisons.

## Evidence and oracle containment

Tests write fixtures only to the in-memory VFS. The native oracle receives
stdin plus an in-memory `/dev/fd/3` descriptor. Nonempty first inputs now retain
Node's inherited Darwin socket, whose measured block size is 65,536; an empty
first input uses Bash process substitution and `cat` to supply a readable FIFO.
It never writes native fixture files. A first harness attempt directly opened
an empty socket and received `Permission denied`; the empty-FIFO path retains
that correction. POSIXLY_CORRECT is set only after
the helper's process-substitution syntax is parsed, preventing a second harness
defect where Bash itself entered POSIX mode before parsing that syntax.

Native tests require an explicit `CMP_ORACLE`; there is no machine-specific
default and no automatic download/build. Absence skips the native suite and
standalone parity test with an explicit prerequisite message, not passing
comparisons. An explicitly supplied missing/wrong-version executable fails.
The oracle has a 3-second deadline and a combined 1-MiB stdout/stderr cap. Its
isolated process group is signalled only on error/timeout before complete close;
input handles are destroyed, and direct-child close is awaited before settlement.
Successful complete close never signals the former process group. Mocked
lifecycle tests cover missing prerequisites, output overflow, timeout, subprocess
error, closed-group ownership and waiting for inherited-pipe closure after exit.

Root's subsequent full run failed 78/79 in the all-256-byte display case with
`kill EPERM`, recorded in root's preserved `cmp-root-full.log`. The helper had
unnecessarily signalled the detached group from the child's complete-close
handler, after process ownership was lost. Three failing-first regressions
reproduce that EPERM for statuses 0, 1 and 2. The fix separates complete-close
cleanup from active termination, also preventing late stream notifications from
signalling the former group. EPERM is not suppressed or retried. A separate
timeout regression verifies pre-close descendant-group signalling and deferred
settlement until complete close, including direct-child exit before pipe closure.
This supersedes the earlier successful worker run as lifecycle qualification;
the root failure and all original native byte assertions remain preserved.
An ad hoc real-oracle overflow probe compared two differing 8-MiB memory buffers
with `-l`: the 1-MiB output cap rejected the operation, complete close settled,
and a bounded `ps` census found no members of that invocation's process group.
This checks the actual Bash/process-substitution path for output termination;
timeout ordering remains covered by the deterministic mocked lifecycle test.

The independent reviewer's 65,535-byte, first-byte-difference `-l -n65535` case
exposed the FIFO profile race again: identical stdout, native status 0 versus
virtual status 1. An unmodified-metadata trace of the same bytes observed a
65,536-byte FIFO block and status 1, with exactly 65,535 bytes read per input.
First-input FNV-1a-64 was `05bc1a0688606ba6`; second-input hash was
`2fe8f7955b2401b8`, with exactly one non-`a` byte (255). This preserves the failure
as a real uncontrolled-profile mismatch, not a truncated-input explanation.
The helper now uses the inherited nonempty socket instead of a growing FIFO to
qualify the selected 64-KiB profile. GNU's executable, CLI arguments, supplied
bytes and every reviewer/product assertion are unchanged; the transport is
intentionally changed and this is not qualification of all FIFO growth states.

The first full run after that transport change passed 89/90 and failed with a
parent-side `write ENOTCONN` during an early native exit. Like EPIPE/ECONNRESET,
Darwin socket peer closure can stop an unneeded input write. A failing-first
mock regression covers exact successful child-result collection after ENOTCONN;
the helper still awaits close and preserves every output/status assertion. It
does not turn an oracle timeout, output overflow, spawn error or EPERM into a
pass. The following full run passes 91/91, including the independent boundary
matrix and real short-consumer pipeline tests. Earlier FIFO read traces remain
valid historical observations and are not rewritten as socket observations.

TDD started with two missing-module test-file failures, before product files
existed. The first implemented run was 39/44 passing; subsequent failing cases
drove skip/quote corrections, seek behavior, alias detection, cancellation,
cleanup and oracle containment. One initial test incorrectly expected a later
single `-i0` not to raise the second skip to the first; it was corrected to
`-i0:0` after inspecting native semantics, not by weakening the implementation.

The first explicit-oracle run executed 212 native subprocess invocations: one
version prerequisite and 211 paired comparisons, of which 210 matched and the
verbose-status reproduction failed. This original failure is retained here.
The block-fix explicit-oracle run executed 219 native subprocess invocations:
one version prerequisite and 218 matching paired comparisons. The subsequent
quoting-audit author cohort executes 237 invocations: one version prerequisite and
**236 matching paired comparisons**. Native cases
cover all modes, all 256 byte displays, EOF, numeric grammar/overflow, argument
errors/quoting, option ordering, stdin duplication and byte/chunk boundaries.
VFS-only tests additionally cover mutable producers, cancellation, errors,
bounded reads and cleanup. New large-input comparisons include physical EOF,
count exhaustion, tail differences, prefix EOF and independently fragmented,
reused VFS buffers. One new fixture initially supplied a single 1-MiB-plus-one
stdin chunk, correctly triggering the configured chunk cap; it was changed to
stream the same bytes in bounded fragments, without changing its parity assertion.

The earlier first-difference resource test had yielded one-byte fragments and
incorrectly expected comparison before a full native block was read. Its producer
now yields one full 64-KiB block, retaining the original two-read/two-close/status
assertions. A separate failing-first regression verifies that incomplete-block
read errors are not hidden by an early differing byte. The cleanup-precedence
fixture likewise yields full blocks instead of requiring 65,536 one-byte reads;
its assertions and error identities are unchanged. All five new block tests were
observed failing before the block-loop implementation. This is scoped evidence
from an uncommitted worktree, not exhaustive native qualification.

A subsequent 254-comparison ASCII path/value diagnostic audit found three
path-quoting mismatches: embedded `#`, `{` and `}` were unnecessarily quoted.
GNU `lib/quotearg.c` treats `#` and `~` specially only at the start, and braces
only when the entire argument is one brace. An added 18-comparison regression
failed before the correction and passes afterward, including leading characters,
isolated braces and absolute-path variants. Existing byte/parity assertions were
not changed. This audit does not extend the locale or raw-pathname profile.

## Validation commands and results

Owned candidate paths (the independent reviewer's `review.test.ts` is excluded
from this ownership list and was not edited by the author):

```text
packages/safe-bash/src/commands/cmp/index.ts
packages/safe-bash/src/commands/cmp/options.ts
packages/safe-bash/src/commands/cmp/io.ts
packages/safe-bash/src/commands/cmp/compare.ts
packages/safe-bash/src/commands/cmp/SEMANTICS.md
packages/safe-bash/tests/commands/cmp/cmp.test.ts
packages/safe-bash/tests/commands/cmp/blocks.test.ts
packages/safe-bash/tests/commands/cmp/native.test.ts
packages/safe-bash/tests/commands/cmp/parity.test.ts
packages/safe-bash/tests/commands/cmp/helpers.ts
packages/safe-bash/tests/commands/cmp/oracle-lifecycle.test.ts
packages/safe-bash/tests/commands/cmp/tsconfig.source.json
packages/safe-bash/tests/commands/cmp/tsconfig.json
```

Run from the repository root:

```sh
CMP_ORACLE=/tmp/safe-bash-scripting-oracles-20260904/diffutils-3.12/src/cmp \
  node --import tsx --test --test-concurrency=1 --test-reporter=spec \
  packages/safe-bash/tests/commands/cmp/*.test.ts
node --import tsx --test packages/safe-bash/tests/commands/cmp/cmp.test.ts \
  packages/safe-bash/tests/commands/cmp/blocks.test.ts \
  packages/safe-bash/tests/commands/cmp/oracle-lifecycle.test.ts
node_modules/.bin/tsc -p packages/safe-bash/tests/commands/cmp/tsconfig.source.json
node_modules/.bin/tsc -p packages/safe-bash/tests/commands/cmp/tsconfig.json
git diff --check -- packages/safe-bash/src/commands/cmp \
  packages/safe-bash/tests/commands/cmp
```

- Earlier scoped acceptance including independent tests: **91 pass / 0 fail / 0 skip**
  (about 5.12 seconds); the author-only cohort is 84 tests.
- Author VFS and oracle-lifecycle tests: **40/40 pass**.
- Owned-source strict typecheck: pass.
- Test-inclusive strict typecheck: pass after root rebuilt safe-fs declarations.
  The earlier `src/shell/conditional.ts:120` declaration error was not changed
  by this worker.
- Root reported two cmp lint findings, `no-unsafe-finally` and `no-this-alias`.
  Both constructs were removed without suppressions; cleanup-precedence tests
  pass. A fresh guarded whole-root lint result is not claimed here.
- Whitespace check: pass. No package build/public-consumer qualification claimed.
- Ad hoc actual-output rendering was inspected in
  `/tmp/safe-bash-scripting-oracles-20260904/cmp-visual-smoke.png`, using the repository's `terminal-png`
  renderer. The worker-owned image was moved out of tests at root's request;
  it is not part of the proposed commit. It covers first difference, verbose byte columns, silence, skips
  and EOF. It is not a screenshot test or evidence of root CLI integration.
  The standalone `freeze` executable was unavailable; the same terminal renderer
  used by the repository screenshot command supplied the capture instead.

## Final independent-review fix evidence

Root's `cmp-reviewed-root.log` preserved 94 passes and one failure: first-input
`ioBlockSize: 16384` with second-input 65536 yielded virtual status 1 instead of
0 for 32,769 bytes differing at byte one. The regression assertion is unchanged.
Default selection now uses the first canonical value; reversed and non-dividing
metadata pairs guard against accidentally using the second input or their LCM.
An explicit override still wins without mutating the canonical preference.
Additional failing-first coverage rejects malformed sizes before acquisition;
unknown first-input metadata retains the declared fallback instead of borrowing
the second input's preference.

The complete pinned-oracle rerun passed **97/97 tests, zero skips**, in about
5.1 seconds, recorded in
`/tmp/safe-bash-scripting-oracles-20260904/cmp-canonical-review.log`.
Original parity assertions, bytes, and status comparisons remain unchanged.
Exact-help review also produced and inspected
`/tmp/safe-bash-scripting-oracles-20260904/cmp-exact-help-review.png`.
This focused acceptance does not remove the stated profile limits or establish
a full package build, guarded lint, public-consumer, or release gate.
