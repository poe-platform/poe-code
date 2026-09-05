# Optional extended read: experimental leaf contract

## Delivery boundary

This is an excluded, explicitly opt-in source leaf. Its
factory is `readExtension(options?: ReadExtensionOptions): ShellExtension`, exported with
`ReadExtensionOptions` from the local `src/optional.ts` entry. The explicit
`build:optional` route emits that entry; the default package still excludes the
entry and this implementation. This is not a published optional package export.
The factory
uses the canonical `commandRuntimeIdentity` and declares one ordinary builtin,
`read`, with `replace: true`. It does not register commands, change defaults, access host files, launch
host processes, or use ambient environment variables.

The frozen bridge now admits explicit replacement. Actual source Shell tests
install the unmodified factory and exercise `read`, `builtin read`, and
`command read`; removing the replacement flag still rejects the collision.
Earlier untimed integration tests retain their test-only `read_probe` alias and
remain distinct from these installation tests. Compiled public-host tests use
the actual `read` name through inline source and VFS `bash`/`sh` scripts. They
also cover default isolation, factory identity, explicit array composition,
retained descriptor aliases, device readiness and raw bytes. Local compiled
consumer evidence is not a packed or released artifact qualification.

Timed behavior now executes through the canonical borrowed cursor. Unknown
readiness produces an explicit diagnostic without consumption or assignment;
unknown provenance still refuses a positive timed read in the core primitive.
The leaf never simulates timing, turns unknown readiness into EOF, races an opaque
read against a local timer, inspects a source, or creates a separate cursor.
Owning-source construction and descriptor observation remain generic core
contracts, not private leaf adapters. Unenrolled external streams remain unknown;
the leaf never infers regular/pollable provenance itself.

## Implemented leaf behavior

- Ordinary REPLY/scalar assignment and `-a`, `-u`, `-r`, `-d`, `-n`, `-N`, `-t`.
  Attached arguments, grouped flags, `--`, repeated option processing, and the
  sticky exact-count behavior following `-N` are covered. The requested count
  and descriptor are admitted as nonnegative signed-32-bit decimal integers;
  leading/trailing C whitespace (SP/TAB/LF/CR/VT/FF) and a sign are accepted.
  This follows the primary GNU Bash 5.3 profile, not the historical 5.2
  trailing-whitespace rejection. Non-ASCII
  whitespace is not silently accepted through JavaScript's broader trim rules.
- Canonical owned `ShellValue` records and IFS values are used directly. Invalid
  UTF-8 fields remain distinct. Delimiters select the original first argument
  byte, including attached invalid UTF-8 arguments. No byte payload is rebuilt
  from replacement-character display strings.
- Except for exact-count and zero-timeout modes, the separator value is captured
  before borrowing input or awaiting input readiness. Replacing scalar IFS while
  input is pending does not change that invocation's field splitting. The generic
  binding getter retains raw values in the invocation allocation scope; this
  leaf adds neither a separate byte copy nor an unaccounted snapshot owner.
- Diagnostic operands retain their original `ShellValue`, including scalar/array
  names, invalid option bytes, and separated/attached numeric arguments. Attached
  byte arguments are sliced by byte offset; decoding is used only for validation
  and valid binding lookup. `concatShellValues` supplies the generic
  `diagnostic(ShellValue)` path, preserving its prefix, allocation/output budgets,
  awaited sink write, cancellation, and invocation cleanup. There is no private
  stderr bypass for operand diagnostics.
- Default REPLY retains leading/trailing whitespace. Named fields use the shared
  read record's escaped-byte-aware IFS splitting, including empty nonwhitespace
  fields and last-name remainder handling. Exact count disables IFS splitting.
  Ordinary NUL removal and backslash continuation remain the canonical input
  primitive's read semantics, not mapfile's raw-record truncation semantics.
- `-a` consumes the record, then validates/adopts/clears the target, including
  empty EOF. It uses the generic `bindings.openIndexed(name,
  { clear: true })`, then publishes each field with `set`. Exported scalar
  promotion now passes the source integration test. The earlier one-shot
  transaction implementation refused exported targets; that refusal is superseded,
  not a preserved supported profile. The shared API supplies indexed ownership
  and publication rather than private leaf array state.
- Readonly arrays preserve existing cells but consume the input record before
  reporting failure. Invalid array names are diagnosed after consumption; an
  invalid first scalar operand is diagnosed before consumption even with `-a`.
  Later scalar-name failures preserve preceding assignments. Readonly default
  REPLY and non-final scalar assignment return status 2; a readonly sole/final
  scalar or indexed target returns status 1. These distinctions follow the
  primary reference rather than globally mapping readonly failures to one code.
- `-u` validates each supplied descriptor in option order through the generic
  borrow API. Invalid earlier descriptors are not masked by a later `-u0`.
  Reads share cursor position with aliases and later reads. Releasing a borrow
  does not close the underlying descriptor. Unenrolled providers remain refused
  by core rather than gaining a private fallback cursor.
- Complete delimiter/count reads return zero. EOF still assigns partial input
  and returns one. Timeout assigns partial/empty scalar, REPLY, or indexed values
  and returns the qualified profile status 142; later assignment failure may
  replace it with status 1. Invalid options/missing option arguments return two with the
  measured Bash usage line; measured numeric/name/descriptor failures return one.

The recognized terminal-related `-E/-e/-s/-p/-i` options are refused by default,
except when explicit zero-timeout readiness bypasses terminal and assignment work.
The extension context offers no terminal/readline/echo-control capability.
An explicit trusted-host `readExtension({ nonTerminalInput: true })` declaration
asserts that every input descriptor used through that factory is nonterminal.
Only in that declared profile are these options ignored, matching native
nonterminal behavior. The declaration is captured at factory creation and does
not inspect a source, infer endpoint state from readiness, or grant input
deadline/provenance capabilities. Do not supply it for mixed or terminal inputs.
False/omitted declarations retain refusal; TTY editing, echo changes and prompts
remain unsupported. There is no host-terminal fallback or default mount/change.

TMOUT
supplies a positive default deadline only when no `-t` was supplied and count is
not zero. Invalid, converted negative, zero, or empty TMOUT disables that default, without turning
an ordinary read into a readiness query. Explicit `-t` overrides TMOUT, including
explicit zero; the last valid repeated `-t` wins, but an earlier invalid option
is not repaired by a later option. Fractional conversion retains six digits and
seventh-digit rounding: an explicit negative converted fraction is rejected,
while a negative fraction rounded to zero remains zero. Full help output,
arithmetic/subscript assignment destinations, terminal prompts/editing/signals,
arbitrary locale coverage, special variable attributes, and complete native
diagnostic precedence remain open. Do not present this list as full Bash read
coverage or reduce the original requested scope to these implemented cases.

Independent review also confirms that `read -a IFS` consumes the record but
fails at the shared control-binding restriction instead of publishing Bash's
indexed IFS value. Removing only that restriction would leave scalar-only IFS
consumers incorrect. Effective indexed IFS lookup, splitting/joining and scope
restoration require shared-runtime work; this remains a required behavior gap,
not an accepted parity exception.

Further pinned Bash5.3 controls expose corrupted joining bytes when IFS is
indexed. Native source inspection identifies a cached pointer to freed scalar
storage after read-array conversion, and raw array storage used by other IFS
cache refresh paths. These are source-backed apparent native defects, not a
sanitizer result or a portable deterministic contract. Neither element-zero nor
retained-scalar effective separators match all captured output. The twenty
bounded observations at `/tmp/read-ifs-native-IIjORg` remain separate from product
acceptance; selecting an effective indexed-IFS policy is unresolved. The scalar
separator timing repair does not select such a policy or admit indexed IFS.

## Resource and error ownership

Invocation cleanup is registered before input or indexed-writer acquisition.
The operation is stored in an explicit holder and started in a microtask after
registration, so synchronous early cleanup neither touches an uninitialized
binding nor admits input. Close blocks further leaf operations, waits for admitted
work, and closes the writer, releases the owned record, and releases all borrowed
inputs. Its completion is idempotent. A record returned after close started is
released without assigning its value.

The leaf uses shared input/value/array budgets; it does not introduce a separate
unbounded byte collector. Each writer operation is awaited. New assignments stop
after cancellation/close, but cancellation cannot undo already published fields.
Read failure, including false/zero/empty/undefined reasons, outranks subsequent
release failures. Root cancellation retains its exact reason and precedence.
All releases are attempted. Only an invocation-local symbol represents an already
successfully diagnosed bad descriptor; an arbitrary provider object with a
similarly named property cannot be mistaken for a status.

## Canonical timed-borrow dependency

The current frozen core bridge supplies this contract. The leaf consumes read
and readiness; raw record remains available to other consumers and is not used
as a substitute for read's byte/escape semantics:

```ts
interface ShellInputBorrow {
  readonly stdinIsDefault?: boolean;
  read(
    raw: boolean,
    options?: Pick<ReadLineOptions, "count" | "delimiter" | "exact" | "timeoutMs">
  ): Promise<ReadLine>;
  record(options?: RawRecordOptions): Promise<RawRecord>;
  readiness(): InputReadiness;
  release(): Promise<void>;
}
```

This supersedes the earlier optional-capability proposal. The implemented bridge
requires these methods and forwards/validates timeoutMs rather than discarding it.
The leaf requires the matching runtime identity and this bridge revision; merely
adding a TypeScript field to an older runtime is not a supported integration.

The existing internal `ShellInput` already has a cursor-owned clock, readiness,
positive `timeoutMs`, and `ReadLine.reason` values including timeout. The bridge
forwards through the same invocation admission/drain mechanism, with no byte-count
charge for the readiness query. It preserves descriptor aliases, pending pulls, partial owned
records, root cancellation, and deadlines that include queue wait. Regular-file
provenance ignores the timeout; unknown provenance must refuse. Do not infer
regular/stream provenance from a path or from `stdinIsDefault`.

For `-t0`, the leaf does not start a producer pull or call consuming `read`. Ready and EOF are
readable in the pinned native profile; blocked fails and unknown needs an explicit
unsupported diagnostic. Names and arrays must remain unchanged, including invalid
names, because the zero-timeout readiness check precedes assignment validation.
Positive timeouts assign partial values, preserve the subsequent unread input,
and return the selected reference timeout status unless a later assignment error
changes it. The current native Darwin profile measures 142; this is not
permission to synthesize a real OS signal or infer another host's signal table.

Runtime source construction also needs truthful enrollment of regular files,
pipes, and explicitly supplied input hosts. Exposing a method while all actual
sources retain unknown provenance would not complete `-t` integration. The leaf
must not access runtime-private state or attach its own replacement clock/poll.

Explicit `-t0` readiness precedes name/readonly checks and `-n0/-N0` assignment.
Positive deadlines and TMOUT are not forwarded for zero-count operations: those
assign/clear immediately without a producer pull or timer. Explicit `-u` errors
are diagnosed during option parsing even with `-t0`; closed implicit stdin causes
readiness failure without assignment/diagnostic. Closed zero-count input still
assigns empty and returns one, matching the measured native profile.

Replacement is authorized through the frozen bridge, not a core edit in this
leaf. Collision rejection remains the default when replace is omitted/false.

## Primary 5.3 references and migration boundary

The current target is GNU Bash 5.3.0 on the captured Darwin/C-locale profile.
The authenticated executable SHA256 is
`a0cfc1af0ff50f6b6e67c638979e2604f1c276c90116937fbaafcabb62ee2b40`.
`tests/shell/extensions/read/primary-reference.json` stores exact native argv,
input/control bytes, status, stdout and stderr. Its read-local helper pins the
artifact hash, validates the historical fixture archive, and refuses a changed
program, input or held-input protocol. Canonical tests consume frozen records;
they do not spawn a native process, require environment flags, or turn a missing
oracle into a pass. These tests are comparisons to captured native facts, not a
fresh native qualification. The shared trap oracle remains unchanged.

`historical-5.2-reference.json` preserves all 12 original read fixture files as
exact source bytes with hashes, the complete 313 original native observations,
the original 516-test/54-failure scope, and the failed initial 5.3 negative-TMOUT
witness. Neither that guard failure nor subsequent reruns are presented as an
accepted timeout result. Original audit data and all red attempts also remain
under `/tmp/read-dialect-audit.xYm3hI` and
`/tmp/read-primary53-candidate.2f7ZLp`.

Two fixture corrections are separate from leaf behavior changes:

- Source/native Unicode comparisons now explicitly agree on `LC_ALL=C`.
  Primary ANSI-C `\u00a0` expansion produces the ASCII escape spelling in that
  locale. Explicit UTF-8 byte arguments still produce byte-identical diagnostics;
  no diagnostic escaping or replacement-character reconstruction was added.
- The obsolete native fixture waited for a negative-TMOUT timeout before releasing
  input. Primary Bash disables that timeout, so the old fixture hit its guard.
  Its canonical replacement checks an authenticated bounded-release capture;
  actual Shell tests separately verify no deadline enrollment and retained input.
  The original failure/program remains archived, not executed as a hanging test.

Primary usage includes `-E`. Nonterminal cases use a native `[[ -t 0 ]]` guard
and exact unread-tail witnesses; actual Shell comparisons use owned byte input
and VFS files with the explicit nonterminal declaration. No FIFO or terminal
provenance is inferred from Node's stdio transport.

The descriptor-order cohort remains separately red: openness versus readable
borrowing, write-only zero-count assignment, readiness and descriptor deadlines
are not repaired by this migration. Primary EBADF read-error wording places the
descriptor before `read error`; changing frozen expected bytes does not repair
the underlying descriptor behavior. No full read or FD parity is claimed.

## Historical 5.2 profile and retained evidence (superseded)

The following profile, corrections and captured counts describe historical work.
The primary section above supersedes their active dialect and oracle policy;
the older observations and failures are retained rather than relabeled as 5.3.

Reference: GNU Bash 5.2.37, native Darwin executable, C locale, empty explicit
oracle environment except LC_ALL=C and a deliberately unusable PATH. Tests use
the existing authenticated helper in `tests/shell/extensions/trap/oracle.ts`.
No host executable is used by the product. Tests write no on-disk fixtures.

- Executable: `/tmp/safe-bash-scripting-oracles-20260904/bash-5.2.37/bash`
- SHA256: `f5b331844c67482075aea7883153127668cc67f83a60a7b4362cc8469a9dc77d`
- Local `builtins/read.def` SHA256:
  `77a8b2850af2b96f6dbfff101f49142b792c716a2228df292c372c15bbca5bb0`
- Local `lib/sh/uconvert.c` SHA256:
  `f4a4a38411f0a9944c8c9d3d0cae83bce96a976205abcea3e5796da6ca136873`

The official GNU Bash Builtins reference describes read's array clearing,
descriptor selection, timeout/partial-value handling, and zero-timeout readiness:
`https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html`.
That living manual is not a version-pinned executable oracle. Local authenticated
5.2.37 observations and the bounded local C sources qualify this profile.

The uconvert profile accepts empty/sign-only/dot-only zero spellings and converts
up to six fractional digits, rounding from a seventh digit and ignoring suffixes
after six digits. The sign applies only to the integer seconds, not the fractional
microseconds: `-0.1`, `-.1`, and `TMOUT=-0.02` therefore supply positive deadlines.
A negative nonzero integer part remains invalid. Rounding is unchanged:
`-0.0000005` becomes one microsecond, `-0.0000004` becomes zero, and `-0.9999999`
rounds to one second. Explicit rounded zero selects readiness; inherited rounded
zero disables the default timeout. Timeout seconds are accumulated exactly as nonnegative BigInt
through the signed-64-bit positive range, then converted to unsigned-32-bit seconds
as in the pinned profile. This corrects the earlier refusal above 4294967295:
4294967296 becomes zero (explicit readiness), while 4294967297 becomes one second.
Inputs beyond 9223372036854775807 are refused rather than imitating C signed
arithmetic overflow; those inputs remain outside this qualified numeric profile.

Native partial timeout uses an anonymous child stdin pipe: send a partial record,
keep the write side open, wait for Bash's result marker, then send the next line.
The case compares status 142, partial array bytes, and the next read; it does not
compare elapsed milliseconds. The child has a 2-second kill guard and 64-KiB
output bound. Authentication occurs before and after that asynchronous case.

Native prerequisites are explicit `SAFE_BASH_TEST_BASH` and
`SAFE_BASH_TEST_BASH_SHA256`. If both are absent, native cases have named skips.
If either is supplied, invalid/missing path, hash, or version fails rather than
silently skipping. Acceptance was run with both supplied and zero skips.

Initial TDD: 43 native assertions passed; the absent product import failed. A
minimal executable stub then produced 41 behavioral failures and one passing
registry-refusal case. The implemented untimed leaf passed all original 42 cases.
Subsequent retained regressions include:

- five failures for early readonly status, non-ASCII numeric whitespace, and
  signed/dot timeout lexical admission, followed by green fixes;
- four more timeout lexical-admission failures, followed by the source-grounded
  uconvert parser correction;
- exported-array promotion red (`1:<old><first second>` versus
  `0:<first><tail>`) before adopting the generic indexed writer;
- a lookalike-error red before switching to private symbol identity. The first
  test incorrectly expected Shell itself to expose a provider rejection instead
  of its diagnostic handling; the corrected direct-leaf observation reproduced
  the actual swallowed error before the fix;
- root's complete guarded lint13 prefer-const finding for the original work
  binding, corrected with a holder/microtask. All nine lifecycle tests pass,
  including a synchronous-cleanup TDZ regression. No post-fix full lint claim.

Pre-review focused acceptance: 124/124, zero skips (52 pinned-native cases, 63
source-leaf/actual-Shell characterization cases, nine lifecycle cases). Scoped
strict ES2023/NodeNext types pass. This is not a full build, public opt-in runtime
qualification, complete native parity, or a visual CLI qualification. At that
earlier milestone, runtime registration and timed execution were still blocked.

### Independent numeric-whitespace correction

Ohm's unchanged `tests/shell/extensions/read/review.test.ts` reproduced 64/77
passing, with 13 failures: trailing LF/CR/VT/FF in `-n/-N/-u`, including the
signed-count case ending in CR. The earlier parser incorrectly stripped all C
whitespace from both ends. The one-line correction restricts trailing stripping
to space/tab and leaves leading C-whitespace handling unchanged. No independent
assertions or captures were edited.

That corrected untimed leaf suite passed 201/201 with zero skips: the original 124
cases plus all 77 independent review cases. The independent capture remains at
`/tmp/safe-bash-scripting-oracles-20260904/read-independent-full.yWy5aV`.
Review test SHA256 before the fix and after acceptance:
`cea37883cd90b6bb94858164607afb910d1de537c3c88b5d7848a6ccb7c7a7c1`.
This corrects numeric parsing only; it does not qualify timed input or public
builtin replacement. The source and documentation were refrozen after that fix;
the six author-owned files and independently owned review test remain distinct.

### Timed bridge phase

Ohm's subsequent independent review reproduced seven failures before the
negative-fraction correction: five explicit grammar/zero-count cases and two
consuming-deadline cases (explicit and TMOUT). The complete read cohort was
387/394 with zero skips. The correction rejects a negative nonzero integer part
without rejecting the unsigned fractional part; the independent assertions and
their authenticated native captures remain unchanged. After correction, all
394 read cases pass with zero skips, and the scoped source/test typecheck passes.

The initial 44 new actual-Shell tests all failed on factory collision. Adding only
replace:true admitted all three dispatch routes but left 41 timed/assignment tests
red. Forwarding the canonical deadline/readiness operations fixed those behavioral
failures. Three closed-implicit-descriptor precedence cases were independently red
before the selection/empty-assignment correction. Five additional unsigned-timeout
conversion cases were red before the exact seconds parser correction, including
TMOUT's inherited one-second deadline.

`timed.test.ts` now contains 65 cases. Sixty-one use deterministic actual Shell
execution and core primitives; four additionally compare actual Shell results
directly against authenticated Bash. Tests construct an explicitly owned
ShellInput using a controlled producer and that producer's own truthful poll and
clock, then pass it as Shell.exec stdin. The normal Shell and extension borrow
bridge preserve that cursor; no leaf context/input methods are replaced. One
regular-file witness uses an actual memory-FS file stream with verified file
metadata and explicit owner construction, not an arbitrary stream relabeled as
a regular file. This does not qualify ordinary root-managed source enrollment.

Coverage includes readiness across ready/blocked/EOF and readonly/invalid targets;
scalar, array, REPLY, and invalid-UTF-8 partial timeout assignment; complete/partial
EOF versus timeout; repeated-option/TMOUT/count precedence; closed fd handling;
alias reuse of the exact pending pull; and falsey root cancellation. The canceled
test owner's close also correctly rejects with false; the fixture now asserts
that exact cleanup outcome instead of treating it as an unrelated hook failure.
Mocks explicitly implement the required bridge methods and reject unexpected raw
record/readiness use rather than casting incomplete objects to the new contract.

The frozen 66-case timed-native file is unchanged. Together with the original
author cases, all 255 author-owned tests pass with the pinned oracle and zero
skips. The full 332-case read run has 331 passing and one independently owned
phase-obsolete factory-rejection assertion failing in review.test.ts. That file
is not edited here: its owner needs to replace that assertion with the new
explicit-admission expectation and update its incomplete borrow mock typing.
All other 76 independent review cases pass. Scoped author source/test types passed
against the earlier bridge snapshot; the latest shared-tree compile is blocked
as described next. This is not a full build/public qualification or a completed
new independent review.

A later verification overlapped root's source-enrollment edits: 61 VFS cases
temporarily failed with Invocation-is-closed errors and runtime.ts had an input
owner Set type mismatch. Those findings were reported, not patched in the leaf;
the VFS runtime failures subsequently stopped reproducing. The latest scoped
compile still reports runtime.ts:2399:91: Set of generic closeable owners is not
assignable to Set<ShellInput>. That shared typing fix remains root-owned.
Once root's current source wiring
recognized VFS files, ten old refusal tests no longer had an unknown source.
Those tests now explicitly supply an unenrolled external async stream, preserving
the unknown-provenance/readiness refusal rather than denying truthful file
metadata. No fake source metadata or production workaround was added.

Owned files are `index.ts`, this document, and
`tests/shell/extensions/read/{cases.ts,native.test.ts,read.test.ts,lifecycle.test.ts,timed-native.test.ts,timed.test.ts}`.
Root owns exclusion/discovery/export edits. DD and its shared forwarding files
remain untouched; no commits, README changes, or host filesystem fallbacks.

## Raw diagnostic repair and remaining descriptor gap

The independently frozen `diagnostic-bytes.test.ts` cohort reproduced 4 passes
and 30 failures out of 34 before this repair. Status, assignment, and consumption
assertions already matched; all 30 failures were exact stderr bytes. Scalar and
array identifiers, `-u/-t/-n/-N` operands, attached/clustered options, repeated
arguments and distinct invalid bytes are covered. A separate author lifecycle
regression was also red before the repair: an invalid raw timeout diagnostic
replaced byte FF while a falsey diagnostic failure and cooperative input release
were being drained. The repair preserves that original failure and cleanup order.
Author fixtures now implement the required input methods and retain typed
diagnostic values instead of coercing them to strings. Independent tests are not
edited by the leaf author. Earlier source-enrollment/typecheck observations above
remain historical evidence, not descriptions of this repaired snapshot's gate.

After the repair, the unchanged byte-diagnostic cohort passes 34/34, and the
retained read directory passes 433/433 with zero skips, including the separately
owned reviewer mock migration. The author lifecycle regression verifies raw
diagnostic failure identity and drained input cleanup; two actual-Shell cases
verify the exact output-byte limit and rejection before a host stderr write.
Owned source/test roots pass using the package's actual strict options, and the
optional project passes `--noEmit`. The complete package source/test project
still reports 27 diagnostics outside the read scope, so the full package type
gate is not claimed green. No build was run for this bounded repair.

Descriptor admission, timing and zero-count behavior are deliberately unchanged.
In particular, `-u` still uses readable-only borrowing rather than the separately
approved `validateOpen`. An earlier open write-only descriptor therefore cannot
yet be replaced by a later readable `-u` as native Bash permits. Implementing only
that admission change would not finish the endpoint semantics below.

The read-only native sidecar preserved 160 authenticated Bash 5.2.37 observations
on Darwin arm64 in
`/tmp/safe-bash-scripting-oracles-20260904/read-writeonly-native-np0hXM`.
Exact scripts/statuses/stdout/stderr bytes are in `native-results.jsonl` (124
records, SHA256 `a5786da306c7b3d29e27ea0c3bb656a10f152bf803595624bef85bc5b3e4bf15`)
and `ordering-results.jsonl` (36 records, SHA256
`54d2e7e6966709bf1a6cb21eb6c0743c3ddcdf847a747ed5cce39ee2ba5deb1e`).
Regular-file witnesses are isolated ad-hoc QA, not canonical on-disk fixtures.

- `-t0` on write-only `/dev/null` and regular files returns zero without reading
  or assigning; on the qualified empty pipe with its reader held open it returns
  one, also without diagnostics or assignment. It precedes names, readonly checks,
  and zero-count assignment. Open-descriptor validation does not determine this
  readiness, and readable-only borrowing cannot expose it.
- Positive timeout/TMOUT on that write-only pipe returns 142 and assigns an empty
  scalar or clears an array; invalid/readonly assignment may instead return one.
  Write-only `/dev/null` and regular-file reads fail with a read-error diagnostic
  before assignment. Ordinary write-only reads fail before array/readonly
  assignment checks, while the first invalid scalar name is checked earlier.
- `-n0/-N0` on an open write-only descriptor returns one without a read-error
  diagnostic, but performs empty scalar/array assignment and its validation.
  Explicit zero-timeout readiness takes precedence over this behavior.

These distinctions require separately qualified descriptor-level readiness and
deadline semantics without granting read permission or inventing a cursor.
Opaque outputs remain unknown; the leaf must not treat every open write-only
endpoint as ready, every unreadable endpoint as closed, or this diagnostic repair
as full read compatibility. No such capability is added by this patch.
