# Opt-in truncate semantics

## Status and integration boundary — September 4, 2026

The command implementation and its VFS tests are available through this directory's
`index.ts`: `createTruncateCommand`, `createTruncateCommands`, and `truncateCommands`.
No default registry, root barrel, package export, build membership, README, or Git
commit is changed by this work. Root owns those integration decisions, including
keeping the command out of default bundles and declaring maintained test inputs.

Root integration adds these factories and their options type to the explicit
repository-local `build:optional` entry, not to default registries or npm exports.
The final root replay passes 348 tests with zero skips against the clean GNU 9.7
oracle. Source/test and optional-consumer types pass. The compiled public-host
suite passes ten tests, including canonical preferred-I/O metadata for `-o` and
raw diagnostic/filename behavior. Actual command output and help were visually
inspected. These scoped live-worktree checks do not establish unbounded native
equivalence or a published release.

This is **not a full native-parity claim**. In particular, default `-o` remains
unsupported on providers that have neither canonical block-size metadata nor an
explicit truthful fallback. A passing unsupported-capability test is not evidence
that native `-o` behavior has been delivered for that provider.

Root explicitly retains all outstanding gaps on its audit; passing local tests
and a bounded oracle matrix are not completion or acceptance. After the owned
follow-up, truncate is held stable for shared integration and independent review.

## Primary references and oracle identity

Root subsequently warned that the initial partial coreutils build could contain
objects compiled before generated headers. All initial-binary observations below
are preserved but **provisional historical evidence**, not clean-build acceptance.
The separate clean-build qualification below supersedes them for acceptance.
No anomalous parser behavior was adopted over the GNU 9.7 source.

- GNU manual: <https://www.gnu.org/software/coreutils/manual/html_node/truncate-invocation.html>.
  The rolling manual is not version-pinned; implementation details below were
  checked against the 9.7 release source and executable, not inferred from its
  current version label.
- GNU 9.7 source: <https://github.com/coreutils/coreutils/blob/v9.7/src/truncate.c>.
  Release-local `lib/xstrtol.c`, `lib/xdectoint.c`, `lib/stat-size.h`, and
  `src/system.h` clarify suffix parsing, overflow, block units, and usable sizes.
- Root-built oracle:
  `/tmp/safe-bash-scripting-oracles-20260904/coreutils-9.7/src/truncate`.
  Its version output identifies GNU coreutils 9.7. Independently checked executable
  SHA-256: `8a4d0aba94e1826cfafd7c9fe007cf8758286714319d421edc9e8dadf8774f4d`.
- Root supplied official source-tar SHA-256:
  `e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf`.
  This worker did not rebuild the oracle or independently rehash the tarball.
- Executed native profile: Darwin arm64, `LC_ALL=C`, native `argv[0]=truncate`.
  Setting argv[0] avoids normalizing utility-name differences out of diagnostics.
  This is the selected diagnostic platform, including EOVERFLOW wording. No
  Linux or localized strerror-byte parity is claimed or inferred from it.
- Clean acceptance binary, supplied after root's fresh configure/default make:
  `/tmp/safe-bash-scripting-oracles-20260904/coreutils-9.7-clean/src/truncate`.
  Its independently verified SHA-256 is
  `e72b70379db18bf088208ebf5db983b6c555684218a0ed4d6e5a26c42fb058f7`.
  The clean version output also identifies GNU coreutils 9.7.

## Invocation and arithmetic

Short options `-c`, `-o`, `-r`, and `-s` accept clusters; required values may be
attached or separate. Long equivalents accept unique abbreviations and `=` values.
`--` ends parsing; `-` is a filename, not stdin. Options normally permute past
operands. Presence of `POSIXLY_CORRECT`, including an empty value, instead stops
option parsing at the first operand. Help and version exit at their parsing
position; an earlier invalid option or number still fails.

Numbers are decimal signed 64-bit integers, calculated with bigint rather than
rounded JavaScript arithmetic. Leading C whitespace is accepted, including after
`<`, `>`, `/`, and `%`; trailing whitespace and fractions are rejected. Multipliers
are `k K m M g G t T P E Z Y R Q`. They can stand alone for one unit. The optional
`B` or historical `D` ending selects powers of 1000; no ending or `iB` selects
powers of 1024. Zero with a large suffix is valid. A signed suffix without digits
is invalid, as are dd's `b`, `c`, `w`, standalone `B`, and multiplication syntax.

An unmodified size is absolute. `+` and `-` adjust the base; `<` caps it, `>` raises
it to a minimum, `/` rounds down, and `%` rounds up. Negative results clamp to zero.
Rounding by zero fails before filesystem changes. Signed overflow is diagnosed,
not wrapped. A reference is sampled once before target processing; combining it
with `-s` requires a relative modifier. Repeated `-r` selects the last reference.

GNU's repeated-size state is retained deliberately: `-s+1 -s3` means relative +3;
`-s/1 -s3` keeps rounding-down mode; `-s+1 -s+2` rejects multiple relative modifiers.
A new `<`, `>`, `/`, or `%` replaces that mode. Invalid earlier sizes cannot be
hidden by later options.

## Canonical I/O block-size integration

Requested shared contract, coordinated with root and the FileStat owner:

```ts
readonly ioBlockSize?: number;
```

The value is the backing file's preferred I/O block size in bytes, a positive safe
  integer. The explicit real adapter should preserve native `stat.blksize`, including
through stat/lstat and relevant wrappers. Memory needs an explicit virtual policy;
an absent value stays unknown. Neither logical size nor `allocatedBytes` determines
this field. The command consumes this property already, with a structural check
while shared declarations and published adapter output are being integrated.

`-o` multiplies the signed size by **each target's** block size before applying its
modifier. Reference sizes stay in bytes and never select the target's block size.
Overflow in multiplication is a per-file failure. GNU's compile-time DEV_BSIZE
fallback for unusable native st_blksize is platform-specific; this command does
not invent such a value for an unknown VFS. Invalid declared metadata is rejected.
Native valid metadata was 4096 in the exercised profile.

## Host options and provider responsibilities

Carver integration handoff (shared files were not edited by this worker): add the
field to `packages/safe-fs/src/contracts/filesystem.ts`; propagate valid native
`Stats.blksize` in `fs/real/index.ts`'s `fileStat()` used by stat/lstat. Audit the
explicit `snapshotStat` field lists in `fs/readonly/index.ts`,
`fs/mount/index.ts`, and `fs/overlay/index.ts`; review `fs/quota/index.ts`
forwarding and memory's explicit policy. `bridge/stats.ts` currently emits a
hardcoded blksize and is not canonical evidence. Remote adapters must leave
unknown values absent. Overlay copy-up changes backing storage: a lower-layer
block size must not be retained as an assertion about the writable upper file.

A shared seek-end operation must report the actual end offset, not a non-regular
stat size. Reference measurement uses a read-only descriptor; target-relative
measurement belongs to the writable descriptor subsequently truncated. The
current hook accepts nonnegative safe integers only; absent, negative, fractional
or unsafe values cannot mean zero. Extending this to all off_t values requires
coordinated exact-size and truncate contracts, not merely a bigint seek hook.
Path-based hooks do not solve descriptor identity or concurrent copy-up races.

`TruncateCommandsOptions` accepts:

- `replace?: boolean`: false by default; registration collisions fail before
  replacing anything. True explicitly replaces the existing command.
- `ioBlockSize?(path, stat, context)`: number or Promise<number>. A compatibility
  fallback only when canonical `stat.ioBlockSize` is absent. It cannot override
  canonical metadata, and is not a substitute for integrating the real adapter.
- `seekEnd?(path, stat, context)`: number or Promise<number>. Supplies a truthful
  end offset for non-regular reference files or relative-size targets whose stat
  size GNU would not use. Without it, those measurements report unsupported.

Paths are resolved VFS paths; the context provides the exact filesystem and
cancellation signal. Hooks are explicit trusted host bindings, never ambient
native calls. There are no command-specific environment variables other than
the parsing behavior of `POSIXLY_CORRECT`. Locale-specific messages are not
implemented; diagnostics use the documented C-locale rendering profile.

The command always uses existing `fs.truncate` for resizing. There is no content
read/rewrite fallback, synthetic device success, or native process in product
code. Missing files are created with an empty append-mode write requesting 0666;
the backend owns permission/umask policy. Existing contents are not overwritten
during creation. `-c` suppresses ENOENT only. Symlinks are followed by the backend,
including dangling links when creation is allowed. Multiple targets are processed
in order, including repeated paths, and processing continues after per-file errors.

Signals reach filesystem calls and host hooks, with checks after awaited metadata
hooks and before truncation. Abort escapes instead of turning into a successful
or ordinary failed command. Output writes are awaited; stdin is never read.
The command owns no open descriptors. Prefix retention, zero-filled extension,
identity, hardlink visibility, timestamps, allocation and permission enforcement
are responsibilities of the actual truncate implementation, not synthesized stats.

## Executed evidence

Unit tests use the memory VFS and explicit in-memory host wrappers only. The first
test run failed with ERR_MODULE_NOT_FOUND for the missing command before product
files were added. Subsequent red/green cycles covered native diagnostic differences,
non-regular seek semantics, canonical block metadata, and callback precedence.

- 200 tests passed, zero skips, in the latest focused run.
  `node --import tsx --test packages/safe-bash/tests/commands/truncate/*.test.ts`
- Owned-source strict TypeScript check passed with NodeNext, ES2023,
  noUncheckedIndexedAccess and exactOptionalPropertyTypes enabled.
- Owned-directory ESLint and `git diff --check` passed.
- Full source-inclusive test-import typechecking now passes after root rebuilt
  safe-fs declarations. The earlier `FileType`/`character` declaration failure
  is preserved as historical evidence, not an outstanding typecheck failure.
- `/tmp/safe-bash-scripting-oracles-20260904/truncate-visual-review.png` was rendered from actual command
  output using terminal-png and visually inspected. Help, silent success, rounding
  error and missing block metadata are legible. This is an ad-hoc artifact, not
  a screenshot test or root CLI wiring claim.

The screenshot was moved out of the repository without overwriting any existing
file and is not a commit input. `tests/commands/truncate/oracle-initial-evidence.json`
is a bounded manual-capture summary, not a unit-test-generated fixture; no test
reads or writes that evidence file.

`tests/commands/truncate/oracle-clean-evidence.json` is the separate, bounded
260,291-byte clean-oracle capture. It contains 539 argument vectors, both sides'
raw status/stdout/stderr, and target size/SHA-256 records where file effects were
compared. The manual runner compared actual target bytes before capturing hashes.
The capture is not imported or written by any unit test. Its 507 exact matches and
32 explicitly non-exact Darwin strerror results are separate counts; there are
no other differences. This extends the earlier matrix with both single-dash
`-help`/`-version` rejection cases and repeats the 63-case byte matrix against the
clean binary. The initial evidence remains untouched.

`tests/commands/truncate/oracle-darwin-followup.json` records the owned diagnostic
fix and a fresh replay of all 539 cases against the same verified clean binary:
539 raw exact matches, zero normalized comparisons. It binds the predecessor
capture by SHA-256 and retains both sides of all 32 corrected overflow results.
Every native status/stdout/stderr and compared target effect was also checked
unchanged against the predecessor. All 32 cases still fail with exit status 1;
only the virtual stderr wording changed. The preceding 507/539 capture is retained
unchanged. This matrix does not accept the separately documented integration gaps.

Manual native fixtures lived exclusively in unique `/tmp/truncate-*-oracle-*`
directories and were removed after each run. No native subprocess or disk fixture
is part of the unit suite. An additional inherited-descriptor check used actual
directory and target descriptors as `/dev/fd/3` and `/dev/fd/4`, not fabricated
descriptor paths; GNU reference resizing succeeded to the observed 96-byte end.

| Manual run | Exact evidence |
| --- | --- |
| `/tmp/truncate-manual-oracle-rOM6iD` | 63 combinations: seven modifiers times nine values; statuses, stdout, stderr and binary file bytes all matched. |
| `/tmp/truncate-manual-oracle-7xfKuR` | 474 probes: 441 exact, 32 overflow strerror-wording differences, one directory-reference size defect (native 64 versus VFS 0). The directory defect became a failing unit test before correction. |
| `/tmp/truncate-final-oracle-eGRMaH` | Repeated 474 probes: 442 exact; the same 32 explicitly non-exact strerror cases; no other differences. Canonical metadata supplied actual native block size, without the command callback. The directory case used an actual read-only `os.lseek(SEEK_END)` host measurement and matched 64 bytes. |

The 474-probe matrix consists of 450 suffix cases (25 prefixes, six endings,
three numeric prefixes), 17 option/quoting/state cases, and seven filesystem cases.
The suffix prefixes were `k K m M g G t T P E Z Y R Q e p z y r q b c w B` and empty;
endings were empty, `B`, `D`, `iB`, `i`, `b`; numeric prefixes were empty, `0`, `1`.
`-c` against a missing target tested large suffix parsing without huge allocation.

Selected native filesystem evidence, with a five-byte initial file:

| Arguments | Native result and virtual qualification |
| --- | --- |
| `-os2 file` | Exit 0, size 8192 with block size 4096; matched with canonical metadata. |
| `-os-2 file` | Exit 0, size 0; matched. |
| `-os%2 file` | Exit 0, size 8192; matched. |
| `-rref -s+2 ref other` | Both targets become 7; reference sampled before modifying it. |
| `-s2 dir link dangling absent/child other` | Exit 1; directory/ENOENT diagnostics exact; link target, dangling-link referent and later file become 2. |
| `-cs2 dangling loop missing/child file` | Exit 1 for ELOOP only; missing targets remain absent; later file becomes 2. |
| `-rdir file` | GNU succeeds, using seek end rather than regular-file stat semantics. Default VFS now honestly reports unavailable measurement; explicit actual seek-end host matches. |

## Remaining gaps, not silently counted as passes

1. Shared `ioBlockSize` declarations, native propagation, wrapper preservation,
   and an explicit memory policy need root/Carver integration and independent
   qualification. Bare memory `-o` rejection is not full tool support.
2. No shared seek-end operation exists. Darwin GNU accepted a directory reference
   and `/dev/null` or `/dev/zero` references. It also accepted `-s0 /dev/null` and
   `-s+0 /dev/null`. Existing real `fs.truncate` admits only regular files. These
   are backend-contract gaps, not grounds for declaring native special files
   invalid. The command delegates absolute truncation and offers an honest seek
   measurement hook instead of globally banning these types or faking success.
3. The original 32 overflow-wording differences are fixed for the selected GNU
   9.7 Darwin/C platform: both sides now say `Value too large to be stored in data
   type`, with exit 1. Thirty-two first-failing regression tests preceded the fix.
   Linux's different strerror wording remains outside this selected diagnostic
   profile; no host-platform auto-detection or normalization was introduced.
4. GNU C help bytes and status match the pinned GNU 9.7 oracle. Version output
   remains an explicit exception: it names safe-bash and its GNU 9.7 target.
5. Filesystem lengths are numbers. Parsed 64-bit sizes outside the exact safe
   integer range report unsupported when passed to the VFS, rather than rounding
   or allocating a giant buffer in the command. In-range large sizes are delegated
   to the provider; negative adjustments may clamp safely even when their signed
   magnitude exceeds the number range.
6. Path-based stat/create/truncate cannot emulate a single held native descriptor
   under concurrent rename/replacement, close failures, or partial creation races.
   Explicitly unsupported capabilities may fail before native would create a file.
7. Timestamp, mode and allocation behavior varies by backend and host. Memory
   tests verify retained identity/mode/atime and updated modification metadata.
   Native Darwin retained inode/mode in shrink/equal/extend checks; equal and
   extending truncates also advanced atime in the observed APFS profile. No
   cross-backend identical timestamp or sparse physical-allocation claim is made.
   Creation requests 0666; the memory backend has no native process-umask contract.
8. Non-UTF-8 POSIX byte filenames, localized diagnostic text, every native errno,
   and resource exhaustion/races are not exhaustively qualified by this suite.

Root should register all three canonical `.test.ts` files, review shared metadata
and device contracts, and run public opt-in consumer/build checks before treating
this leaf implementation as integrated delivery. No commits or releases were made.

## Independent review follow-up — September 4, 2026

The current review adds `tests/commands/truncate/review.test.ts` as the fourth
canonical test file. Root owns its inventory registration and the truncate
tsconfig. Install, root exports/build/configuration, README files, and the original
three native evidence captures were not edited by this review.

The first executable independent regression run produced 16 failures, four
passes, and one unavailable-native skip. The failures covered empty-name
`--no-create`, byte-exact short/long option and numeric diagnostics, raw filename
and reference aliasing, filesystem calls after cancellation, Shell settlement
before cooperative cleanup, and timer starvation across finite operands. Each
of those failures preceded its source correction.

The reviewed parser now consumes the owned argument carrier rather than treating
its lossy text view as byte identity. Its internal argument strings represent one
character per byte. GNU diagnostics quote those bytes, and invalid short options
report the first offending byte. Before a pathname reaches a string-based VFS,
strict UTF-8 decoding preserves valid byte sequences, including a leading BOM.
Non-UTF-8 paths fail explicitly with operation-not-supported: they must not
truncate a different, valid replacement-character filename. This is an honest
namespace limitation, not native arbitrary-byte filename support.

Invocation cleanup is registered before filesystem work starts. Overlapping
cleanup calls share completion, locally stop new admission without cancelling
the borrowed parent signal, and await admitted cooperative work. Abort checks
after capability lookup and creation prevent subsequent provider calls. The
operand loop yields every 64 completed operands so a finite memory-backed
workload can observe timer cancellation. These changes do not introduce a held
file descriptor, a namespace lock, rollback, or preemption of an uncooperative
host promise. The path replacement/unlink and native close-error limitations
recorded above remain.

### Memory capacity is filesystem policy

The canonical memory filesystem allocates an array for the requested length;
it does not implement native sparse allocation. Truncate has no `maxFileBytes`
setting and does not silently clamp requested sizes. Hosts running untrusted
scripts against memory storage should wrap that storage with
`withFileSystemQuota(memory, { maxBytes: ... })` from `poe-code/safe-fs`, choosing
a quota appropriate for their workload, and retain the Shell's execution limits.
That quota accounts for logical filesystem bytes, not total JavaScript heap,
transient copies, or process RSS. It is not a promise of native physical-allocation
parity or an atomic guarantee against changes made outside the wrapper.

Review tests use an eight-byte quota and nine-byte refused request to prove
rejection before memory allocation while preserving existing binary contents.
ENOSPC/EFBIG mocks also preserve existing contents and permit later operands to
run. The maximum-safe-integer request is sent only to an always-refusing mock;
no large array or on-disk fixture is created. Real provider capacity refusals
remain failures; they are never converted into sparse success.

### Canonical metadata and qualification boundary

The earlier outstanding-metadata item is superseded at the source-contract level
by root's canonical `ioBlockSize` work. The directly inspected canonical memory
source declares 65536. Review tests verify that this metadata wins over a legacy
callback, and separately verify callback behavior through a fixture that
explicitly removes block metadata. Existing fallback tests now use that explicit
fixture; their assertions are preserved rather than depending on stale builds.

At review time, the built `poe-code/safe-fs` runtime used by ordinary leaf tests
still omitted the new metadata. The additional canonical-source test is not
public package/build qualification. Root must rebuild and check the real public
consumer before making an integrated-delivery claim.

The reviewed full leaf run passed 338 tests with zero failures or skips: the
original 200 tests plus the new review tests, including 105 exact native argv,
status, stdout, and stderr comparisons. The native suite binds the clean Darwin
GNU 9.7 executable hash recorded above and requires explicit
`SAFE_BASH_TEST_TRUNCATE` and `SAFE_BASH_TEST_TRUNCATE_SHA256`. An absent path skips
only that native suite; a supplied empty/missing path or wrong/missing hash fails.
Native calls use no-create and absent-path checks, bounded output, and a deadline;
they do not create host files. The matrix covers long-option abbreviations and
argument rules, retained/repeated size modifiers, overflow, raw invalid argument
bytes, operand permutation, and POSIXLY_CORRECT. Native sparse file effects were
not re-created on disk by these unit tests; the original effect captures remain
separate historical evidence.

This is approval of the reviewed opt-in implementation within these recorded
boundaries, not full GNU equivalence. Branded version output, string-only
VFS paths, backend capacity and special-file/seek-end support, path-based races,
unqualified errno/localization combinations, and public build/consumer acceptance
remain explicitly outside that claim. No source fix was made for missing
trailing-slash paths: a fresh clean Darwin probe confirmed the current ENOENT
diagnostic, despite the different platform behavior mentioned in a GNU source
comment.

### Final GNU help qualification — September 4, 2026

Root required exact GNU C help rather than the earlier branded/incomplete text.
Eight native help/argument-order regressions were added first: six help-output
cases failed, while the two error-precedence cases already matched. A separate
no-prerequisite help fingerprint regression also failed before correction.

Help now matches the clean GNU 9.7 oracle exactly: status zero, empty stderr,
1400 stdout bytes, SHA-256
`8f8d422ebb95f2a1265c14a568fba0f055d634911b481fb62d23c9607dc6d2ab`.
This includes abbreviations and early-help option handling. The GNU help wording
does not change the memory filesystem's eager allocation or remove the quota
recommendation above. Truthful branded `--version` output is separately tested
and remains the sole help/version identity exception.

Final qualification passed 148 focused review tests and 348 full truncate tests,
with zero failures or skips and 113 exact native comparisons. The maintained
truncate tsconfig passes strict typechecking. Without native prerequisites,
234 tests pass and only the native suite skips; the help-byte fingerprint test
still runs. Root retains rebuild, default-package/consumer checks, and literal
test registration ownership.
