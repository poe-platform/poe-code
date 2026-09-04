# shuf semantics

## Scope and qualification

This is a source-level, opt-in command family. It exports
`createShufCommand`, `createShufCommands`, `shufCommands`, and
`ShufCommandsOptions` from `index.ts`. The single-command factory returns a
`CommandDefinition`; the plural factory returns a frozen one-element array;
the plugin registers `shuf` with collision preflight and explicit replacement.
No root exports, package exports, build inputs, default registry, README,
integration-test inventory, or release files were changed by this assignment.

Root integration now includes these factories in the explicit repository-local
`build:optional` entry, with runtime-affinity validation and literal canonical
test membership. The normal package still excludes the command and its artifacts.
The final root native replay passes 323 tests with zero skips, strict source/test
types pass, and the compiled optional/public-host suite passes eight tests,
including shuf binary operands and named-output budget enforcement. Actual help
and pipeline output were visually inspected. These are scoped live-worktree
checks, not a universal native-parity or published-release claim.

The target is GNU coreutils **9.7, Darwin arm64, LC_ALL=C**, invoked with
`argv[0] = shuf`, 64-bit unsigned integers, and a 63-bit maximum head count.
This is not a claim of every GNU version, locale, platform, filesystem, or
unbounded-input equivalence. Help remains byte-identical to the native profile.
Version output identifies virtual-bash and its GNU 9.7 compatibility target;
its stdout is an explicit, bounded native-parity exception described below.

The earlier 2026-09-04 clean-oracle replay passed all **284 focused tests**, with
no skips. The accepted executable is
`/tmp/safe-bash-scripting-oracles-20260904/coreutils-9.7-clean/src/shuf`, SHA256
`cc33253093868fd2253de5561e980f879821e148ce43245350693fa6169375bc`.
Root supplied it from a fresh configure/default-make build.
`../../../tests/commands/shuf/ORACLE_CLEAN.json` records this scoped acceptance.

The initial 271-test run used a build later found to have a mixed native/GNU
getopt problem in a different utility. Preserve
`../../../tests/commands/shuf/ORACLE_INITIAL.json` as explicitly unqualified
historical evidence. All eight retained initial diagnostic observations were
also replayed against the clean shuf and agreed; no parser-anomaly workaround
was needed for this command.

## September 4 review repairs

Root's subsequent review run was **316 pass / 3 fail out of 319 tests**, with
strict test-project typechecking passing. Its `shuf-reviewed-root.log` is
preserved unchanged. The three failures were independently reproduced before
source edits; the original assertions remain unchanged:

- A rejected entropy finalizer replaced an escaping stdout failure. Execution
  now remembers whether an earlier failure occurred before awaiting cleanup.
  Earlier failures, including falsey reasons and diagnostic-sink failures, keep
  precedence; a cleanup-only failure remains observable. Caller cancellation
  still outranks cleanup, and cooperative iterator return is awaited.
- Named character-device input with `size: 0` incorrectly used regular-file
  sampling. Only a regular file with a known nonnegative safe-integer size now
  supplies the size threshold. Nonregular input uses the unknown-size reservoir
  path; the original seeded comparison now emits `a\ng\n`, matching GNU, instead
  of `f\nd\n`.
- Invalid line-count diagnostics reconstructed replacement-character bytes from
  decoded argv. The parser now retains the original value index/byte offset and
  quotes the owned argument bytes on the invalid-count path. Separate, attached,
  clustered and abbreviated count options preserve invalid UTF-8, quotes and
  newlines. This does not establish raw-byte parity for every other diagnostic.

Three additional tests cover falsey/diagnostic-sink precedence, cleanup-only
failure and attached/separate raw count values. The expanded focused review
first had **7 pass / 5 fail**, then **12/12 pass** after the source fixes. The
review-repair full explicit-oracle suite was **322 pass / 0 fail / 0 skip / 0 TODO**
(about 3.41 seconds), and `tests/commands/shuf/tsconfig.json` passes. Ampere's
passing helper changes were not edited. Historical JSON oracle records were
not regenerated. These source repairs still require independent approval;
passing local tests are not a commit, root integrated gate or release.

The repair touched only:

```text
packages/safe-bash/src/commands/shuf/shuf.ts
packages/safe-bash/src/commands/shuf/args.ts
packages/safe-bash/tests/commands/shuf/review.test.ts
packages/safe-bash/src/commands/shuf/SEMANTICS.md
```

Actual VFS diagnostic and seeded character-input output was rendered and
visually inspected at
`/tmp/safe-bash-scripting-oracles-20260904/shuf-review-fixes-worker.png`.
This is an ad hoc screenshot outside the test tree, not a committed fixture.

## Version identity exception and frozen candidate

Root's final audit found that the previous version text literally identified
the implementation as GNU shuf and repeated GNU copyright, license and author
claims. The earlier statement here that it did not identify itself as a GNU
binary was incorrect. A new exact identity assertion failed before the version
text changed to:

```text
shuf (virtual-bash, GNU coreutils 9.7 profile)
```

Only version stdout has this intentional identity exception. It no longer
claims GNU authorship or GNU licensing for this implementation. Its status and
stderr remain compared exactly with the authenticated GNU oracle. The former
version-stdout equality case was replaced by the explicit exception test;
no other native assertion or oracle output was normalized. Help text is unchanged
and its complete byte comparison remains active, including early help exit.
This exception does not broaden the existing platform/resource qualification.

The final local suite passes **323/323**, with zero failures, skips or TODOs
(about 2.78 seconds); strict test-project typechecking passes. The focused
identity/help/ancillary run passes 15/15. Actual version output was rendered
and visually inspected at
`/tmp/safe-bash-scripting-oracles-20260904/shuf-version-identity-worker.png`.
This bounded correction changes only `usage.ts`, `tests/commands/shuf/parity.test.ts`
and this evidence file. The candidate is frozen for root's independent approval;
no commit, integrated-gate or release success is claimed.

## Primary references

The official manual and pinned source were consulted, including web retrieval
of the GNU manual and `src/shuf.c` at tag `v9.7`:

- `https://www.gnu.org/software/coreutils/manual/html_node/shuf-invocation.html`
- `https://www.gnu.org/software/coreutils/manual/html_node/Random-sources.html`
- `https://raw.githubusercontent.com/coreutils/coreutils/v9.7/src/shuf.c`
- Official release archive:
  `https://ftp.gnu.org/gnu/coreutils/coreutils-9.7.tar.xz`
  (SHA256 `e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf`).

The live online manual is not version-pinned. Release behavior is checked
against the 9.7 source and native executable rather than inferred from a newer
manual. Bounded, recognized `.c` files from the supplied release tree were also
inspected: `src/shuf.c`, `lib/randint.c`, `lib/randperm.c`, and `lib/randread.c`.
Their measured hashes are retained with the initial oracle record.

## Option grammar

- `-e` / `--echo`: each operand is one record, including empty operands and
  operands containing delimiters. Owned byte-valued argv preserve invalid UTF-8.
- `-i LO-HI` / `--input-range=LO-HI`: inclusive unsigned decimal range. Endpoints
  may exceed JavaScript's safe-integer range. Leading ASCII whitespace and `+`
  are accepted where GNU's unsigned parser accepts them. Trailing whitespace,
  negative endpoints, invalid suffixes, and overflowing endpoints fail.
- `HI = LO - 1` denotes an empty range; larger reverse ranges fail. The full
  `0-18446744073709551615` range is rejected because its cardinality overflows
  GNU's 64-bit `size_t`; `0-18446744073709551614` is valid.
- `-n COUNT` / `--head-count=COUNT`: repeated counts take the minimum. A pure
  unsigned decimal overflow is ignored as GNU does, not converted to an unsafe
  JavaScript number. The effective maximum is `9223372036854775807`.
- `-o FILE` / `--output=FILE`: writes a VFS file; `-` is a literal filename here.
  Repeating the same filename is accepted; differing filenames fail.
- `--random-source=FILE`: random bytes come only from that VFS file. `-` is a
  literal filename, not stdin. Repeating an identical source is accepted;
  differing sources fail. Exhaustion is an error, never a fallback to system
  randomness.
- `-r` / `--repeat`: samples with replacement. Without `-n`, output continues
  cooperatively until cancellation, consumer closure, or the GNU count maximum.
  Empty repeat input fails unless the requested count is zero.
- `-z` / `--zero-terminated`: NUL-delimited records and NUL output terminators.
- Short clusters and attached values, unique long abbreviations, ambiguous
  abbreviation diagnostics, `--name=value`, `--`, missing operands, forbidden
  values on flags, and early `--help`/`--version` exits follow the pinned grammar.
- Options normally permute across operands. Presence of `POSIXLY_CORRECT` in
  the supplied virtual environment stops option parsing at the first operand.
  No ambient host environment is read by the command.

## Records, files, and random selection

LF is the default record delimiter. Empty input contains zero records; a final
delimiter does not add a phantom record. A nonempty unterminated final record
gets a terminator. NULs, invalid UTF-8, CRs, duplicate records, and empty records
are preserved byte-for-byte. Echo mode does not split embedded delimiters.

No operand or input operand `-` reads `context.stdin`. Named input, output, and
random sources use only `context.fs`, with the supplied signal. Relative paths
are joined to virtual cwd without lexically removing symlink/parent components
or trailing slashes. `-n0` skips opening/reading input. GNU's distinct random
source opening rules still apply: nonrepeat zero output does not open entropy,
whereas repeat zero output does.

Ordinary permutations and bounded samples use a sparse Fisher-Yates mapping.
A sample of `k` values from a huge range retains O(k) indices, not an array for
every number in the range. Values and random-integer arithmetic use `bigint`.
Nonrepeat selections are completed before opening/truncating output, so
`shuf -o FILE FILE` is safe within the admitted resource limits. Repeat output
opens its destination before selecting records, matching its distinct failure
and empty-input side effects.

For finite nonrepeat `-n`, unknown-size stdin uses reservoir sampling, as does
a regular VFS file larger than 8 MiB. Smaller regular files and unrestricted or
repeat input use full record collection. The reservoir's final EOF selection
and subsequent permutation consume the same entropy choices as GNU 9.7.
Regular-file stat size versus unknown pipe provenance therefore intentionally
can change deterministic output with the same entropy file.

The integer selector retains unused entropy, uses rejection of the incomplete
modulo interval, and reproduces the pinned 64-bit unsigned wrap behavior. It
does not use floating-point scaling or `Math.random`. Without an explicit
source, Node's `crypto.randomFillSync` supplies secure bytes. A system entropy
failure propagates; it never selects an insecure fallback. GNU's default
ISAAC buffering is not reproduced: default-random runs share uniform sampling
semantics, not a reproducible byte sequence. Explicit random-source tests check
exact output, rejection, exhaustion, and entropy reuse.

Writes are awaited. Repeat output is incremental rather than accumulated in an
array. Expensive sampling, record processing, empty-chunk streams, and repeated
output yield event-loop turns. Cancellation preserves the original reason,
including errno-shaped reasons, and waits for cooperative iterator cleanup.
Retained chunks are copied before a producer advances or finalizes.
File output uses the existing invocation-owned `openFileOutput` lifecycle.
Completed writes are not rolled back by cancellation. Acquisitions are tracked
before execution, closure waits for admitted opens, and eagerly owned iterators
are returned even when no random bytes were demanded. Local closure interrupts
pending reads without aborting the borrowed parent signal. Late sources
returned during reentrant closure are retired rather than leaked. Fallback
entropy loading is lazy, preserving repeat/output-alias truncation order.

## Diagnostics and status

Successful completion returns 0; usage, malformed values, empty repeat input,
entropy EOF, and supported filesystem failures return 1. A broken output pipe
returns 141 without a diagnostic, matching GNU's default SIGPIPE termination.
Caller cancellation is thrown to the shell runtime, not converted into a
utility failure. Unexpected host failures likewise retain their identity.

C-locale diagnostic quoting is byte-aware. Tests compare stderr hex in addition
to decoded text, including GNU's raw first byte for an invalid multibyte short
option. File arguments and invalid option values use their different GNU
quoting styles. Empty pathnames fail with ENOENT rather than resolving to cwd.
The measured Darwin libc `freopen("/", "w")` diagnostic is `File exists`, not
the VFS's EISDIR message; this profile-specific behavior was reconfirmed with
the clean-build oracle.

## Configuration and operational limits

`ShufCommandsOptions` has these options and no product environment variables:

| Option | Default | Meaning |
| --- | --- | --- |
| `replace` | `false` | Permit replacing a registered `shuf` when installing the plugin. |
| `maxInputBytes` | `67108864` | Maximum retained record payload, individual record size including terminators, fallback file load, or retained entropy chunk. |
| `maxSampleSize` | `1000000` | Maximum collected record count or nonrepeat permutation size. |

Numeric options must be positive safe integers. Resource-limit failures are
explicit status-1 extension diagnostics, not successful truncated results.
Reservoir sampling bounds retained records, not cumulative bytes scanned;
repeat count is not capped by `maxSampleSize`. The record reader may retain its
current record buffer alongside the collection/reservoir, and maps, record
objects, stream chunks, and caller-owned argv add overhead: these settings are
not process-RSS caps. Non-streaming record and entropy reads request `maxBytes`
before allocation. Oversized returned data and entropy chunks are rejected
before copying. Adapters must honor that contract: the command cannot prevent
a custom adapter from allocating internally despite the requested bound.
Streaming entropy requests chunks of at most 4096 bytes, further reduced for
smaller configured limits; the limit is not a cumulative entropy-consumption cap.

There is no independent output cap. Hosts should provide a bounded sink or
shell output budget when buffering results; infinite repeat requires
cancellation or a consumer that closes the stream.

## Evidence and remaining gaps

Tests live only in `packages/safe-bash/tests/commands/shuf`. Their VFS fixtures
are in memory. Native observations use pipe descriptors; no tests create host
files. Empty entropy uses native `/dev/null` and an empty VFS file at the same
path, avoiding the observed Darwin empty-socket reopen artifact. Native output
file observations use `/dev/fd/4` with a parent-side capture, not a disk file.
The oracle helper authenticates a bounded regular executable before launching
it, uses `LC_ALL=C` and `argv0=shuf`, and bounds runtime/output. Unavailable or
mismatched explicitly configured oracles fail. Absent external prerequisites
explicitly skip native cases rather than counting them as successful comparisons;
the acceptance run sets both prerequisite variables and has no native skips.

`SAFE_BASH_TEST_SHUF` and `SAFE_BASH_TEST_SHUF_SHA256` are test-only overrides
for an explicitly reviewed executable and its hash. They are never consulted
by the product command.

The suite includes grammar/error matrices; all non-NUL ASCII bytes in file
diagnostics; Unicode diagnostics; exact seeded echo/range/stdin permutations;
huge ranges above 2^53; regular-file and reservoir sampling; binary records;
same-file output; output failures and effects; entropy exhaustion; exhaustive
255 accepted one-byte values for unbiased three-way selection; rejection of
byte 255; secure-entropy failure; buffer reuse; sparse-sampling cancellation;
finite/infinite repeat cancellation; delayed cooperative cleanup; empty-chunk
streams; bounded fallback reads; closed/pending/late iterator admission;
VFS symlink traversal; direct definitions; and actual Shell pipelines, including
downstream closure of an infinite repeat.

Remaining qualification boundaries:

- The clean-build replay is scoped to this cohort, not all conceivable inputs;
  the original build record remains unqualified and must not be overwritten.
- GNU can attempt allocations beyond these explicit resource limits. Full
  unbounded permutations are not promised; huge-range bounded sampling is
  implemented and tested.
- Non-C locales and other hosts' libc diagnostic text are not this profile.
  Rare adapter-specific errno diagnostics and failures such as native close(2)
  errors are not independently qualified by this cohort. VFS-specific errno
  strings without a defined mapping remain identifiable but are not claimed
  byte-identical to every platform's strerror output.
- Native argv cannot contain NUL; the virtual owned-byte argv extension is not
  a native-NUL-argv parity claim. Record payloads do support NUL.
- Cancellation cannot forcibly stop uncooperative host callbacks or reverse
  completed external effects. This is not a host-JavaScript sandbox.
- Runtime/parity checks are not package-export, installed-consumer, whole-repo
  build, release, or poe-code CLI integration qualification. Integration remains
  root-owned; no default exposure is added here.

## Validation commands

From the repository root:

```sh
SAFE_BASH_TEST_SHUF=/tmp/safe-bash-scripting-oracles-20260904/coreutils-9.7-clean/src/shuf \
SAFE_BASH_TEST_SHUF_SHA256=cc33253093868fd2253de5561e980f879821e148ce43245350693fa6169375bc \
node --import tsx --test --test-concurrency=1 --test-reporter=spec packages/safe-bash/tests/commands/shuf/*.test.ts
node_modules/.bin/tsc -p packages/safe-bash/tests/commands/shuf/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --skipLibCheck --types node packages/safe-bash/src/commands/shuf/index.ts packages/safe-bash/tests/commands/shuf/parity.test.ts packages/safe-bash/tests/commands/shuf/lifecycle.test.ts packages/safe-bash/tests/commands/shuf/behavior.test.ts
```

The complete focused typecheck above passes, including the actual Shell source
graph. An earlier invocation reported the out-of-scope
`src/shell/conditional.ts:120` `FileType` versus `"character"` comparison; that
diagnostic no longer appears with the current shared graph. This assignment
did not edit that file or shared types. Root's guarded whole ESLint run reported
two owned findings: the record array's `prefer-const` and a throwing lazy test
producer's `require-yield`. Both were corrected without suppression, and the
focused runtime suite was rerun. Root owns the next whole-lint replay.

Help and ambiguous-option output were rendered with the repository's existing
`terminal-png` renderer and visually inspected as an in-memory PNG. Alignment
and complete diagnostic lines were checked; no screenshot files or screenshot
tests were created. No additional renderer dependency was installed.

TDD evidence starts with a missing-module failure before any implementation;
subsequent red/green iterations covered readFile-only adapters, exact error
quoting, zero/empty path semantics, delayed cleanup, SIGPIPE status, and VFS
path traversal. Root's safety review then produced seven failing bounded/lifecycle
cases, followed by three failing post-close/lazy-entropy cases; fixes passed the
expanded suite and clean-oracle replay. No commits or pushes were made.
