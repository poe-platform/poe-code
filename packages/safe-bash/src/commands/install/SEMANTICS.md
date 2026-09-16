# Opt-in install semantics

## Status — September 4, 2026

Available through this directory's `index.ts`: `createInstallCommand`,
`createInstallCommands`, and `installCommands`. Registration and replacement are
explicit. This worker changes no shared contracts, root exports, default registry,
README, package configuration, build membership, or Git history. Root has been
notified of the four implementation files: `arguments.ts`, `index.ts`, `mode.ts`,
and `options.ts`; tests are `behavior.test.ts`, `grammar.test.ts`,
`safety.test.ts`, and `budget.test.ts`, with `helpers.ts`.
The independent reviewer added `review.test.ts`; this worker does not edit it.

Every factory-produced command carries `commandRuntimeIdentity` from
`contracts/command`, including plugin registration. The registry rejects a
different runtime identity, so source commands cannot silently register into a
compiled shell runtime. The guard has a first-failing regression test.

**Not full GNU parity, not accepted for release.** The entire GNU option grammar
is represented, but grammar coverage is not proof of every native effect.
Missing capabilities produce explicit failures, not native subprocess fallbacks.
Ownership, security contexts, atomic movement, and native metadata differences
below remain root integration/reviewer decisions. In particular, successful
unsupported-capability tests must not be counted as successful native operations.
Truncate is a separate frozen handoff; its outstanding audit is not closed here.

## Primary references and native profile

Researched GNU's official rolling manual and pinned 9.7 implementation, not a
third-party command summary:

- `https://www.gnu.org/software/coreutils/manual/html_node/install-invocation.html`
- `https://github.com/coreutils/coreutils/blob/v9.7/src/install.c`
- Release-local `lib/modechange.c`, `lib/mkdir-p.c`, `lib/dirchownmod.c`,
  `lib/backupfile.c`, and `src/copy.c` for mode, directory, and backup effects.

Root's clean reference is
`/tmp/safe-bash-scripting-oracles-20260904/coreutils-9.7-clean/src/ginstall`.
Independently hashed executable SHA-256:
`efd5c3373a8b3d8fdc4edc7c506bc1cc3ee215ed27fdd8eca151e70e8fa1893a`.
Root supplied source-tar SHA-256:
`e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf`.
No duplicate build was performed; the tarball hash was not independently checked.

Selected diagnostics profile: Darwin arm64, `LC_ALL=C`, UID 501, primary GID 20.
Temporary fixture files inherited GID 0 on this host, which matters for `-C` and
setgid behavior. The direct `ginstall` path with `argv0: "install"` still produced
`ginstall:` for some libc diagnostics. Manual runs therefore execute a unique
temporary symlink **named `install` to that exact binary**, also with
`argv0: "install"`. No diagnostic strings are normalized. Empty-destination
diagnostics were rechecked with twelve native invocations, including `-T`.

## Options and operands

- `-c` is accepted and ignored. `-d` creates directories and ancestors; `-D`
  creates destination parents before attempting the source. `-t` selects a target
  directory, and `-T` prevents implicit directory targeting. Multiple sources
  continue after individual errors; directory operands are not recursively copied.
- `-m` accepts octal and symbolic modes, including chained operators, permission
  copies, conditional `X`, and special bits. File calculation starts at zero,
  defaulting to 0755. Existing directories retain bits outside the requested
  change mask. Parents use 0755. Final directory creation uses the requested
  permissions, restricted while ownership or special bits are pending, and avoids
  unnecessary chmod/chown calls. The existing chmod parser was not reused because
  its initial-mode semantics and private interface do not match this operation.
- `-o` and `-g` first consult explicit account resolvers, then parse GNU-style
  unsigned base-zero numbers: C leading whitespace, optional plus, octal, and hex.
  The selected 32-bit UID/GID maximum is 4294967295; that sentinel means unchanged.
  Requested ownership precedes final chmod. Numeric IDs require no invented
  account database. Unknown names without a resolver report unsupported lookup.
- `-p` uses the opened source's pre-read access/modification times for regular
  copies when `fs.open` is available. Stripped and nonregular copies use the
  original install-level snapshot. Without `fs.open`, the path snapshot is a
  weaker fallback, not a guarantee of GNU's opened-source observation.
  `-C` compares regular type, bytes, mode, ownership, and, when requested
  and available, preserved contexts. It rejects combination with `-p` or `-s`.
  Non-permission bits prevent the compare optimization. Missing comparison
  identity is unsupported, not assumed to be root or zero.
- `-b`, `--backup[=CONTROL]`, and `-S` support simple, numbered, existing, and none,
  their GNU aliases, and unambiguous control prefixes. `-S` enables backups.
  `VERSION_CONTROL` and `SIMPLE_BACKUP_SUFFIX` are invocation environment values.
  Empty or slash-containing suffixes fall back to `~`; explicit empty does not
  restore the environment suffix. Numbered selection handles gaps with bigint
  arithmetic and ignores malformed names, including zero-prefixed versions.
- `-v` emits operation-order diagnostics; `--debug` adds the actual plain-copy
  strategy: no reflink, offload, or sparse detection. `-s` uses an explicit trusted
  stripping provider; `--strip-program` is a literal program identifier, never
  shell syntax. Without `-s`, it warns and is ignored. Nonzero strip status removes
  the newly installed destination while retaining backups. A thrown provider
  error also cleans up the destination and reports failure.
- `-Z`, `--context[=LABEL]`, and `--preserve-context` are profile-dependent.
  Explicit disabled profiles reproduce the selected GNU warnings and ignore
  context requests. Unknown profiles fail requested context work. Active profiles
  require trusted application/comparison hooks; preserve and set conflict.
- Short options cluster, required values attach or consume the next argument,
  long options accept unique abbreviations and equals values, and optional long
  values require equals. `--` terminates options; `-` is an ordinary path.
  Options normally permute past operands; presence of `POSIXLY_CORRECT`, including
  an empty value, stops at the first operand. Help/version act at parse position.
  Earlier parse errors are not suppressed by a later help option.

English help now matches the clean GNU 9.7 oracle exactly: 3374 bytes, SHA-256
`6749cf2986fbe67a358817c88c6bfa624cc1c7a476529d5ad6d5499e2ef65f2d`.
Version deliberately identifies safe-bash and its compatibility target rather
than falsely claiming GNU executable provenance, licensing, or authorship.
Owned raw bytes are retained in invalid-mode diagnostics, including attached
values. Other arbitrary non-UTF-8 operands, other locales, and Linux diagnostics
have not been qualified.

## Data, identity, and trusted capabilities

Sources are followed through symlinks. Destination symlinks are replaced, not
written through. Same directory entries are rejected; distinct hardlink names
may be replaced without altering the source inode. Files are published with
exclusive `wx` admission and temporary mode 0600 before metadata is applied.
Streaming copies own producer buffers before requesting another chunk. Source
cleanup is registered before acquisition, blocks further admission when closed,
and shares idempotent completion with finally. Cancellation is propagated.
Unknown identity fails destructive checks instead of inventing inode equivalence.
When canonical `fs.open` is available, source acquisition uses read/never-create,
checks the opened descriptor's identity against the path snapshot before reading,
and samples its metadata before consuming bytes. Cleanup closes the descriptor
exactly once, before retiring the iterator, including pending cooperative reads.
This consumes an existing optional contract; it does not supply missing adapter
implementations or an entry-bound destination transaction.

Simple backups use FS rename. Numbered backups use `renameExclusive` when supplied;
otherwise regular files can use exclusive hardlink creation plus identity checks
and unlink. This fallback is **not an atomic move**. Symlink numbered backups and
symlink unbackup need the trusted movement hook. Copy-open failure restores a
backup only without overwriting a newly appeared destination. Just-created
multi-source destinations are protected except with numbered backups.

`InstallCommandsOptions` contains:

- `replace`: explicit command-registration replacement, default false.
- `identity: { uid, gid }`: truthful invoking identity, used by compare. Absence is
  unknown, not an implicit UID/GID 0. Test helpers explicitly select memory UID/GID 0.
- `resolveUser` / `resolveGroup`: trusted name lookup, receiving command context.
- `chown(path, uid, gid, context)`: trusted ownership application; undefined
  components mean unchanged. It must actually update the host's ownership metadata.
- `setMode(request, context)`: trusted mode application. Exported
  `InstallModeRequest` supplies normalized VFS `path`, `mode`, and `kind`:
  `file`, `new-directory`, or `existing-directory`. The provider must operate on
  the same authorized backing entry and preserve actual errors and partial effects.
  It is not an implicit native fallback. Required native primitives are below.
- `strip(path, program, context)`: trusted transformation returning an exit status;
  zero must mean successful processing. No executable is launched by this module.
- `renameExclusive(source, destination, context)`: trusted atomic no-replace move,
  preserving entry identity, failing EEXIST without consuming either entry. A
  check-then-rename host implementation is not sufficient under concurrency.
- `securityContext: { enabled, apply?, matches? }`: explicit host policy and trusted
  label operations. These callbacks are not evidence of an actual SELinux adapter.
- `maxFileBytes`: nonnegative safe integer, default 32 MiB; bounds each source and
  fallback allocation. Preflight rejects known oversized files before replacement.
  This is an explicit implementation resource limit, **not a GNU limit**; root
  must approve the policy or supply the desired larger value/streaming contract.

## Required root integration and unresolved effects

1. Canonical filesystem ownership needs `chown(path, uid?, gid?, options)` and
   truthful stat/lstat UID/GID propagation through real, memory, mount, readonly,
   overlay, quota, and remote adapters. Caller UID/GID and account lookup belong
   to explicit host policy, not fabricated filesystem metadata. Current hooks are
   a transitional capability surface, not a claim that default adapters implement
   ownership. Ownership tests include a memory metadata map with actual resulting
   UID/GID checks, not just callback invocation counts.
2. Exclusive rename/no-replace and entry-bound operations are absent from the
   canonical contract. `wx` prevents overwriting a concurrent creator, but there
   is no held source/destination/parent descriptor spanning observation, backup,
   streaming, metadata, and cleanup. Link/unlink backup checks leave a race window.
   Simple backup replacement and strip cleanup are also path-based. No atomic
   transaction, race-proof backup recovery, or copy-up identity guarantee is claimed.
3. Six directory-emulation defects are fixed against Socrates's unchanged new
   review cases: `2700` and `7777` on new/existing directories, and `a+s`/`g+s`
   on existing directories. Searchable directories may lose only SGID after a
   successful setter, matching the native descriptor route; ordinary dropped
   bits still fail. The fresh uninstrumented rooted-real matrix is **108/114**,
   not full parity. Six strict-backend native failures remain: files with `2700`,
   `7777`, `a+s`, `g+s`, and new directories with `a+s`, `g+s`. These are not the
   six repaired native-success cases. Exact call evidence and the bounded
   integration proposal are below; no shared setter was modified here.
4. Active SELinux creation context, parent-directory labeling, policy lookup,
   default-context warnings, and post-copy application ordering are not fully
   modeled by a final-path callback. Disabled-profile warnings are qualified;
   active SELinux/SMACK native parity is not. The host must provide the security
   policy rather than report success from a no-op callback.
5. Earlier native `-p` differences remain preserved. The controlled follow-up
   below proves asynchronous fixture timestamp changes outside install: source
   atime advances even with no subprocess or content reads, and native's first
   source stat can already see that change. Native samples the opened source
   before reading; it does not preserve a post-read snapshot. The implementation
   already uses this canonical descriptor snapshot. No later-sampling workaround,
   clock substitution, artificial delay, or SafeFS change is justified here.
   A separate real-adapter fractional-millisecond loss through `Date` conversion
   is reproduced and proposed to root below. The responsible external reader or
   kernel mechanism is not identified, and uncontrolled metadata-exact parity
   remains unqualified. Precision, ctime, umask, inherited group, sparse allocation,
   ACLs, and special bits remain adapter-profile concerns.
6. The built real adapter rejects special nodes even though GNU can install from
   character devices such as `/dev/null`. Stream-capable VFS providers can supply
   these bytes explicitly; no implicit native device access is enabled. Unbounded
   devices and full native off_t/file-size range exceed the resource/number model.
7. Some provider-specific failure ordering, backup restoration failure diagnostics,
   strip-provider exception diagnostics versus GNU child-process diagnostics,
   compare-path ctime/security-context reapplication, and concurrent failures have
   not been exhaustively qualified. Unsupported tests are not native passes.

### Proven mode boundary and bounded capability proposal

The selected process is UID 501, primary GID 20, with no supplementary GID 0;
fixtures inherit GID 0. Tagged `install.c::change_attributes` skips ownership
changes when default IDs are -1; there is no missing default chown to invent.
Release `dirchownmod.c` chooses `fchmod` for an opened directory, `lchmod` for a
new unopened directory, and `chmod` for an existing unopened directory.

| Case | Actual GNU call on this host | Native outcome |
| --- | --- | --- |
| File special-mode failures | `fchmodat(dirfd, path, mode, 0)` | EPERM; leaves 0600 |
| Searchable directory, SGID requested | `fchmod(fd, mode)` | Success; may clear SGID |
| New directory `a+s` / `g+s` | `mkdir` leaves 0000; search-open fails EACCES; `lchmod(path, mode)` | EPERM; leaves 0000 |
| Existing unopened directory | `chmod(path, mode)` | Path primitive's actual result |

The search-open flags are `O_SEARCH | O_DIRECTORY | O_NOCTTY | O_NONBLOCK`, plus
`O_NOFOLLOW` for newly created directories (`savewd.c`). The command's `fs.access`
searchability probe reproduces the six reviewed successes, but is not a held
descriptor or proof against ACL/race/ownership changes.

A separate tiny C probe confirms `chmod`/`fchmod` succeed clearing SGID, whereas
`fchmodat`/`lchmod` fail EPERM without changing permissions in these fixtures.
Node `fs.promises.chmod`, `fs.promises.lchmod`, and `FileHandle.chmod` all succeeded
clearing SGID. Node's `lchmod` therefore does not supply the needed C primitive
on this profile. Successful calls may leave errno nonzero; raw errno alone is
not failure evidence. Postchecking, inventing EPERM, or rollback cannot recover
the strict primitive's original error and side effects honestly.

Root can supply the explicit `setMode` hook with genuine native primitives:
files use `fchmodat(..., 0)`; directories use the search-open flags above, then
`fchmod` if acquired, otherwise the new/existing `lchmod`/`chmod` distinction.
Preserve native errors, partial changes, authorized path binding, and cleanup.
The hook is implemented and memory-tested, **not backed by a shipped native
binding**. No Node built-in tested here closes the six strict-backend gaps.
An alternative canonical extension would expose strict `chmodAt` semantics plus
search-directory opening and descriptor `chmod`; ordinary `fs.chmod` must not
silently change meaning. Directory open-before-chown ordering would also need a
held handle across ownership/mode work for full race fidelity; the mode hook
alone is not that transaction. This is a concrete integration request, not a
decision to drop the six cases or count unsupported outcomes as parity.

### Timestamp causality follow-up

The minimal native fixture writes known bytes, sets access/modification times to
1000/2000 ms, takes metadata-only source/target snapshots, invokes authenticated
GNU, then snapshots **both** source and target before reading either file. A
separate after-read snapshot retains the observer's effects. There are no source
content reads between the reset and launch in the no-read profile.

- Eight no-read native runs: six targets had advanced atime, two retained 1000 ms;
  every target retained 2000 ms mtime. This reproduces the discrepancy without
  a before-source content capture. Eight intentional read-after-reset controls
  instead already show advanced source atime in the caller's before snapshot.
- No-operand `/usr/bin/true` changes the fixture source atime in all three fresh
  controls. More decisively, all three fresh no-process controls advance source
  atime during a 20 ms idle wait, without any content read or child launch.
  Therefore GNU's copy/read logic and harness content verification are not
  necessary for the observed source change. The specific external reader or
  filesystem mechanism is unknown; no antivirus/indexer attribution is made.
- Four unsettled native call traces show advanced atime at the **first path
  stat**, again at opened-source `fstat`, and in the requested `futimens` value.
  Four settled traces instead show 1000/2000 ms in both source snapshots and the
  setter request; source atime advances during reading while target stays at
  1000/2000 ms. This directly excludes post-read descriptor sampling as a fix.
- Paired tracing records canonical descriptor `stat` and target `utimes` requests
  without modifying them. In an unsettled case, the adapter requests and observes
  1000 ms immediately after setting target times, then target atime advances
  **before any verification read**. Thus target-side asynchronous changes also
  exist; merely changing final observation order cannot remove all discrepancies.
- A 500 ms settle interval **before resetting timestamps**, only in manual
  diagnostics, gives four paired trace cases retaining 1000/2000 ms in both tools.
  It is not a reliable isolation mechanism: the separate eight-pair uninstrumented
  group-profile run still contains two raw atime discrepancies. No sleep, retry,
  timestamp normalization, or synthetic success was added to product or unit tests.

Tagged `copy.c::copy_reg` takes the opened-source `fstat` before its first read,
checks inode identity, and uses that snapshot for regular `-p`. Tagged
`install_file_in_file` reapplies the initial install-level snapshot for strip or
nonregular sources. The existing owned implementation follows that distinction.
A new memory regression makes source atime advance during reading and verifies
that target keeps the pre-read values, with exactly one descriptor stat before
reads and one close. This is characterization of already-correct behavior, not a
claimed first-failing product fix. Old raw captures are not rewritten or globally
reclassified as harness errors; they lack isolation from the demonstrated effects.

Separately, direct metadata-only setter evidence shows `fs.utimes(1000.75, 2000.5)`
through the source real adapter produces 1000/2000 ms, whereas Node's native
numeric-seconds setter preserves 1000.75/2000.5 ms on the same fixture. The adapter
uses `new Date(atimeMs)`/`new Date(mtimeMs)`, clipping fractions before the syscall.
Root proposal: preserve supported fractional milliseconds in the real setter
instead of passing through `Date`, with an upstream regression and propagation
audit. Nanosecond-exact GNU timestamps would require a stronger representation
than numeric milliseconds. This worker changes no SafeFS code. This precision
gap is distinct from the large asynchronous atime jumps above.

### Ordinary-group qualification

A new real root is explicitly assigned the actual invoking UID 501/GID 20 before
creating fixtures; stat confirms that child entries inherit those real values.
With no ownership/mode callback, all **114/114** native/real mode cases match raw
output/status, final mode, UID/GID, and complete target bytes for files. This score
does not assert equal unrelated wall times, inode numbers, or directory sizes.
For `-Cv`, three matching-group pairs retain destination identity with no output;
three inherited-GID-0 pairs replace identity with the same verbose output and
bytes in both tools. Thus compare identity is truthful, not defaulted to root.

This ordinary profile does **not** erase the six nonmember-group kernel failures
from the earlier 108/114 strict profile, provide a native strict setter, or add
default chown capability. An initial manual attempt to chown a new fixture to
nonmember GID 0 failed EPERM during setup and is rejected as incomplete evidence;
the corrected replay uses actually inherited GID 0 entries, not fabricated IDs.

## Evidence and validation

All unit mutation fixtures use the in-memory VFS and never write disk fixtures.
The independent review has two explicit opt-in native help/getopt checks; these
spawn the authenticated oracle but do not mutate native fixtures. TDD included
first-failing tests for initial command behavior,
backup/duplicate-target diagnostics, empty operands, numeric identities, stream
cleanup, strip exceptions, backup replacement races, restrictive directory
creation, unretained file mode, backup/source hardlink distinctions, exact help,
opened-source timestamps/cleanup, and the injected mode setter. The prior complete
suite passed 108/108 with zero skips under the explicit clean native profile.
After the shared memory adapter build exposed `open`, stream-only mocks needed
an explicit `open: undefined` profile. Four owned failures were reproduced and
fixed in their fixtures; the fifth owned stream-admission fixture now explicitly
selects that same profile. The owned suite, including the new pre-read timestamp
characterization, passed **85/85**. Three analogous independent reviewer fixtures
at `review.test.ts` lines 85, 112, and 133 needed Socrates/root coordination;
this worker did not edit them or hide their failures. That historical run was
**106/109 passing, three failures, zero skips** with the native profile enabled.
Socrates subsequently corrected the stream-only profiles, and root accepted the
110-test reviewed baseline before the output-budget regression below. Without
the explicit native profile, the two native help/getopt checks skip, not pass.
Strict-setter memory tests are contract checks, not real-adapter parity evidence.

### Named-file Shell output budget follow-up

Root's frozen compiled public-consumer regression exposed a real bypass: direct
`fs.writeStream` and `fs.writeFile` calls could install four bytes despite
`maxOutputBytes: 2`. The separate 32 MiB source bound did not enroll destination
writes in the invocation-wide output ledger. Seven source-level failing budget
assertions reproduced this before the fix; an initial eighth failure was a quota
fixture declaring `append: false` despite restoring a working append operation,
and was corrected separately without changing product quota behavior.

Streaming copies now use the shared `openFileOutput` helper with
`{ flag: "wx", mode: 0o600 }`. Root/Schrodinger supplied the smallest shared
creation-options extension; this worker only consumes it. Buffered-only providers
use `assertCountedFileOutput` before destructive replacement and
`writeFileOutputCounted` around the awaited exclusive write. A successful
buffered write reports exactly its completed byte length. No stdout is emitted to
charge file bytes, and target descriptors are not required. Stream-only providers
still work without `open`, `writeFile`, or append support; a failed exclusive
stream cannot be retried through a potentially destructive buffered fallback.

`budget.test.ts` adds **19 passing in-memory/VFS tests** covering actual Shell
limits for memory, stream-only, and buffered providers; exact one-time charging;
the shared stdout/file and multiple-destination ledgers; empty files; exact
`wx`/0600 creation and final modes/timestamps; prefix retention; quota-backed
partial writes; cooperative cancellation; and source/target closure without
replay after an ENOSPC failure. The intermediate buffered-only fix left five
streaming regressions failing; shared-helper integration made them pass.

The initial source-inclusive budget-fix run was **129/129 passing, zero skips** with
the clean hash-authenticated GNU help/getopt oracle enabled. The strict
source-inclusive TypeScript command below also passes. Root must separately
rebuild opt-in compiled output and rerun the unchanged public regression, then
obtain independent review and guarded lint. These source results neither claim
that compiled validation happened nor close the six strict-native mode gaps or
the recorded external timestamp-mutation evidence. No shared files, frozen
public/reviewer assertions, native captures, or build configuration were changed
by this budget follow-up.

### Buffered cancellation ownership follow-up

Socrates subsequently reproduced a missing cleanup join: while the buffered
counted write itself awaited its underlying `writeFile`, install's registered
cleanup only drained the source. A Shell cancellation could therefore settle
before an already-admitted buffered writer finished. The frozen reviewer case
failed unchanged. Separate direct-execution controls established that execution
without a cleanup hook already waited correctly, but the registered cleanup
returned early; this distinction is not attributed to an unobserved adapter race.

Install now retains its counted buffered-write promise and joins it in the same
idempotent close used by both registered cleanup and `finally`. Closed admission
rejects a buffered callback before starting a new filesystem write. This does not
change exclusive `wx`/0600 creation, buffer contents, source cleanup, streaming
selection, or budget accounting. Caller cancellation still wins over writer and
cleanup failures, including the exact falsey reason `false`.

Two owned standalone cases plus the unchanged reviewer case progressed from
**1/3 passing, two failures** to **3/3 passing**. They gate the actual writer,
verify that cleanup/execution cannot settle while it borrows the original bytes,
and verify source identity/content preservation and absent cancelled output.
The complete source-inclusive install suite now passes **132/132, zero skips**
with the pinned clean GNU help/getopt checks enabled; strict source-inclusive
TypeScript passes. Compiled public validation and independent acceptance remain
root/Socrates responsibilities. No shared production files or reviewer assertions
were edited for this follow-up.

Socrates follow-up: eight reproduced VFS failures were fixed without modifying
the review tests: pending cooperative iterator cancellation, empty-chunk fairness,
primary-write versus cleanup precedence, dropped directory bits (new/existing),
zero-prefixed backup versions (existing/numbered), and owned raw mode bytes.
Cleanup reaches the underlying iterator's return directly, shares completion,
and uses cancellation-aware reads and scheduler checkpoints. Primary failures
survive cleanup errors; a cleanup-only error propagates after finally, while
cancellation takes precedence. No lint suppression or throw from finally remains.

With `SAFE_BASH_INSTALL_GNU_ORACLE` explicitly set to the clean reference, both
native getopt and exact-GNU-help reviews now pass. The previous custom-help
failure is retained as historical first-failing evidence at
`/tmp/safe-bash-scripting-oracles-20260904/install-review-native-1788561442-61211.log`.

The JSON files in `tests/commands/install/` are bounded **manual captures**, not
unit-test programs. Native mutations occurred only in unique, explicitly created
`/tmp/safe-bash-scripting-oracles-20260904/install-*` directories. Mutation fixture
trees were removed afterwards; diagnostic binaries and visual evidence remain
in their unique temporary evidence directories.
No native on-disk unit fixtures or duplicate coreutils build were added.

- `oracle-grammar-initial.json`: 201 exact raw process-output/status cases covering
  long-option prefixes, ambiguous/invalid options, missing values, mode syntax,
  conflicts, and backup controls. Final qualification re-executed all 201 exactly.
- `oracle-modes-initial.json`: 114 native/memory file, new-directory, and
  existing-directory cases; twelve real differences retained, not normalized.
- `oracle-effects-initial.json`: 44 cases with complete file hex, link contents,
  before/after modes, UID/GID, inode/device/link count, and timestamps. Checks are
  separated into raw output, byte/type/permission effects, identity retention,
  and preserved times. They are **not a full-metadata-exact score**. Raw symlink
  modes and UID/GID are different fixture policies and remain visible.
  Two compare differences are explained by native caller GID 20 versus inherited
  fixture GID 0, while the explicit memory profile uses 0/0. Numbered symlink
  movement is genuinely unsupported without a hook. Empty-destination diagnostic
  was corrected by TDD and freshly rechecked. Later atime auditing is separate.
- `oracle-modes-harness-error.json`: preserved invalid manual attempt: the async
  real filesystem factory was not awaited. Every real-adapter row in this file
  is rejected evidence. It is neither a product failure nor a parity pass.
- `oracle-modes-followup.json`: corrected, freshly executed native plus awaited
  rooted-real and memory profiles: 108/114 real and 102/114 memory exact pairs.
- `oracle-final-qualification.json`: fresh 201-case grammar replay, current raw
  results for all six real mode gaps, corrected empty-destination evidence, and
  SHA-256 bindings to earlier captures. Four regular-mode false successes now
  became honest unsupported errors; its two directory false successes were later
  addressed by the independent-review follow-up below.
- `oracle-backup-followup.json`: three fresh native/memory cases distinguish
  backing up onto the source entry from replacing a distinct hardlink name,
  and reject a directory backup destination. Raw output and complete final file
  bytes match in these cases after the first-failing regression tests were fixed.
- `oracle-review-followup.json`: historical 114-case real-adapter/native replay
  after over-strict directory postcondition enforcement: 102 exact, twelve
  discrepancies. Six were actual source defects, now repaired; preserve this
  capture rather than relabeling all twelve as missing capabilities.
- `oracle-atime-order.json`: nine synchronous native observations, with target
  stat before any target read, full bytes, and a separate post-read stat.
- `oracle-permission-calltrace.json`: fifteen native diagnostic runs (twelve mode,
  three timestamp), with actual permission/timestamp calls recorded on inherited
  fd 3 by an explicitly injected temporary tracing library. Instrumented evidence
  is separate from uninstrumented acceptance; the command never loads this library.
- `oracle-permission-primitives.json`: raw native C primitive versus three Node
  API results, including final mode/identity, probe hash, and Node version. The
  small diagnostic probe is not a duplicate GNU build or product capability.
- `oracle-source-fix-qualification.json`: current fresh uninstrumented clean GNU
  versus rooted-real replay without a mode hook: **108/114 exact** output/status
  and final-mode pairs. All six actual strict-backend failures remain visible.
  Also binds exact help bytes/hash. This is bounded evidence, not full-tool parity.
- `oracle-open-integration.json`: later direct current-source real-adapter replay
  (source hash recorded), again 108/114 exact mode pairs, plus six paired `-p`
  runs recording full bytes and metadata before/after target reads. The native
  atime gap persists with canonical `open`; no metadata-normalized pass is claimed.
  This is manual integration evidence, not unit disk-fixture execution or a shared
  maintained build. Earlier captures remain unchanged.
- `oracle-atime-controls.json`: 24 minimal before/after source-and-target cases,
  18 launch controls, and 36 idle/settling controls. Positive pre-read effects and
  no-read asynchronous changes remain separate, with all raw values preserved.
- `oracle-atime-sampling-trace.json`: four unsettled and four settled native
  traces plus six paired native/source-adapter traces. Instrumented diagnostic
  evidence demonstrates actual sample/setter ordering, not full-tool acceptance.
- `oracle-group-qualified.json`: current matched-primary-group 114-case mode
  replay with full metadata/bytes, eight paired timestamp cases (including two
  remaining observed discrepancies), and six `-Cv` identity comparisons. Also
  records the rejected nonmember-chown fixture attempt without counting it.
- `oracle-time-precision.json`: metadata-only fractional and integral timestamp
  setter controls, demonstrating the real adapter's `Date` clipping separately
  from native fixture interference. No SafeFS implementation was modified.

Validation commands (source-inclusive typecheck intentionally bypasses root's
opt-in default-build exclusions):

```sh
node --import tsx --test packages/safe-bash/tests/commands/install/*.test.ts
SAFE_BASH_INSTALL_GNU_ORACLE=/tmp/safe-bash-scripting-oracles-20260904/coreutils-9.7-clean/src/ginstall node --import tsx --test packages/safe-bash/tests/commands/install/*.test.ts
node_modules/.bin/tsc --noEmit --target ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --skipLibCheck packages/safe-bash/tests/commands/install/*.ts
```

Lint is run only by root through the maintained repository-root
`npm run lint:eslint` guarded route. Direct ESLint commands are not supported;
this worker does not run a competing lint invocation.

Historical ad-hoc visual output was rendered using the repository's terminal PNG
renderer and visually inspected at
`/tmp/safe-bash-scripting-oracles-20260904/install-visual-review.png`.
The current exact-help follow-up was separately rendered and inspected at
`/tmp/safe-bash-scripting-oracles-20260904/install-visual-review-gnu97-help-1788563272549.png`.
It shows complete GNU help, truthful version, verbose directory/copy output, and
a nonzero unsupported-strip diagnostic without clipping. Both were created
exclusively with no overwrite, outside the repository; neither is a test or
commit input.
