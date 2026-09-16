# Opt-in virtual dd contract

This source-only command is experimental. It is not registered by default and
does not establish full GNU dd parity. The complete requested objective remains
open, particularly platform-specific flags and recovery behavior. No host
filesystem, process, environment lookup, or native fallback occurs in product
code. Native processes occur only in explicitly identified comparator tests.

## Composition

Within this checkout, import `ddCommands` from `src/commands/dd/index.ts` and use
`new Shell({ fs }).use(ddCommands(options))`. Alternatively register
`createDdCommand(options)` or the definitions from `createDdCommands(options)`.
These are source module paths, not claims of published package exports.
`replace` defaults to false. No other command or device is installed.

For device input, explicitly compose `createMountFileSystem` with a memory root
and `{ "/dev": createDeviceFileSystem() }` mounts, importing the latter from
`src/fs/devices/index.ts`. Then, for example:

```sh
dd if=/dev/urandom of=/sample bs=256 count=4 status=none
dd if=/sample of=/dev/null status=none
dd if=/input of=/output bs=512 conv=excl status=none
dd if=/more of=/output oflag=append conv=notrunc status=none
```

Tests execute a virtual `/copy.sh` using `sh /copy.sh`, with binary copying,
exclusive creation, byte skipping, append, and device discard. No test creates
an on-disk fixture. Device entropy, write policy and metadata come from the
mounted device provider; dd neither manufactures random bytes nor infers EOF
from a character device's reported size.

## Operands and transformations

- Recognized operands: `if`, `of`, `bs`, `ibs`, `obs`, `cbs`, `count`, `skip`,
  `iseek`, `seek`, `oseek`, `conv`, `iflag`, `oflag`, `status`.
- Decimal numbers accept leading C whitespace, a leading plus, the GNU byte
  suffix grammar and `x` factors. Counters are bigint, bounded to signed 64-bit
  numeric input. Binary powers use `K` through `Q`, optionally `iB`; decimal
  powers use `B`/`D` suffixes. The lower-case `k` variants, `b`, `w`, `c`, bare
  suffixes, invalid suffixes, overflow and zero-multiplier warnings are tested.
  Allocation and transfer limits below are deliberately much smaller.
- Default input/output records are 512 bytes. `bs` overrides `ibs` and `obs`
  regardless of operand ordering. Repeated ordinary operands take the last
  value; conversion/flag lists accumulate. The last status selection wins.
  One `--` delimiter is consumed; subsequent arguments remain operands.
- `count`, `skip` and `seek` accept byte selection through `B` and their flags.
  Short input reads count as records. `iflag=fullblock` aggregates them. Byte
  counts use full input-record quotas plus a final remainder, including GNU's
  short-read behavior when fullblock is absent. `count=0` still opens both
  endpoints and performs requested output open/truncation, without reading stdin.
- `sync` pads input records with NUL, or spaces for block/unblock. Swab pairs
  span input chunks and preserve the final unpaired byte. ASCII/EBCDIC/IBM maps
  operate on all 256 byte values; case conversion is the C-locale ASCII profile.
  Translation/case/swab ordering and cross-chunk block/unblock state are tested.
- `cbs` drives block padding/truncation and unblock trailing-space removal.
  Overlong records increment the truncated-record count once. ASCII implies
  unblock; EBCDIC/IBM imply block. Without cbs, record conversion is inactive.
  Incompatible conversions fail before opening files.
- `noerror` can recover a failed read on an explicitly seekable handle or a
  trusted resumable FIFO handle, and `noerror,sync` can substitute padding.
  Read/transfer limits and cancellation
  are never suppressed. Recovery on an opaque failed stream is refused, not
  represented as successful recovery. See the recovery gaps below.
- `notrunc`, `excl`, `nocreat`, `sparse`, `fsync`, and `fdatasync` are parsed;
  their real availability depends on the opener, as distinguished below.

## Default retained descriptors and stream fallback

Named files prefer the optional canonical VFS `open` contract, acquired through
`openCommandFile`. Reads, writes, truncation and synchronization retain that exact
descriptor until cleanup; rename, unlink or replacement of the original path
does not select another inode. Permissions are acquired by the provider at open;
read/write access modes remain enforced. Relative paths retain their components when
prefixed with cwd; symlink/`..` resolution remains the provider's responsibility.
Empty names remain empty. Directories fail at read time, and missing inputs
fail at open time even with count=0. Input is opened before output, so opening
the same virtual path for truncating output empties it before the first read.

Canonical positioned reads/writes implement a DD-owned absolute cursor without
reopening paths. Successful partial counts advance it by only the accepted bytes;
truncate does not move it. Sequential-only descriptors use their retained native
cursor. The current descriptor contract has no general lseek, so append output
does not advertise seek even if the underlying native regular file could seek.
For named regular-file append, DD need not apply the initial position before a
data write: append ignores that position. The driver still performs required
truncate/extend before copying unless notrunc is selected. Where the retained
handle supplies current size and truncation, zero records before the first data
write can also be skipped logically: a later append ignores those positions, or
EOF extends to the known logical position without writing zero records. No seek
method is fabricated on the descriptor. After a data append, further zero skips
require an actual retained-cursor query; file size is not a substitute. The
optional canonical `capabilities.position` and `getPosition` pair supplies that
query on capable providers, including memory. Providers without a position
primitive, including the current Node rooted-real adapter, still refuse
trailing/mixed sparse append. These optimizations do not apply to borrowed
standard streams or stream-only fallback.
Seeking after explicit DD-handle close fails with EBADF. Nonseekable input skips
by reading, subject to transfer and operation limits.

Canonical named output supports ordinary overwrite, exclusive creation,
existing-only `nocreat`, `notrunc`, output seek (including byte offsets), sparse
logical extent handling, append with or without initial truncation, and requested
fdatasync/fsync where the descriptor advertises synchronization. Output seek
without notrunc truncates/extends the retained file to the requested offset before
copying, including count=0. Memory sync acknowledges its volatile store; only a
provider advertising storage synchronization delegates a storage operation. A
successful sync syscall is not evidence of survival under physical power loss.

Providers explicitly refusing descriptors retain the stream path, not a
read/modify/replace descriptor imitation. Input uses stat/access and lazy
`readStream`, or bounded `readFile` when streaming is unavailable. Only this
fallback can reopen regular-file input by path/range; concurrent replacement can
then change the selected inode. Character devices remain opt-in stream providers,
not native host device admission. Input directories retain the read-time EISDIR
diagnostic even though canonical regular-file open refuses them.

Fallback named output requires streaming write support and uses `openFileOutput`
for backpressure, cleanup and the shell's aggregate file-output byte budget.
Exclusive creation requires `exclusiveCreate` and forwards `wx`/`ax` to the
provider. A scoped adapter refuses the helper's nonstreaming fallback rather
than weakening exclusive creation or record streaming. Append requires the
provider's streaming append capability.

Default support for flags:

| Selection | Default behavior |
| --- | --- |
| fullblock, count_bytes, skip_bytes, seek_bytes | Driver implements the applicable direction; GNU's inert opposite-direction pseudo-flags are accepted, except output fullblock is rejected |
| binary, text | No byte translation in this virtual POSIX/C profile |
| noctty | No controlling-terminal acquisition exists |
| input append | No effect on reads |
| output append with notrunc | Canonical append, or provider streaming append |
| nofollow with implicit stdin/stdout | No pathname is opened |
| named nofollow, directory, nolinks | Refused: canonical open has no corresponding atomic admission options |
| direct, cio, dsync, sync, noatime, nocache, nonblock | Refused: no corresponding provider guarantee |
| output append with truncation | Canonical open only; refused by the stream fallback |

Stream-only named `notrunc` without append, `nocreat`, output seek, and durability
conversions are refused. This includes cases where a particular device could
otherwise ignore truncation: the adapter does not special-case device names.
The mere `randomAccessWrite` capability does not supply a descriptor API; dd
does not silently substitute a read/modify/replace regular-file approximation.

Sparse without a suitable seekable handle writes zeros normally. With a supplied
regular-file handle, seeking over zeros requires truthful size metadata and
either an extent already within that size or a truncate/extend operation. Final
holes check the retained handle's current size before extending, without shortening
an existing notrunc tail. This is a fresh observation followed by truncation, not
an atomic compare-and-extend guarantee. Unknown
metadata falls back to writes, never silent byte loss. Physical allocation is
not inferred from logical zero bytes or mock seek calls.

## Injected descriptor opener

`openFile(context, request): Promise<DdFileHandle>` remains a trusted, opt-in
extension point in addition to the default canonical VFS implementation. The request
includes direction, raw optional path, flags, creation policy, truncation intent,
initial seek intent, required synchronization, block size and input bounds.

The opener must either honor the entire request or reject it. It must atomically
implement existing-only/exclusive/nofollow/append semantics when requested; a
stat followed by a separate open is not equivalent. An omitted path borrows
the supplied standard stream, not a host fd. `seek` in the request describes
intent for admission: the driver performs the actual absolute seek, and for
named seek output without notrunc it first truncates/extends to that offset.

Handles provide `read(size, { signal })`, `write(bytes, { signal })`, optional
absolute `seek`, optional `getSize({ signal })`, optional
`getPosition({ signal })`, optional `truncate`, optional
`sync(dataOnly, { signal })`, and `close`. Size and cursor queries return
nonnegative bigint values from the same retained handle. Cursor observations
must serialize with that descriptor's operations, retain sequential-position
semantics across other descriptors' appends/truncations, and never estimate the
cursor from file size. With no live size query, an injected opener must keep its
declared size valid for the final sparse-extension decision. Reads return at most
the requested bytes; an empty block is EOF.
Canonical DD handles distinguish their DD-local positioned cursor from the
underlying descriptor's sequential cursor: positioned reads/writes and logical
seeks report the former after the owned query barrier, while append reports the
actual retained backend cursor. Position forwarding requires both affirmative
capability and a backend method; absent support is not inferred. The command
helper serializes queries with other admitted descriptor work, validates a
nonnegative safe integer before DD converts it to bigint, preserves cancellation
and close draining, and does not admit or charge output bytes for a query.
Writes return a positive accepted byte count no larger than the supplied view;
partial writes are retried and accounted without replaying accepted bytes.
Zero progress on a nonempty request produces ENOSPC; invalid counts produce EIO.
An injected `type: "fifo"` asserts a resumable descriptor-like read operation:
errors do not terminate the reader's lifetime, and no seek is attempted during
noerror recovery. Do not attach that metadata to an opaque iterator that terminates
on throw. Default VFS/standard-stream generators gain no such recovery guarantee,
and no native FIFO or special-file access is enabled by this extension point.
Retaining write views past resolution requires copying. Truncation must not
change the current cursor. `type` and `size` must be truthful, never synthesized
to qualify a sparse operation. Close must release only invocation-owned resources.

Both requested sync conversions run in fdatasync-then-fsync order, including
after a write error or with count=0. EINVAL/ENOSYS from fdatasync falls back to
fsync without the fdatasync diagnostic. Other fdatasync errors are reported
and fsync is still attempted. No durability operation runs after cancellation.

The injected memfs tests establish positioned byte effects, partial writes,
sparse extent handling, recovery and dispatch order. They do not by themselves
establish canonical descriptor identity, storage synchronization, direct-I/O,
cache eviction, atomic namespace flags, or deployed backend support. Separate
canonical memory tests and rooted-real qualification are identified below.

**Remaining shared capability gaps:** additional atomic open flags, general
descriptor-relative seek (including append handles and borrowed standard streams),
recoverable read-error offset semantics, and provider-specific guarantees beyond
the canonical descriptor contract. No extension is implemented by pathname
inspection followed by an unrelated open. Rooted-real containment, stable trusted
root assumptions, TOCTOU limitations and special-file refusal remain unchanged;
virtual-device metadata does not authorize native `/dev` access.

## Bounds, ownership and cancellation

Options default to `maxBlockBytes=1048576`, `maxBufferBytes=8388608`,
`maxTransferBytes=67108864`, `maxReadOperations=1000000`, and
`maxArgumentBytes=65536`. Values are positive safe integers, except a zero
transfer limit is allowed. `now` defaults to monotonic `performance.now()`.

Argument bytes are admitted before parsing, block sizes before allocation, and
logical output seek offsets before file opening. Transfer limits bound consumed
input, emitted output, and logical output extent separately, not their sum.
Skipped input reads count toward consumed input; ranged input seeking does not.
An endless device therefore terminates by count, the finite configured budget,
or caller cancellation; omitting count never grants unlimited copying.

DD consumes the raw argument carrier rather than reconstructing operands from
lossy display strings. The VFS path API is text-based: invalid UTF-8 operands are
explicitly refused before file acquisition instead of selecting replacement-byte
names. This is not GNU arbitrary-byte filename parity. Valid UTF-8, including
embedded BOM characters, retains its spelling. Commands carry the same runtime
identity tag as the owning Shell.

Named canonical writes and injected named-handle writes use the same Shell
counted output ledger as stdout and stream files. Admission reserves the requested
bytes before a write; a validated successful partial count refunds only the unused
reservation. Invalid counts, cancellation and unknown failures keep the full
conservative charge. Retries submit only the unaccepted suffix. A nonempty
zero-progress write fails once with ENOSPC. Already-budgeted canonical/stream handles
and stdout are not charged twice. Unbound standalone hosts are trusted to own
their limits; a Shell owner missing its counted binding fails before writable
acquisition. No new helper/runtime changes belong to this DD slice.

Sparse named zero blocks also reserve their payload before seeking, preventing
zero-filled input from bypassing maxOutputBytes. A failed sparse seek retains
its reservation; a permitted write fallback requires a new admission. Initial
positioning and truncate-only logical extents are not payload writes: they remain
bounded by maxTransferBytes and provider storage/size authority, not an assertion
that maxOutputBytes limits file length. Allocation policy belongs to the provider.

`maxBufferBytes` bounds an individual retained input fragment or buffered file
read, not total RSS. A producer must respect that limit before allocating its
own chunks; dd checks before copying. dd also holds input/output blocks and an
at-most-65536-byte conversion buffer, plus provider/sink buffers. Retained
producer fragments are copied before producer advancement/return. Per-record
writes are awaited. Read operation limits include empty producer chunks.

Cleanup is registered before acquiring handles and closes every admitted handle
once, including late acquisitions. Caller cancellation preserves the exact
reason, including falsey values, rather than converting it into dd status 1.
Synchronization and cleanup run as explicit phases outside `finally`; an
escaping diagnostic failure is retained if a subsequent sync diagnostic fails.
Final caller cancellation takes precedence over both. Regression tests cover
undefined/zero diagnostic failures, falsey cancellation, missing sync methods,
and secondary close failures.
Close failures identify the original input/output operand. They are reported even
after a prior ordinary I/O failure and suppress final statistics, while all owned
handles are still drained. An already-observed stream write failure aborts/joins
that stream rather than being reported again as a synthetic close failure.
DD optionally forwards `acknowledgeCloseFailure(reason): boolean` from the
command-owned descriptor. Only after successfully diagnosing the selected close
failure, with caller and operation cancellation checked again, does it acknowledge
that exact handle/reason. Failed diagnostics and cancellation do not acknowledge.
The shared helper still drains retained work and close, while repeated direct
close calls still reject; acknowledgement only prevents cleanup from replaying
the already-handled failure. This relies on the independently owned shared helper
extension, not a change to the filesystem descriptor contract or budget identity.
Actual Shell regressions also cover late canonical acquisition and close barriers,
active partial-write buffer ownership, no retry after root cancellation, shared
stdout/file admission, invalid returned counts, and retained input identity.
Borrowed stdout is not closed. Implicit stdout enrolls destination-owned
cancellation; downstream EPIPE produces status 141 and closes named-file reads
without waiting for another block. Named `of` output is not canceled merely
because the unused stdout consumer exits. Arbitrary noncooperative injected
promises cannot be forcibly stopped. Cancellation and failures do not roll back
bytes already written, files already created, or truncation already performed.

## Reports and remaining differences

Status none suppresses statistics/warnings, not ordinary fatal errors. Noxfer
prints input/output and truncated-record counts without the transfer line.
Progress writes carriage-return updates between input operations, then a newline
before final counts. Clocks are injected in report tests; measured native elapsed
time and throughput are not claimed equal. Byte counts, record boundaries, SI/IEC
size prefixes and selected numeric formatting are checked independently.

Known accepted byte prefixes count toward transferred bytes even if a later write
fails. The bs fast path counts an output record only after completing that record;
the separate output-buffer path counts a nonempty failed prefix as a partial
record. A failing full output-buffer flush diagnoses `writing to`, while the fast
path and final partial-buffer flush diagnose `error writing`. Stream-only writers
that fail without acknowledging a record do not expose a reliable partial byte
count through ByteSink; no unknown prefix is invented in the statistics.

Outstanding compatibility differences include native integer-ratio throughput
rounding at extreme/sub-unit rates; locale-specific case/diagnostics; INFO/USR1
and SIGINT report handling; native EINTR retry policy; descriptor-relative seek
on redirected standard streams; output-seek fallback through readable output;
and native recovery under kernel-specific offset anomalies. Recovery subtracts the
previous completed partial input record when computing the next expected offset;
with sync it does not invent an extra padding record for that previous short read.
Partially filled fullblock buffers retain their bytes when padding is required.
These captured profiles are not universal kernel-error recovery parity. Unknown errno
messages come from the provider; the selected numeric-overflow text is Darwin C.
Help reproduces the immutable 3243-byte clean GNU 9.7 Darwin C-locale reference,
including its platform-specific flag list, INFO-signal sentence and documentation
footer. This is an exact CLI text-compatibility profile, not evidence that every
advertised native facility exists in a virtual provider. INFO/USR1/SIGINT reporting
remains unsupported, native-only flags require capabilities, and volatile memory
sync does not become durable storage. The version response still identifies this
virtual implementation. No installed native binary, kernel-flag support or
durable-storage parity is claimed by reproducing the reference help.

## Evidence and reproduction

Official documentation inspected: GNU's `dd invocation` manual at
`https://www.gnu.org/software/coreutils/manual/html_node/dd-invocation.html`.
That live manual can describe a newer release; version-pinned reference:
`https://raw.githubusercontent.com/coreutils/coreutils/v9.7/doc/coreutils.texi`,
section `dd invocation`, and the local clean 9.7 `src/dd.c`.

September 4, 2026 clean comparator profile: Darwin 25.4.0, Node v22.23.2,
LC_ALL=C, executable
`/tmp/safe-bash-scripting-oracles-20260904/coreutils-9.7-clean/src/dd`,
SHA-256 `fadf2537de7e051d0ddda1f4e793da9c51034b2bff8cb9d593ad4855305fcd4f`.
Clean `dd.c` SHA-256:
`1507cd22c250d75e8ec208446df3dd174b2bd85440e8c0690e8afcc1829cb234`.
The tests hash the bounded regular executable before and after comparisons and
check version 9.7. This is trusted local-path evidence, not atomic executable
identity enforcement against concurrent replacement.

Initial exploration used the older partial-build path
`/tmp/safe-bash-scripting-oracles-20260904/coreutils-9.7/src/dd`. Its hash observed
on September 4 after switching was
`ea4bea9d30c61eb4e166b630ed9ec6eee4c8202a7001d532cfdec3d7338dcf1a`;
that does not retroactively authenticate every initial probe. The user reported
stale-header objects in that build affecting yes. Initial dd source/table/grammar
probes remain a separate provisional profile, not relabeled clean results.
Current native test comparisons rerun against the clean executable.

The September 4 scoped run after the synchronization-precedence refactor passed
40 tests, with zero failures or skips, including the authenticated clean-oracle
comparisons. A strict NodeNext no-emit check of these source/tests also passed.
This is local source evidence, not a full build, guarded-lint rerun, package
qualification, commit, or release. Root owns those admission decisions.

Native tests use stdin/stdout pipes, no persistent file fixtures, a two-second
per-process timeout and a 1-MiB output cap. Therefore they do not qualify native
filesystem seek/sparse/durability or kernel read-error effects. The native suite
requires explicit test-only `DD_ORACLE` (a nonempty absolute executable path) and
`DD_ORACLE_SHA256` (64 hexadecimal digits). No executable path or hash is inferred
from the historical profile above. The supplied hash must match before version
checking or comparisons, version must report GNU coreutils 9.7, and the measured
hash is reported and rechecked after the suite.

Only when both environment variables are absent do the five native tests emit
the named skip `native dd prerequisite absent: set DD_ORACLE and DD_ORACLE_SHA256`.
A supplied empty, relative, missing, nonregular, oversized, unexecutable,
wrong-version or hash-mismatched executable fails; missing/malformed companion
configuration also fails. Root acceptance requires a fully supplied binding and
zero skips. Named optional skips are not acceptance or native compatibility
evidence.

The original hygiene regression demonstrated a supplied missing path exiting
successfully with five skips, and absent configuration implicitly running the
ephemeral clean executable. Those outcomes are retained here as red evidence.
`oracle-hygiene.test.ts` checks the actual suite entrypoint in isolated child
processes. Hash/version negative controls use an explicitly named in-memory
executable fixture, not a native compatibility oracle. They create no files and
do not replace or weaken the real native comparison assertions.

The September 4 hygiene-fix run explicitly supplied the clean path and hash:
44 focused tests passed, zero failed and zero skipped. The absent-prerequisite
skip behavior was tested only inside its isolated negative-control child run;
none of the acceptance suite's native comparisons were skipped. The expanded
strict NodeNext no-emit check also passed.

From the checkout root:

```sh
DD_ORACLE=/tmp/safe-bash-scripting-oracles-20260904/coreutils-9.7-clean/src/dd \
DD_ORACLE_SHA256=fadf2537de7e051d0ddda1f4e793da9c51034b2bff8cb9d593ad4855305fcd4f \
node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/dd/*.test.ts
```

Source delivery requires root-owned exact build/export/test-membership admission
and independent review. The five source TS files are `index.ts`, `options.ts`,
`conversions.ts`, `io.ts`, `report.ts`. Tests are `dd.test.ts`, `io.test.ts`,
`native.test.ts`, `oracle-hygiene.test.ts`, `report.test.ts`,
`descriptor.test.ts`, with `helpers.ts`. This DD slice changes no
default registration, root exports, shared contracts, build settings or README.

### Canonical descriptor phase-two evidence

The first phase-two canonical/workflow test run had 15 failures and 3 passes.
After descriptor integration, five actual Shell cases still failed until the
shared counted-budget binding was integrated by its owner. A later full scoped
run had 38 passes and 6 failures: three binding-dependent cases, the directory
read-versus-open diagnostic, and two stream-failure fixtures whose hooks had been
bypassed by the newly preferred canonical path. The directory diagnostic was
fixed in product code. The two fixtures now explicitly advertise `open: false`
to continue exercising stream fallback; their assertions were not removed.

A separate sparse-budget red had 19 passes and 1 failure: sparse zero blocks
could seek without output admission. They now reserve their payload through the
shared counted writer. The final lifecycle red had 22 passes and 1 failure:
logical seek incorrectly succeeded after DD-handle close. Explicit local closure
state fixes that without modifying the committed shared helper. Additional real
Shell checks retain output writes and both sync requests on the acquired inode
across pathname replacement; canonical partial failure reports only known prefixes.

The September 4 phase-two source suite passed 69 tests with zero failures or skips,
using the same explicit clean oracle binding as above. Strict ES2023 NodeNext
no-emit checking of DD source/tests passed. These are scoped checks, not a fresh
guarded root lint/build or public-package qualification. Shared descriptors/runtime
are separately integrated prerequisites, not
files changed or requalified wholesale by this DD slice. The original two
no-unsafe-finally findings remain resolved by explicit synchronization/cleanup
phases; primary diagnostic and falsey cancellation regressions remain present.

Authorized ad-hoc rooted-real QA evidence is preserved at
`/tmp/safe-bash-scripting-oracles-20260904/descriptor-qa-dd-PUcfE6`.
The agent created separate native/virtual directories for each case, initialized
identical bytes, ran the authenticated GNU 9.7 executable with relative named
operands, then ran the same command in an actual Shell over the explicitly rooted
real adapter. Fourteen cases matched exit status, stdout, exact noxfer stderr,
file presence and output bytes; existing virtual output inode identity was checked.
Cases cover notrunc/nocreat/seek, default seek truncation, zero-count extension,
fsync/fdatasync, append with and without truncation, seek-byte flags, input skip,
sparse extension/notrunc, exclusive creation/collision and missing nocreat.
`results.json` and `COMPLETE.json` preserve these results and the before/after
oracle binding. These were live-worktree probes, not frozen-source or complete
transitive-hash qualification. They are manual QA artifacts, not unit fixtures;
the unit suite still creates no files. A successful sync operation does not test
physical crash durability, and no host special node was opened.

An additional `append-seek-known-gap.json` deliberately records a mismatch,
not a fifteenth passing case: GNU returns zero and appends bytes for
`oflag=append conv=notrunc seek=2 bs=1`; DD refuses seek and preserves the old file.
The scoped before/after source hashes and executable recheck for this probe are
retained separately; they do not retroactively bind the earlier fourteen cases.
Finishing this combination requires a truthful general descriptor seek capability,
separate from positioned-write capability, or another approved equivalent contract.
No pathname reopen, pseudo-handle or silent flag weakening is proposed. Additional
atomic nofollow/directory/nolinks options and backend-specific flags remain separate
unimplemented capabilities; this milestone is not full DD parity.

### Append cursor regression remains blocking

The subsequent September 4 append/seek investigation expands that mismatch to
eleven literal GNU 9.7 reference cases in `descriptor.test.ts`: notrunc/default
truncation, offsets beyond EOF, zero count, and leading/trailing/mixed/all-zero
sparse records. The original focused result was 25 passes and 11 failures. The
tests remain active, not skips or accepted differences; the earlier 69-test green
run does not establish acceptance of the expanded suite.

Fresh native/actual-Shell rooted-real comparisons are preserved separately at
`/tmp/safe-bash-scripting-oracles-20260904/descriptor-qa-dd-append-Og7f81`.
`results.json` contains all eleven inputs, operands, native/virtual outputs and
statuses. `COMPLETE.json` records eleven mismatches, unchanged before/after DD
source hashes and the authenticated clean oracle hash. This binds the named DD
sources only, not a frozen transitive build or public package.

A no-op initial seek is insufficient: starting from `abcdef`, the input
`XY\0\0` with `bs=2 seek=1 oflag=append conv=notrunc,sparse` produces
`abcdefXY\0\0` natively. The append write advances the retained cursor to byte
8, after which a relative sparse seek advances it to 10. The canonical descriptor
currently exposes neither cursor query nor seek; its positioned-write capability
is correctly false in append mode. A regular-file stat or a later EOF observation
does not supply that retained position under concurrent append/truncate activity.
DD must not invent seek support, disable append, reopen a path, or substitute a
metadata-based cursor estimate to make this matrix green. A truthful optional
retained-cursor capability is required before this blocker can be cleared.

The subsequent DD-only fix removes the unobservable initial positioning operation
for non-sparse named regular-file append when no seek method is available. It does
not expose a pretend seek method, reopen a file, or replace O_APPEND with positioned
writes. All six non-sparse cases now pass, including both zero-count variants.
The focused suite is 31 passes and 5 failures; the five sparse cases remain blocking.
This narrows the earlier capability request: a cursor extension is not necessary
for ordinary append plus initial seek, but remains necessary for sparse append.

The fresh rooted-real/native rerun is preserved at
`/tmp/safe-bash-scripting-oracles-20260904/descriptor-qa-dd-append-fixed-4ousqc`.
It reauthenticates the prior reference inputs and clean GNU 9.7 executable, reruns
all eleven cases, and records six exact matches plus five failures. Before/after
DD source hashes and the oracle hash are unchanged within that rerun; the original
all-red evidence remains untouched. No shared descriptor or output helper was
modified for this partial fix. Full DD acceptance remains blocked.

The subsequent full DD glob also includes the independently added
`tests/commands/dd/review.test.ts`, which this author has not edited. With the
explicit clean oracle binding, that run reports 115 tests: 99 passes, 16 failures,
zero skips. Five failures are the sparse append/seek cases above; eleven are
independent CLI help/selection and write-failure diagnostic/record-profile findings.
Those findings are not cleared by the six-case append fix and are not waived.
Scoped strict source/descriptor-test typechecking passes; no full acceptance,
tool commit or public-delivery readiness is claimed.

### Independent fault-profile follow-up

The independent review subsequently expanded its native write, read, close,
exclusive-create and FIFO fault profiles. The author corrected zero-progress
writes to ENOSPC, fast-path versus separate-buffer record accounting and error
wording, close direction and final-stat suppression, short-read recovery offsets,
and recoverable trusted FIFO handling. Stream completion no longer diagnoses an
already-reported write failure a second time as a close failure. Exclusive stream
creation reaches the shared exclusive admission path rather than ordinary write
admission. Own earlier record/error expectations were corrected against the
native evidence; independent assertions were not changed. A subsequent complete
run with the explicit clean oracle was 132 tests: 123 passes, 9 failures, no skips.

Root then added two actual-Shell regressions: a diagnosed close error must allow
the following `||` command to run, for both injected and canonical ownership.
Root reported 134 tests: 123 passes, 11 failures, no skips, preserved in
`/tmp/safe-bash-scripting-oracles-20260904/dd-root-integration-review.log`.
The author independently reproduced both new failures before changing code:
the focused result was 0 passes and 2 failures. DD's registered cleanup was
rethrowing a close failure that DD had already successfully diagnosed and mapped
to exit status 1. DD now acknowledges that local failure only after the diagnostic
write succeeds. Its cleanup still drains the same idempotent close; unsuccessful
diagnostics leave the cleanup failure unacknowledged. Two additional owned tests
cover repeated cleanup and falsey escaping diagnostic errors. The focused I/O
suite passes all 18 tests.

The new full run is 136 tests: 126 passes, 10 failures, no skips, with the explicit
pinned clean GNU 9.7 oracle. Scoped strict ES2023/NodeNext source and owned-test
typechecking passes. Remaining failures are:

- Five sparse append/seek cases requiring truthful retained cursor semantics.
- Four exact help-byte comparisons: this virtual profile emits 722 bytes, the
  pinned native help emits 3243. Both exit successfully; the assertion value
  `1` is `Buffer.compare`, not the command exit status. The pinned help advertises
  INFO-signal reporting that this command does not provide. Neither a different
  immutable help-profile policy nor an exact-help change has been accepted;
  assertions stay active and unchanged.
- One canonical close-recovery case. DD's local replay is fixed, including the
  injected-owner Shell regression, but `openCommandFile` independently registers
  its rejecting close promise with the invocation. It still rethrows the already
  diagnosed error during the root cleanup barrier. A command-descriptor-specific
  acknowledgement mechanism has been proposed to the shared helper owner; no
  shared helper, runtime, filesystem contract or budget binding was changed.

These are live-worktree scoped results, not a frozen-source acceptance or a
public build qualification. API names and the five TypeScript source filenames
are unchanged. The source is not frozen or commit-ready, and the full DD
objective, backend capability gaps and independent review remain open.

### Help, acknowledgement and sparse follow-up

The four help-byte failures are now fixed by reproducing the authenticated
3243-byte clean GNU 9.7 Darwin C-locale help. All eight independent native CLI
assertions pass unchanged. The earlier 722-byte output and its four failures
remain historical evidence; the native help's signal and storage wording does
not establish those capabilities in this implementation. The pinned text policy
and outstanding facilities are stated above. Updated visual capture remains for
root: the previously configured freeze executable and local Playwright/sharp
packages were unavailable here; no replacement renderer was installed or claimed
as a verified screenshot.

Socrates implemented the separately authorized command-helper API
`acknowledgeCloseFailure(reason: unknown): boolean`. DD now forwards this optional
method and acknowledges only its successfully diagnosed selected handle/reason.
Before forwarding, the current-helper Shell regression was still 1 pass and
1 failure. After forwarding, both independent Shell recovery cases and the three
owned diagnosis/cancellation checks pass, five total. The owned acknowledgement
spy itself was red before integration. Shared helper/tests are not author edits;
their independent qualification and commit remain root-owned.

Sparse handling has progressed independently of that shared change. Two new
retained-size regressions first failed: an external extension was incorrectly
shortened, and an external truncation was not re-extended. Canonical DD handles
now query the retained descriptor's current size before final sparse extension.
Three more original append/seek cases pass: leading zeros, only zeros, and only
zeros beyond EOF. Until the first data append, logical zero skips require no
native cursor observation: another append ignores that offset, while final EOF
uses the known logical offset and fresh retained size. This does not fabricate a
seek method, change O_APPEND, reopen a pathname, or write zero blocks instead.

The injected opener has an optional authoritative `getPosition` query. Four new
cursor tests initially produced 1 pass and 3 failures; all four now pass, including
growth and shrinkage of the inode by a different retained descriptor after DD's
append. The memfs fixture supplies its actual descriptor-local cursor, separately
from its live size; this is explicit injected-provider evidence, not canonical
backend qualification. A new cancellation-at-size-query regression also failed
before the post-observation cancellation check; it now confirms no truncate is
admitted after cancellation. The focused I/O suite passes all 24 tests.

Fresh ad-hoc rooted-real/native evidence is retained at
`/tmp/safe-bash-scripting-oracles-20260904/descriptor-qa-dd-sparse-DXMT34`.
All eleven original append/seek references were reauthenticated and rerun:
nine exact matches and two failures. Before/after DD source and oracle hashes
match within that run. That scoped run preceded the subsequent acknowledgement
and final observation-cancellation edits, so it is not a final-source freeze.
Separate native references at
`/tmp/safe-bash-scripting-oracles-20260904/descriptor-qa-dd-cursor-ePFagO`
observe completion of the first append, modify the file through another
descriptor while stdin remains open, then supply a zero block and EOF. Both
growth and shrinkage confirm that retained cursor and current file size differ.
These are manual QA artifacts in authorized scratch directories, not unit files.

The final complete DD run with the explicit pinned oracle is 144 tests:
142 passes, 2 failures, zero skips. Strict scoped source/owned-test typechecking
passes. The remaining failures are the unchanged default canonical trailing and
mixed sparse append cases. An optional canonical position capability plus
`getPosition(options?: FsOptions): Promise<number>` has been proposed; no shared
filesystem implementation was changed. Memory can expose its retained cursor,
but Node 22's public FileHandle API has no corresponding native cursor query:
`https://nodejs.org/docs/latest-v22.x/api/fs.html`. A real adapter must not invent
one from fstat or widen rooted host access. Canonical integration, truthful wrapper
forwarding/refusal, real-backend feasibility, and independent review remain open.
Factory/options names and the five TypeScript source filenames are unchanged;
the optional handle hooks are additive. This is not a full DD acceptance or a
commit-ready source freeze.

### Rebuilt bridge acceptance and review freeze

The authorized cursor extension was split by ownership: McClintock supplied the
safe-fs contract, managed lifecycle/forwarder and memory implementation; this
author changed only `src/contracts/filesystem-descriptor.ts` and its matching
contract test to forward the optional query. The committed close acknowledgement
API from `210ba165f` was preserved. Command query forwarding requires both an
affirmative position capability and a callable backend method, uses the same
owned operation queue, checks nonnegative safe-integer results, and preserves
falsey failures, cancellation and close draining without charging output bytes.
If a provider advertises position but supplies no method, the command wrapper
does not advertise a usable position query.

The new forwarding tests first reported 19 tests: 3 passes and 16 failures.
They then passed all 19. Six stricter diagnostic-metadata assertions separately
failed until the command helper's syscall label was aligned with the canonical
`getPosition` operation. All 60 tests in the complete command-descriptor helper
file pass against the rebuilt provider. No acknowledgement test was weakened.

Before root rebuilt the public bridge, the default DD tests still loaded the old
`packages/safe-js/dist/safe-fs.js` runtime. Those two remaining failures were a
stale-artifact dependency, not new source defects, and no capability workaround
was applied. Two explicitly injected current-source memory probes passed, but
were not counted as public-runtime acceptance. Public-dependent testing was held
during root's maintained build and optional build. Root reported both completed
successfully before the final author rerun.

After that refresh, the complete DD glob with the explicit authenticated clean
GNU 9.7 oracle reports **145 tests, 145 passes, zero failures, zero skips**. All
eleven named append/seek cases and both independent Shell close-recovery cases
pass. The increase from the earlier 144-test suite is one regression checking
that a positioned DD handle reports its DD-local cursor rather than its retained
descriptor's unchanged sequential cursor. That regression first observed
`[0, 0, 0]` instead of `[0, 2, 4]`, then passed after preserving the owned query
barrier and selecting the appropriate cursor. Closed-handle queries still fail.
The rebuilt-provider helper/custom-opener rerun is 84/84, zero skips; this overlaps
the DD suite and is not an additional distinct-test total. Strict scoped ES2023,
NodeNext source/owned-test typechecking passes, including the command helper test.

Final manual native/provider comparisons are preserved at
`/tmp/safe-bash-scripting-oracles-20260904/descriptor-qa-dd-final-2xduVR`.
The original eleven references and pinned clean oracle were reauthenticated.
With the rebuilt public safe-fs provider and current source DD, memory matches
all 11/11; rooted-real matches 9/11. The two real trailing/mixed sparse append
refusals remain native parity failures and the capture command exits 1 rather
than treating them as passes. Raw descriptor position capability is affirmative
for memory and absent for real. Existing output inode identity is retained.
The five DD TypeScript source files, command-descriptor helper, public bridge
entry and oracle hashes are unchanged across this capture; this is scoped live
qualification, not a complete transitive build/archive freeze or physical
durability proof. All earlier red and partial-oracle evidence remains untouched.

Author-owned review scope is now frozen: the five DD TypeScript files and this
semantics document; `dd.test.ts`, `descriptor.test.ts`, `io.test.ts`,
`native.test.ts`, `oracle-hygiene.test.ts`, `report.test.ts`, and `helpers.ts`
under `tests/commands/dd`; and the authorized query-forwarding changes in
`src/contracts/filesystem-descriptor.ts` and
`tests/contracts/filesystem-descriptor.test.ts`. The independently owned
`review.test.ts`, shared filesystem implementation, root optional entry, build,
registry, README and export files are not author edits. No commit was made.

This freeze closes the reported default-memory regressions and makes the slice
available for independent review. It does not close the full GNU dd objective:
real cursor support, the other explicitly unsupported backend flags/workflows,
native signal/error subtleties and remaining profile differences documented
above remain open. No default device mounts or default registry changes are
introduced, and no root containment or native-special-file refusal is weakened.
