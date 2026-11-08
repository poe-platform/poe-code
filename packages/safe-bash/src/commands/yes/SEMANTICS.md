# Opt-in yes semantics

## Surface and registration

This leaf provides `createYesCommand(options) -> CommandDefinition`,
`createYesCommands(options) -> readonly CommandDefinition[]`, and
`yesCommands(options) -> VirtualShellPlugin`. The command and command array are
frozen; each factory call produces fresh values. The plugin registers only `yes`.
An existing registration is rejected unless the plugin receives `replace: true`.
Construction snapshots configuration. No default registry, root exports, package
exports, or build configuration are changed by this leaf. Public packaging and
test-inventory admission belong to the integration owner.

## Target and evidence

The behavioral target is GNU coreutils 9.7 `yes` with GNU/gnulib option parsing,
English C-locale output, and a literal invocation name `yes`. This is not a claim
of complete GNU/Linux equivalence, GNU binary identity, or locale coverage.

Official sources consulted on September 4, 2026:

- GNU manual: `https://www.gnu.org/software/coreutils/manual/html_node/yes-invocation.html`
- Release source: `https://raw.githubusercontent.com/coreutils/coreutils/v9.7/src/yes.c`
- Release buffer/error tests: `https://raw.githubusercontent.com/coreutils/coreutils/v9.7/tests/misc/yes.sh`
- GNU gnulib parser: `https://raw.githubusercontent.com/coreutils/gnulib/master/lib/long-options.c`
- GNU gnulib option processing: `https://raw.githubusercontent.com/coreutils/gnulib/master/lib/getopt.c`

The manual's description of lone help/version options is insufficient to specify
all inputs. Release `yes.c` calls `parse_gnu_standard_options_only` with scanning
enabled. That helper invokes `getopt_long` once; its first option either finishes
help/version processing or fails. GNU option processing supplies permutation,
unique long-name abbreviations, delimiter removal, and `POSIXLY_CORRECT` handling.
Those details, not the host's `/usr/bin/yes`, define the option tests.

Root supplied an official 9.7 tarball binding:
`e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf`.
Root's initial Darwin executable at
`/tmp/safe-bash-scripting-oracles-20260904/coreutils-9.7/src/yes` was independently
hashed with a bounded stream as
`1623e59c022035db7ece95fb10f8c22ab288d21d60f6ad861561b98e10c2b074`.
The executable reports GNU coreutils 9.7, but that alone does not qualify its
parser/library bindings. Its initial measured profile differed from GNU/gnulib:

| Arguments, C locale | GNU/gnulib target | Initial Darwin build observation |
| --- | --- | --- |
| `--` | repeat `y\n` | repeat `--\n` |
| `-- --` | repeat `--\n` | repeat `-- --\n` |
| `a -- --help` | repeat `a --help\n` | repeat `-- a --help\n` |
| `--bad` | single quotes in the option diagnostic | opening backtick |
| `-n` | quote the invalid option character | unquoted character |

These observations were not adopted as product behavior. The strict GNU native
suite reported 34 passes and 30 failures against that artifact rather than
relabeling mismatches as passes or normalizing diagnostics. Root subsequently
confirmed a reference-build defect: an initial targeted build compiled objects
before generated headers were ready; a later build with dependency tracking
disabled retained stale objects and mixed native/gnulib parser globals. The
initial binding and observations remain historical evidence, not a GNU profile.

Root rebuilt a fresh extracted tree with configure/default dependency tracking
followed by a single full make. The clean executable at
`/tmp/safe-bash-scripting-oracles-20260904/coreutils-9.7-clean/src/yes` was
independently hashed with a bounded stream as
`5326dd9df1374a85e4a2a0fddf27d7ae3315ba57a10866c2b27f71cb1878740f`.
It reports GNU coreutils 9.7 and agrees with the GNU/gnulib target, including
delimiter removal and exact C-locale option diagnostics. No product parser
change was necessary. This is GNU 9.7 built on Darwin, not a Linux-host run.

The separately measured Darwin `/usr/bin/yes` is BSD, not GNU: it repeats only
the first operand, treats `--` and `--version` literally, and ignores subsequent
operands even when the first is empty. Its oracle test compares shared
single-operand byte behavior and asserts these dialect differences explicitly.

## Arguments and terminal output

- No operands produces `y` and LF repeatedly. Otherwise join every operand with
  one ASCII space and terminate the record with LF. Empty operands are preserved;
  one empty operand produces LF, two produce space/LF. Embedded LF, backslashes,
  Unicode and non-UTF8 bytes are not interpreted or normalized.
- Raw arguments use the owned `CommandArguments` carrier by index. Different
  byte strings that decode to the same replacement text remain different. A
  mismatched carrier is rejected before any output, including help/version.
- A recognized `--` is removed; everything after it is literal. Operands before
  it keep their original order. `-- --help` repeats `--help`, not help text.
- In the normal profile, option scanning continues past operands. `text --help`
  displays help. The first option decides the result: `--help --bad` succeeds,
  but `--bad --help` fails. A single `-` is an operand.
- Nonempty unique prefixes such as `--h`, `--hel`, `--v`, and `--vers` work.
  Short `-h`/`-v` are invalid. Unknown options fail with status 1. An equals-value
  attached to help/version is rejected; `--=x` is ambiguous. Option diagnostics
  preserve raw argument bytes, including a single offending short-option byte.
- Presence of `POSIXLY_CORRECT` in `context.env`, even an empty value, stops
  scanning at the first operand. A later `--` then remains literal. No ambient
  process environment is read. No other product environment variables are used.
- Help is byte-for-byte the pinned GNU 9.7 English help with `argv[0] = yes`,
  including its documentation links. Tests declare the complete expected bytes
  independently and compare all successful help output, not just a prefix.
- **Explicit identity-only exception:** version output is exactly
  `yes (virtual-bash GNU-compatible profile)\n`. It does not impersonate the GNU
  executable's version, copyright, authorship, or licensing banner. Tests pin
  both complete native and complete virtual version outputs independently. No
  other successful stdout is exempted from byte comparison.

## Streaming, limits, and lifecycle

| Option | Default | Accepted values |
| --- | --- | --- |
| `maxRecordBytes` | 1048576 | integer 1 through 16777216 |
| `chunkBytes` | 16384 | integer 1 through 16777216 |
| plugin `replace` | false | boolean |

Explicit `undefined` uses defaults; null or nonnumeric byte limits are invalid.
The record admission check includes raw operand bytes, separators, and newline
before allocating the record or copying argument bytes. Oversize records fail
with status 1 and no stdout. A raw operand used in an option-error diagnostic
is also limited to `maxRecordBytes` before its byte copy. Diagnostic framing and
fixed help/version text do not count against the record limit.

There is one reusable record, optionally replaced by a batch of whole records
for small inputs. Each stdout write contains at most `chunkBytes`; a large
record is split across writes without introducing extra separators/newlines.
Views may share a record-sized backing buffer. Temporary argument copies and
small-record batching use bounded additional memory; this is not an RSS or
upstream argv-allocation guarantee. No output history or total-output cap is
maintained inside `yes`. Shell/sink output budgets still apply. Unconsumed
standalone `yes` is intentionally infinite, so supply cancellation or a bounded
consumer rather than collecting it indefinitely.

Every sink write is awaited. Output storage remains unchanged while borrowed,
and there is at most one write in flight. After each repeated stdout chunk, the
command yields through a timer so immediately resolving sinks cannot starve
timer cancellation. Cleanup is registered synchronously before timer admission;
the same idempotent cleanup closes future admission, clears the timer, and
settles a pending yield, and is called in `finally`. Cancellation preserves the
actual signal reason, including falsey values. Already completed writes cannot
be undone. Opaque uncooperative sink work cannot be forcibly stopped; the shared
`writeBytes` contract observes late rejection rather than leaking it.

EPIPE is propagated unchanged, without retries or diagnostics. The existing shell
maps pipeline EPIPE to status 141, corresponding to its SIGPIPE convention; a
successful final consumer still gives pipeline status 0 unless `pipefail` is
enabled. A direct caller receives the EPIPE rejection, not a manufactured
process result. Typed non-EPIPE output failures return status 1 with one
diagnostic; EIO, ENOSPC and EBADF use fixed English strerror text. Other typed
errors retain the virtual filesystem's description; arbitrary host exceptions
and shell limit failures propagate instead of being swallowed. Native ignored-
SIGPIPE behavior, errno/localized wording beyond those cases, signal delivery,
and GNU throughput are not claimed.

The command never reads stdin, accesses a filesystem, invokes another command,
or spawns a native process. Kernel argv cannot contain NUL; direct carrier values
containing NUL are outside native argv parity and are emitted as supplied when
used as operands. Aliased invocation names and translated help/diagnostics are
outside this fixed-name C-locale profile.

## Validation and integration handoff

Leaf-owned test files are `tests/commands/yes/yes.test.ts`,
`tests/commands/yes/native.test.ts`, and helper `tests/commands/yes/fixtures.ts`,
relative to the package. Root independently owns
`tests/commands/yes/integration.test.ts`; this leaf does not edit it.
All fixtures and captures are memory-only. Native execution is test-only:
`spawn` with pipe output, separate stdout/stderr caps, immediate kill at the
capture bound, a 2-second emergency kill, continued drain, and awaited `close`.
No unbounded `execFile`, shell pipeline, native temp files, or duplicate build is
used. Raw GNU argv is constructed in Bash and immediately `exec`s the selected
binary, so no shell child tree is left running.

From the repository root:

```sh
node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/yes/yes.test.ts packages/safe-bash/tests/commands/yes/native.test.ts
SAFE_BASH_YES_GNU_ORACLE=/tmp/safe-bash-scripting-oracles-20260904/coreutils-9.7-clean/src/yes node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/yes/native.test.ts
```

The GNU test is explicitly skipped if `SAFE_BASH_YES_GNU_ORACLE` is not supplied;
that skip is not a GNU pass. This variable is test-only. Test oracles fix C locale,
clear ambient environment, and exercise `POSIXLY_CORRECT` explicitly. Oracle
help/version uses `argv0: yes` so executable path spelling is not silently
normalized out of captured bytes.

TDD evidence: the initial suite failed with a missing `yes/index.js` module.
Later exact-help assertions failed before replacing the original abbreviated
help. Null-setting rejection and carrier-identity tests separately failed before
their fixes. Native comparisons exposed the BSD first-operand-only profile and
the initial GNU-on-Darwin parser divergence; neither was hidden by product
changes. Record-boundary, raw-byte, backpressure, pending/late-write cancellation,
cleanup, stable-buffer reuse, byte-pipe early return, and actual shell pipeline
tests are included.

September 4, 2026 clean-oracle verification: the author source/unit/native suite
passed all 132 tests with zero failures/skips. Including root's independently
owned `integration.test.ts` passed all 135 tests with zero failures/skips in
approximately 2.2 seconds. The native suite compares complete help bytes and
complete diagnostics; only the explicitly declared version-identity exception
remains. Root's actual help/error/pipeline screenshot at
`/tmp/safe-bash-scripting-oracles-20260904/yes-visual-review.png` was also inspected.

An earlier scoped no-emit TypeScript check had ten transitive diagnostics related
to then-evolving `FileStat` character-device declarations, with none in the yes
leaf. A fresh strict NodeNext no-emit check now reports zero diagnostics both for
the product entry and for the four author-owned TypeScript source/test roots with
their import closure. This is compiler typechecking, not merely esbuild; it is
still not a full package type/build gate. Root owns declaration/build/public-
export admission, canonical test-inventory updates, guarded lint, integration
checks, and any commit or release. The leaf is ready for a separate yes commit,
subject to those root-owned gates and the explicit identity/resource/host limits
described here. No commit, push, or release is performed by this leaf worker.

Root also passed the maintained source/test project check:
`node_modules/.bin/tsc --project packages/safe-bash/tests/commands/yes/tsconfig.json`.
This includes the independent integration test and emits no build artifacts.
