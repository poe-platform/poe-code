# Issue 678: GNU-compatible file resizing

## User baseline decision: September 9, 2026

The user now explicitly says to skip the macOS issue and select the most common
Linux behavior for truncate. Root selects the ordinary 64-bit Linux ext4
directory-seek profile, consistent with Debian's documented default filesystem.
This resolves the earlier ext4-versus-XFS baseline decision; it does not claim
that all Linux filesystems return the same directory end offset.

Implement the missing Memory retained end-seek from that profile's actual
kernel/oracle behavior, with failing tests first. Keep file inode pinning,
directory admission, cancellation, closed-handle errors and bounded allocation
intact. Do not substitute directory stat size or add a user-visible profile
option just to satisfy the tests. Preserve historical XFS evidence separately;
Real must continue to follow its actual underlying filesystem.

The existing honest virtual implementation version banner is not permission to
claim GNU authorship or version identity. Retain the visible identity difference
in the verification report rather than silently normalizing it or treating it
as a reason to stop the functional fix. No remote-write permission is inferred
from this filesystem decision.

### Implemented ext4 retained end-seek

Memory read and resize handles now obtain regular-file ends from the retained
inode's current byte length. Admitted directory handles return the Linux64
indexed-ext4 htree EOF, `9223372036854775807n`, rather than directory stat size.
The six-line implementation preserves existing acquisition guards and the
shared cancellation/closed-handle checks, without allocating the represented
file length or reacquiring a pathname. The contract documents the selected
virtual profile and excludes claims about XFS or non-indexed/32-bit ext4.

The new memory-only retained-seek suite records 39 failures and 12 passes before
the fix, then all 51 passes. Existing handle-key and missing-seek assertions are
updated to require the new exact behavior while retaining admission, inode,
metadata, ledger and invalid-operation assertions. All 13 neighboring retained
filesystem test files pass 1,646 cases. Evidence is in
`/tmp/issue-678-memory-ext4-{red-approved,green-v2}.log` and
`/tmp/issue-678-memory-retained-neighbors-v2.log`; the intermediate obsolete
assertion failures remain preserved.

Independent review finds no actionable defect in the selected profile. Its
separate current-source control checks directory/read/write end-seeking through
scope and quota wrappers, one charge per seek, falsey cancellation, cleanup,
and refusal of writer growth beyond quota. The command and successful output
are retained in the review tool record, not a separate receipt file.

The normal workspace/root build succeeds. An actual browser-worker run saves
the unchanged comparison input as a virtual shell script and executes it with
`sh`. Empty/populated directory references and existing/new targets produce
exactly the native ext4 ASCII stdout: 41 bytes, no displayed stderr, and exit 0.
The native fixture's mount type is explicitly checked as ext4. The screenshot
is visually inspected; comparison inputs, native bytes, ARIA, PNG and the
bounded comparison receipt are in `out/issue-678-ext4-profile/`. The task-owned
browser is closed and verified absent, and its Vite server is stopped.

These are focused checks, not a completed full-root gate, package-publication
receipt, version-banner parity, or universal Linux filesystem claim.

### Command candidate and ext4 regressions

The pending truncate implementation and registration now have the selected
directory baseline available through the real Memory retained-handle route.
The public ext4 suite records 68 native GNU 8.30 cases across empty/populated
references and existing/new targets, covering bounded modifiers, overflow,
creation and diagnostic effects. Its 74 tests include quota refusal/recovery
and cleanup controls. The initial public-bundle run records 61 failures and
13 passes; after rebuilding the fixed source, all 74 pass. That red binds the
old public bundle; the separate 51-test TDD receipt binds the source change.

The native capture explicitly uses umask 022. The first ambient-umask-002
capture is preserved separately, not normalized into the accepted profile.
The executable SHA-256 remains
`72577f960652d3abb3f3a61b807b061fe433f0deaa8edec1f9230087806e299c`.
Captures are `/tmp/truncate-ext4-bounded-v2-cGt43s/snapshot.json` and the
preserved `/tmp/truncate-ext4-bounded-v1-loxkDh/snapshot.json`.

The existing truncate suite passes 1,571 tests and registration passes six.
One old actual-Memory directory expectation fails first, then changes to require
the exact ext4 INT64_MAX/EFBIG diagnostic, target-open/close effects, preserved
bytes and no huge resize dispatch; all 54 directory-admission tests then pass.
Unsupported custom-backend checks remain unchanged. These individual receipts
are under `/tmp/truncate-ext4-handoff-sTH994/`; the combined process-wrapper
receipt reports four files, not an additional independent case denominator.

The command, public/plugin inventory, nested invocation and Playground fixtures
are delivered together locally. The honest version identity still differs from
GNU and remains explicitly outside exact oracle passes. Full maintained gates
and remote delivery are not established by this candidate checkpoint.

### Retained-fixture type corrections

The neighboring strict fixture compilation also exposes five diagnostics in
four earlier retained-filesystem test files. The fixes preserve intentional
incomplete/undefined inputs through an explicit unknown boundary and own-property
construction, and annotate the mutable byte fixture as `Uint8Array`. No production
types, compiler settings, negative assertions or error handling are weakened.
The same compiler invocation changes from five errors to exit 0, and all 13
neighbor files still pass 1,646 tests. This focused compiler route already uses
`skipLibCheck`; it validates the named fixtures, not library declarations.
Evidence: `/tmp/issue-678-memory-retained-neighbors-types-v2.log`,
`/tmp/issue-678-memory-retained-neighbors-types-v3.log`, and
`/tmp/issue-678-memory-retained-neighbors-v3.log`.

### Final maintained gates at the committed candidate

At `7adeeb39333d9c41804990172d11350a44378be3`, the complete uncached `npm test`
route succeeds, including native npm pre/post hooks, required build dependencies
and all 40 declared logical unit stages across 71 workspaces. The shared phase
passes 22,358 tests with one skip; Python passes 29; runner checks pass 302;
Bash passes 26,736 with 63 skips; SafeJS passes 21,653 with 37 skips;
terminal-pilot passes 288; and posttest lint stress passes two. Missing declared
workspace tasks and skipped tests are not credited as passes. No optional unit
profile or selector is synthesized, and repository-local hook variables are
cleared only inside the unit child environment.

The repository `npm run lint` route also succeeds: guarded ESLint checks all
10,477 configured inputs with zero errors/warnings, followed by root TypeScript
and workflow lint. The maintained Bash typecheck succeeds for source/tests and
26 current consumer groups, retaining the three expected negative exits and
not counting four held evidence inputs as runtime passes.

Bun's required `bun test` runner separately passes all 74 ext4 command cases.
The first `bun run` invocation fails before testing because that launcher cannot
execute `node:test`; its failure is preserved rather than counted as a product
test or silently replaced. The corrected runner is bounded to 30 seconds.

All final receipts are under `out/issue-678-ext4-profile/`. Before/after tracked
worktree status is clean, HEAD remains the tested candidate, and the Memory,
truncate and new public-ext4-test source hashes match at both gate boundaries.
The local functional fix and integration gates are complete. The latest
read-only release observation remains the successful external run `34378014482`
for `70388ee3`; it does not deliver these local commits. No push or issue closure
is performed, and the explicit version-identity/profile limits remain visible.

## Root implementation decision: September 9, 2026

- Add `preferredIoBlockSize`, `OpenResizeFileOptions`, `FileResizeHandle`,
  `openResizeFile` and affirmative `retainedResize` as the narrow contracts
  described in the preparation below. This is a root implementation decision,
  not a claim of a separate user approval or completed backend support.
- Memory's explicit virtual preferred-transfer policy is 4,096 bytes, matching
  its existing Node-stat bridge profile. Do not infer 64 KiB from a stream chunk
  default, or claim any virtual policy is a native physical observation. Real
  uses valid native metadata; unavailable observations stay unavailable.
- Retain write authority from acquisition. In particular, native descriptor
  resizing does not recheck a later chmod as if opening the pathname again.
  Preserve open-before-calculation effects and namespace replacement behavior.
- Root owns types, admission helpers/tests, authoritative contract docs and the
  safe-bash type re-export. Separate workers will own Memory, Real, and composed
  wrappers/quota. No backend may advertise support before its complete guarded
  resource route exists. No command registration or closure is implied.
- Initial TDD receipt `/tmp/kamilio-678-resize-admission-red.log` reports 19
  failing controls: the readonly view lacks explicit denial and the retained
  resize admission APIs do not exist. These are missing-feature failures,
  not native-parity passes or evidence of implemented resizing.
- Admission helpers now pass all 19 controls, including interruption of opaque
  metadata, draining a late acquired resource, selected-path readonly denial
  and exact falsey failures. The neighboring capability suite passes 31 checks
  combined; scoped strict TypeScript also exits 0. Receipts use
  `/tmp/kamilio-678-resize-admission-{green,neighbours,types}`. Backend support,
  quota composition and the utility itself are not established by these gates.
- Two additional bounded GNU controls establish a null-device target gap:
  open succeeds, then ftruncate fails with EINVAL and the attempted byte size
  in the diagnostic. `/tmp/issue-678-composition-device-native-confirmed.json`
  retains the clean controls; the sandbox instrumentation failure is separate.
  Root expands the retained protocol to explicitly supported nonregular targets
  and selects the virtual null device's 4,096-byte preferred-I/O hint. The
  composition owner will replace early device denial with a pinned null handle
  and native-equivalent truncate failure through TDD. This closes a validated
  target-phase gap; it does not solve or waive nonregular reference seek behavior.

## Confirmed scope and original-source reading

- Issue 678 remains open and is authored by kamilio. Required behavior includes
  exact sizes, relative/minimum/maximum/multiple modifiers, reference files,
  I/O-block units, bounded growth charged to VFS quotas, cancellation and
  VFS-only paths. Preserve the preceding utilities' atomic delivery order.
- On September 9, 2026, root read all 399 lines of GNU coreutils 8.30
  `src/truncate.c`, plus `lib/stat-size.h`, from the already authenticated archive
  `/tmp/fmt-675-coreutils-8.30.tar.xz`. Utility source SHA-256:
  `2c56bcf96be1e78deea35b74292c31ad18411dc44edda09a7844297d1770f099`.
- Current public `Shell` execution of `truncate -s0 /probe` returns status 127,
  empty stdout and `shell: line 1: truncate: command not found\n`. No product
  implementation or registration has been added at this checkpoint.

## Source-derived requirements

- Preserve option validation and diagnostic order, including repeated size
  settings, whitespace, source-supported binary/decimal suffixes, signed off_t
  bounds, zero-divisor rejection and reference/size combinations. Inspect the
  original integer-parsing and quoting helpers before implementing these paths.
- Native opens each target for writing before computing and applying its new
  size. Missing targets may be created even when a later per-file calculation
  fails. `--no-create` suppresses only the relevant ENOENT open failure; other
  failures remain observable and later targets still run.
- Reference size is resolved once before target processing. Relative sizes use
  that reference where specified; absolute reference-only behavior differs from
  per-target current-size calculation. Preserve zero clamping and extension/
  rounding overflow checks.
- `--io-blocks` uses the target's preferred I/O block size, not the allocation
  block size or the reference's block size. The current FileStat contract exposes
  neither preferred I/O block size nor a writable retained handle. Investigate
  truthful metadata/handle support before choosing an implementation; do not
  silently hardcode one host profile or claim descriptor race parity from
  separately resolved path operations.
- Existing optional `FileSystem.truncate` and the quota wrapper are relevant;
  the wrapper checks the logical target size before invoking truncate. Preserve
  quota enforcement even for sparse growth. Refuse unsupported operations rather
  than bypassing wrappers, materializing unbounded zeros, truncating through an
  implicit host path, or replacing an existing inode with an unrelated file.

## Verification and delivery

- TDD with static native byte/status/filesystem-effect captures and in-memory
  maintained tests. External native experiments use isolated owned fixtures.
- Independently compare every modifier, prefix/suffix/overflow edge, target
  error continuation, reference behavior, hardlink/symlink effects and quota
  admission. Cover actual Shell/VFS workflows, cooperative cleanup, falsey
  failures, no late mutation and opaque metadata cancellation boundaries.
- Root owns later registration, independent literal inventories, public
  consumers, screenshot validation and atomic delivery. No README additions,
  unrelated edits, broad staging, push, issue closure or release are authorized
  by this preparation document. Existing external-write approval remains pending.

## Read-only sidecar findings: September 9, 2026

### Read and evidence scope

- The preparation worker read all **399 lines** of the original GNU 8.30
  `truncate.c`; its SHA-256 matches the root's value above. Also read
  `stat-size.h`, `xdectoint.c/.h`, the `usable_st_size` definition in `system.h`,
  and the relevant ftruncate portability implementation. The original xstrtol
  parsing and gnulib quoting paths were already read from this same authenticated
  archive for numfmt. No GNU implementation code was copied into product files.
- References and experiments are under `/tmp/truncate-678-sidecar-reference`.
  **Only this plan changed in the repository.** No product/test/snapshot file,
  numfmt edit, registration/inventory edit, build/lint/test gate, Git operation,
  remote mutation, or delegation was performed for this preparation.
- `native-controls-direct.json` contains **37 bounded native controls** with raw
  stdout/stderr hex, exit status and file effects. Tool: `/usr/bin/truncate`,
  GNU coreutils 8.30, `argv[0]=truncate`, `LC_ALL=C`, ignored stdin, 3,000 ms
  per-process timeout, uid 150124. Executable SHA-256:
  `72577f960652d3abb3f3a61b807b061fe433f0deaa8edec1f9230087806e299c`.
  These are preparation observations, not a maintained suite or implementation
  parity result. The first shell-mediated capture was contaminated by shell
  startup diagnostics/locale changes; `native-controls.json` and
  `native-controls-initial.txt` remain preserved, not normalized or counted as
  clean controls. Direct execution avoids that shell and does not read stdin.

### Source details that affect implementation

- **Repeated `-s` is stateful, not simply last-size-wins.** `rel_mode` is not
  reset on a later plain size. With a six-byte target, `-s+1 -s2` produces eight
  bytes; `-s'<1' -s2` produces two. `-s+1 -s+2` reports multiple relative
  modifiers. `-s/2 -s0` still reports division by zero. Preserve this explicit
  source behavior instead of using a generic stateless option-value reducer.
- Strip source-defined whitespace before the modifier and again before parsing
  its value, but not trailing whitespace. `xdectoimax` accepts signed off_t
  bounds and suffix set `EgGkKmMPtTYZ0`: e.g. K is 1024, KB is 1000, KiB is
  1024; an implicit K is accepted. The b/c/w and multiplication forms are not
  accepted. Numeric errors use capitalized `Invalid number` and locale quoting;
  path errors use gnulib `quoteaf` shell-escape quoting. Do not reuse numfmt's
  different unit grammar or locale-only quoting for filenames.
- After option parsing, validation order is: size/reference required;
  reference plus explicit size must be relative; `--io-blocks` requires explicit
  size; file operand required; then resolve reference. Native controls verify
  missing operands beat a missing-reference stat error, while an invalid
  reference prevents any target creation.
- Reference is resolved **once**, even when it is also a target or appears as
  repeated target operands. With reference size seven, `-r reference -s+2`
  sets both existing and newly created targets to nine, not current-target-plus-
  two. Reference-only uses the captured size directly and does not require a
  target fstat. Relative operations without a reference do require target fstat.
- Target order is open-write-with-optional-create, then fstat when necessary,
  block multiplication/size calculation, ftruncate, then close. Native uses
  O_WRONLY/O_NONBLOCK, **not O_TRUNC and not O_APPEND**. It checks write access
  even for a same-size result and does not require reading target contents.
  A missing target remains created at size zero when later block-multiplication
  or reference-relative extension overflows; both effects were captured.
- `--no-create` suppresses an **open ENOENT**, including missing parents and a
  dangling symlink's absent referent in this profile; it does not mean lstat-
  exists. Without `-c`, a dangling symlink creates its referent. A missing path
  ending in slash can have different open errors with and without O_CREAT.
  Do not preflight existence with lstat or drop trailing slashes. `-` is a
  literal filename, not stdin. Later targets continue after per-target errors;
  failed close has its own diagnostic and contributes exit status one.
- `/` and `%` are floor/ceil to a positive multiple; `<` and `>` are maximum
  and minimum bounds, respectively. Relative negative results clamp to zero.
  Block multiplication, positive extension and rounding-up overflow have
  distinct per-target diagnostics. Parse/calculate with BigInt, not Number;
  convert only after checking the actual VFS size domain. Do not confuse a
  valid 64-bit GNU size that exceeds an adapter limit with a parse overflow.
- `--io-blocks` uses **the opened target's** preferred I/O block size, including
  when a reference supplies the base length. Zero block count still follows the
  source fstat path. `ST_BLKSIZE` accepts a positive native st_blksize within
  its native size_t bound, otherwise uses that build's DEV_BSIZE; neither
  `allocatedBytes`, st_blocks' 512-byte units, read chunk size, nor a guessed
  universal 4096 is a replacement. The native fixture reported 4096; that is
  a measured profile value, not a portable default.
- `usable_st_size` does not accept directory/character sizes just because a
  stat has a number: other kinds use open/lseek(SEEK_END). In this host's
  directory-reference control that returned OFF_T_MAX, then target creation
  preceded an EFBIG resize failure. Another filesystem may fail the seek.
  Treating every directory reference as size zero or a universal EISDIR would
  be invented behavior. Non-regular reference semantics remain an explicit
  contract gap; do not mark them supported from FileStat.size alone.

### Actual VFS findings

| Current surface | What it establishes / does not establish |
| --- | --- |
| `packages/safe-fs/src/contracts/filesystem.ts:6` | FileStat has numeric size and optional allocatedBytes/identity. No preferred-I/O-block observation exists. Size is number, not a 64-bit integer carrier. |
| `packages/safe-fs/src/contracts/filesystem.ts:70` | FileReadHandle has stat/read/close only. No retained writable or resize handle, and no generic seek-end contract. |
| `packages/safe-fs/src/contracts/filesystem.ts:148` | Optional path-based truncate accepts number and FsOptions. The truncate capability does not promise descriptor identity, sparse storage, atomic lookup-plus-resize or target creation. |
| `packages/safe-fs/src/fs/memory/index.ts:663` | Resolves an existing file, checks write permission, allocates the complete new size, preserves the FileNode/inode, copies the prefix and updates timestamps. Hardlink aliases and existing retained readers see the same changed node. No missing-file creation. |
| `packages/safe-fs/src/fs/real/index.ts:476` | Confined path resolution, O_WRONLY/O_NOFOLLOW/O_NONBLOCK open, regular-file check, native handle.truncate, finally close. Preserves the opened inode for this call and permits native sparse growth, but exposes no handle to join the command's preceding stat/calculation to this open. It validates safe-integer sizes and does not create missing files. |
| `packages/safe-fs/src/fs/overlay/index.ts:836` | Stages a clone and renames it over the path, bounded by maxBufferBytes. Clone explicitly refuses multiple/unknown hardlink identity where required; a single-link resize still replaces the inode. This is not inode-preserving truncate parity. |
| `packages/safe-fs/src/fs/s3/filesystem.ts:810` | Conditional object replacement, bounded by maxReadBytes, with dense new-body allocation; no retained inode/native sparse promise. Missing target is ENOENT. |
| `packages/safe-fs/src/fs/webdav/webdav.ts:1171` | truncate is explicitly unsupported. A callable optional method alone is insufficient capability evidence. |
| `packages/safe-fs/src/fs/quota/index.ts:139` | Queues admission based on the logical target length before calling the wrapped path truncate. Do not unwrap it or replace its policy with a command-local byte counter. |
| `packages/safe-bash/src/contracts/filesystem-output.ts:38` | FileOutput is sink/signal/finish/abort, not retained stat/resize. Its w/a opening behavior cannot model non-truncating writable open with optional no-create; descriptorWriteStream is not a resize-handle capability. |

- `vfs-observations-corrected.json` records ad-hoc **in-memory** observations:
  Memory hardlink shrink changed file, alias and retained reader sizes from six
  to two without replacing inode 2. After pathname replacement, its retained
  reader still described the old node; path truncate affected the replacement.
  The only handle methods were stat/read/close.
- Overlay refused hardlink resize with `ENOTSUP: copy-up cannot preserve hardlink
  identity`. For a single-link upper file, resize changed inode 3/size six into
  inode 6/size two; an already retained reader still reported inode 3/size six.
  The first ad-hoc probe stopped at the hardlink refusal; its empty
  `vfs-observations.json` remains preserved. The corrected capture records that
  refusal rather than assuming aliases were silently corrupted. No adapter
  changes are proposed as already implemented or validated by this observation.

### Quota and logical sparse growth

- Memory already has separate logical and retained-storage limits: defaults
  maxFileBytes=16 MiB, maxRetainedBytes=64 MiB, maxMetadataUnits=10,000
  (`packages/safe-fs/src/contracts/memory-limits.md`). Dense truncate reserves
  its new buffer **before releasing the old one**, so replacement peaks matter
  even for shrink/same-size operations. Do not release accounting early, raise
  configured limits, or emulate unbounded zero allocation in the command.
  The small-limit observation rejected growth past maxFileBytes with EFBIG and
  left contents/size unchanged.
- The existing quota is logical **namespace** accounting, not allocated blocks
  or unique inodes: every visible hardlink entry counts; symlink storage counts.
  Before existing-file growth, known aliases and unknown possible aliases are
  charged the positive delta. A six-byte file plus hardlink under a 20-byte
  quota rejected resizing either link to eleven, leaving both at six.
  Sparse native growth must still charge this logical size; zero st_blocks is
  not free quota. Shrink credit remains conservative and single-entry.
- Census limits (4,096 entries / depth 64 by default) also apply to shrink.
  The queue covers its admitted write-like operations, not arbitrary external
  writers; namespace mutation/independent-wrapper races are not a storage lease.
  The existing quota contract explicitly documents incomplete absent-file
  creation accounting through multiple alias mounts. Truncate creation must not
  silently inherit that gap and claim comprehensive composed-quota protection.
- No sparse-Memory redesign is necessary merely to expose its existing bounded
  resize behavior. However, **logical-only large sparse growth in Memory is not
  available today**: size derives from node.data length. If that is required
  beyond current dense limits, it needs a backing-store representation change
  under the existing logical/retained ledgers, not a command workaround. Real
  can remain natively sparse within its admitted numeric/quota domain. This is
  an explicit implementation decision/gap, not a silently dropped requirement.

### Minimum API work to approve before command implementation

1. **Truthful preferred-I/O-block metadata.** Add a narrowly defined optional
   observation to the authoritative safe-fs FileStat contract (name not selected
   here), source it from validated native Stats.blksize for Real/path and retained
   observations, and preserve it in explicit stat-copy helpers in Mount,
   Overlay and ReadOnly. Memory/S3/WebDAV must not claim a native value they do
   not have. A documented virtual-backend preferred-block policy would require
   an explicit contract decision. Missing observation cannot silently become a
   host-profile constant; it is a remaining `--io-blocks` support gap.
2. **One retained writable-resize acquisition.** The missing operation must open
   existing files without truncating/appending, optionally create missing
   referents, require write rather than read permission, and return stat/resize/
   close bound to that same opened object. These are required semantics, not
   currently available API/capability names. Reusing openReadFile, appendFile
   with empty bytes, writeFile(w), or stat(path)+truncate(path) cannot provide
   them. Same-object resize must survive rename/unlink/replacement without
   touching the new pathname occupant. Reject unsupported backends explicitly;
   do not advertise the full utility until required support is supplied.
3. **Wrapper-safe mutation ownership.** Positive support must be path-specific
   and truthful, with ReadOnly denial, Mount/device routing, metered operation
   admission (`fs/scoped.ts`), and explicit Quota wrapping. The quota proxy's
   generic method fallback must not leak a new raw write handle. Handle resize
   needs the quota queue and logical admission for the pinned object's identity,
   not a later stat of its stale opening pathname. Avoid stale shrink credit
   and account visible/unknown aliases conservatively. Creation must remain
   separately visible if a later resize fails, subject to admitted metadata/
   quota policy. Overlay's copy-up and S3's replacement limitations are blockers
   to assuming this promise from their existing truncate method.
4. **Bounded lifecycle, not metadata deadlocks.** Follow the existing retained-
   reader close contract: register cleanup before acquisition, close admission
   synchronously, drain admitted cooperative acquisition/mutation and one shared
   idempotent close, reject later operations, preserve original falsey failures
   and caller cancellation. Close late-acquired resources after cancellation.
   Do not wait forever on opaque pre-acquisition capability/stat promises. Native
   dispatched syscalls/external writers cannot be magically rolled back; qualify
   the guarantee rather than promising impossible universal late-effect absence.
5. **Numeric and special-reference boundary.** GNU parsing is signed 64-bit;
   current VFS resize arguments are safe-integer numbers. Choose an explicit
   bounded failure for a calculated value outside that domain, at the correct
   post-open phase, or separately approve a larger integer contract. Never round
   the value through Number. Resolve non-regular reference seek behavior with
   an honest contract/profile; neither directory stat.size nor a retained-reader
   method supplies it today.

### Bounded next implementation sequence

- First agree the two missing contract surfaces and wrapper admission above;
  this is not a request to redesign all filesystem APIs. Keep numeric/parser
  logic in the command and resource/storage policy in safe-fs. No backend- or
  provider-name branching, implicit host path fallback, inode-replacement
  emulation, or new generic transaction framework is needed.
- Add red tests from these native controls plus edge cohorts for modifier state,
  off_t and block overflow, no-create and symlinks, captured-once references,
  same-size timestamps/write-only permissions and per-target close failures.
  Add in-memory handle/race tests for rename/unlink/replacement, quota through
  aliases/wrappers, late acquisition and close, and falsey failures. Read-fault
  or unavailable-capability cases must not be counted as GNU passes.
- Only then wire per-target execution as open -> required handle metadata ->
  BigInt calculation -> admitted same-handle resize -> close, preserving native
  diagnostic and effect ordering. Keep command raw-byte/path admission, work
  budgets, portable no-Buffer execution and parent cancellation consistent with
  the preceding utilities. Root owns later public integration and independent
  stress qualification; no implementation readiness/full-parity claim is made
  by this preparation alone.

## Implementation review checkpoint: September 9, 2026

- The retained-resize and preferred-I/O contracts now have uncommitted Memory,
  Real, composition and quota implementations. Memory and the virtual null
  device deliberately report a virtual 4096-byte preferred-I/O policy; Real
  preserves only a valid native observation. These are not interchangeable
  physical-storage claims. Default Shell device composition permits the null
  target protocol; quota outside Devices conservatively refuses nonregular
  retained handles instead of bypassing accounting.
- Root reproduced three reentrant capability/acquisition-getter cancellation
  defects before fixing admission in `fs/capabilities.ts`. Its focused group
  passed 34 checks. An independent replay passed 72/72 on helper SHA-256
  `632f752377df10026c692279cadb35cf355add30435731f135810734355fed3c`.
  One probe now selects the actual post-query getter boundary rather than the
  obsolete third lookup; the other 71 are unchanged. Original 70/72 evidence
  remains in `/tmp/retained-resize-independent-20260909.json`; the new receipt
  is `/tmp/retained-resize-independent-20260909-root632-recovered-v2.json`.
- Root also reproduced two opaque quota-census cancellation barriers before
  the quota owner corrected them. Namespace `readdir`/`lstat` promises are
  interruptible with late rejection observation; acquired handle operations
  and retirement still drain. The unchanged root regressions, quota tests and
  admission-helper tests passed 105/105 in
  `/tmp/kamilio-678-quota-integration-green-v2.log` (exit 0). This source-level
  integration result is not a complete workspace or public-consumer gate.
- Exact native comparison found a remaining creation-enabled trailing-slash
  error mismatch: `/dev/null/` reports EISDIR natively, but direct Device,
  helper, scoped and Mount paths reported ENOTDIR. The eight-route observation
  retains four passes and four mismatches in
  `/tmp/issue-678-null-path-review.json`. A Device-only error mapping cannot
  fix capability-query and Mount resolution boundaries. Preserve traversal
  authorization and distinguish final separators from intermediate components;
  no blanket ENOTDIR conversion or capability bypass is authorized.
- Original `truncate.c` and `stat-size.h` were reread completely during root
  review. Nonregular references and relative targets require a retained
  SEEK_END observation, not `stat.size`. The current command explicitly refuses
  that unsupported observation; this remains a compatibility gap, not a pass.
  Creation-mode/umask effects are also part of the raw comparison contract.
- Temporary storage exhaustion interrupted some follow-up checks before launch.
  Only this task's completed artifact tree was moved, with approval, from
  `/var/tmp/poe-code-674-artifact.P0MUaM` to
  `/home/kjopek/poe-code-artifacts/poe-code-674-artifact.P0MUaM`; its detached Git
  worktree link was repaired and remained clean. Historical artifact receipts
  retain their original paths/profile. The completed clean build, full lint,
  full uncached unit run and installed-consumer confirmation on `fd72e1df2`
  qualify the preceding five local commits, not this uncommitted issue-678
  implementation. Remote mutation approval is still pending.

### Follow-up boundary and runtime validation

- A third root regression established an already-canceled acquisition after a
  post-census opener getter. The first red demanded a later getter lookup;
  the corrected red explicitly permits an earlier captured callable and still
  reproduces the actual canceled dispatch. Both receipts remain under
  `/tmp/kamilio-678-quota-reentrant-red-v1.log` and `-v2.log`. The quota fix uses
  the captured opener with the original filesystem receiver after a final
  cancellation check. Its root-three/owned/neighbor group passed 173/173 and
  scoped strict types passed. Quota source SHA-256 is
  `7909cb138e50a6992c14009fdeee71b59a7655e11c5248aa3d5610cd42c7a489`.
- The preceding SafeFS integration run passed 1963/1963 across 67 files after
  loopback permission was approved. Its first sandbox run retained three EPERM
  listener failures and an unhandled listener error. These runs predate the
  third root regression and final opener-capture fix; they are not a gate for
  those later bytes. Receipts: `/tmp/kamilio-678-fs-integration-v1.log` and
  `/tmp/kamilio-678-fs-integration-v2.log`.
- SafeFS-only development builds update its declarations and workspace files,
  but the root public `poe-code/safe-fs/core` import uses a bundle under SafeJS
  dist. Five of seven command Shell checks correctly exposed that stale facade;
  neither those failures nor the unavailable new method were normalized away.
  A full maintained `npm run build` completed successfully, including the root
  bundle stages, in `/tmp/kamilio-678-public-development-build-v2.log` (exit 0).
  Its first attempt failed on the sandbox's readonly `/var/tmp` policy, with
  the original receipt preserved. This is a development prerequisite refresh,
  not frozen final qualification; command public replay follows separately.
- The current parser cohort records 333 exact native matches and seven
  deliberately different virtual-version identities out of 340. Existing
  nonregular seek and nonzero-umask creation differences are expressly not
  native passes, even where maintained characterization assertions pass.
  Resolve the configured virtual mode policy through existing public metadata
  options rather than provider-name branching, a silent mode-0644 patch, or
  changing unrelated Memory creation behavior.

### Explicit open-intent correction

- After the root runtime rebuild, the original seven public Shell composition/
  lifecycle cases passed 7/7 in
  `out/issue-678-tmp/public-shell-after-root-v2.log` (exit 0). The first replay's
  selector covered only six lifecycle cases; that narrower receipt remains
  separate. The temporary filesystem filled again, so subsequent source-test
  scratch and receipts moved to the workspace filesystem with approval. No
  other task's files were deleted and native oracle fixture profiles were not
  silently relocated.
- Independent path review recorded 160 native utility/open observations and
  768 VFS API comparisons: 700 matched, 68 differed. A separate 32-case
  error-only Memory prototype matched its observations, but is not production
  qualification. Twelve additional expanded-symlink controls expose why an
  original-operand suffix check is insufficient. Immutable raw results and
  before/after source hashes are in
  `/tmp/issue-678-trailing-review-jVmnOx/resumed/matrix-v1.json` and its sibling
  receipts. Mount's bare dangling-create failure is a distinct boundary.
- The selected contract adds `CapabilityQueryOptions.create`: omission retains
  generic resolution, explicit false/true selects writable-open resolution.
  The root admission helper now supplies false for default no-create acquisition
  and checks cancellation after reading that intent. Root regressions reproduced
  two failures out of 26 before the correction; the helper/quota/root group then
  passed 121/121. Receipts are under `out/issue-678-tmp/creation-intent-*`.
  The first attempted patch did not apply because shell heredoc temporary
  creation hit ENOSPC; its 22 old-test passes are not red-test evidence.
- Backend resolution implementation is delegated separately: preserve separator
  provenance, parent search checks, explicit dot/dotdot behavior and mount
  confinement; return only an error from the early terminal-separator branch,
  never parent-derived positive capabilities. The ReadOnly policy view retains
  unconditional mutation denial, explicitly distinct from native readonly-mount
  error ordering. No new all-path compatibility claim is made by the root
  intent/helper tests or the earlier runtime build.
- Nonregular end-position feasibility remains unresolved. There is no validated
  portable Node/Bun retained seek implementation in this work. An optional
  retained-handle protocol was considered but not authorized or implemented;
  neither stat size nor a fabricated directory offset is an acceptable fallback.

### Registration and independent review, September 9, 2026

- Register `truncate` through the existing metadata family, forwarding its
  public umask and argument/output/entry limits. Default command membership is
  87, or 88 with one custom command. Historical frozen inventories remain
  unchanged; current-profile adapters explicitly add this command. Root
  registration, workflow and inventory controls passed 64/64 before the later
  support-declaration regression was added. Receipts are under
  `out/issue-678-tmp/registration-*` and `custom-inventory-red-v1.log`.
- The missing resize/mutation requirement reproduced a false supported result
  for an unknown-capability filesystem. Declaring `retainedResize` and mutation
  intent fixed that result without blocking help/version execution. The command
  owner reports 1450/1450 owned and registration controls, including unsupported
  and readonly help/version cases. Source SHA-256 at that point is
  `99ba23dc3440daee5ef28291a1710f7f47299c078bb652225a9bf66ec1a07eb5`;
  receipts are `out/issue-678-tmp/command-owner-20260909-v1/support-*-v1.log`.
- Mode controls explicitly cover configured umask 027, preservation of existing
  mode 0620, and creation at 0640. The command owner's 64 native comparisons
  matched under the recorded explicit-umask profile; three additional modeled
  host-mask controls are not new native captures. Real backends may additionally
  apply host umask/ACLs. Installed-consumer fixtures now cover direct, env, xargs,
  script/reference, null-device, retained-identity and quota workflows, but have
  not yet run against rebuilt candidate packages.
- Updated three superseded Memory create-with-terminal-separator expectations
  to the recorded native EISDIR outcome, and added distinct no-create controls
  preserving ENOTDIR/ENOENT. The helper/Memory/path/composition integration group
  passed 1055/1055 (`out/issue-678-tmp/path-integration-green-v1.log`). The owned
  768 native-derived matrix assertions reuse recorded expectations, not fresh
  utility executions. Nested Device-over-Mount absolute dangling aliases still
  have a validated boundary discrepancy under active correction.
- Fresh Real backend captures found seven mismatches across 18 cases, including
  a permission bypass: `blocked/../file` and its symlink alias truncated the
  existing inode despite the unsearchable `blocked` directory. GNU/open rejected
  EACCES and preserved its bytes. Other cases expose terminal-separator ordering.
  Native profile: GNU 8.30, LC_ALL=C, uid/gid 150124, umask 022, filesystem device
  66305. Evidence is in `out/issue-678-tmp/real-path-review/`; this invalidates any
  all-path claim based only on earlier mocked Real tests. Fixes are in progress.
- Independent lifecycle replay on command SHA-256 `97a0dc15ac75b737e3b6931318501aa9e5a59455d34e7001ccb817daf945c988`
  reproduced all five direct getter-abort dispatch defects (4/9 passed), while
  56/56 direct controls passed. Corrected Shell fixtures yielded 55/58 and
  isolation 7/11; three failures in each involve the older generated Device
  facade. The fourth isolation assertion incorrectly required disposal to repeat
  a command-owned close failure; its narrowly corrected replay passed while
  retaining exact null cancellation, both settlement barriers and one close.
  Diagnosed and secondary close-error leak assertions now pass unchanged.
  Invalid Memory string fixtures and wrong diagnostic-prefix expectations are
  separately recorded, never normalized in actual output. Manifest:
  `out/issue-678-tmp/lifecycle-root-review/replay-manifest-v1.json`.
- Those replay drivers catch assertions and can exit zero with failed cases;
  use their recorded case outcomes, not process status alone. Their generated
  facade predates current path/query-intent edits. The five direct command
  defects are assigned for maintained TDD; no final public, full-suite, or
  one-to-one parity claim follows from these partial development checks.

### Follow-up fixes and replay

- Command getter regressions reproduced 21 failures among 37 focused controls
  before correction. Captured callbacks now receive their original receiver
  only after a post-lookup cancellation check. Owned plus registration controls
  passed 1481/1481. Independent unchanged original drivers then passed 9/9 and
  56/56, including all five previously failing getter phases. Command source
  remained `ddba020494939ad861aa6cc8ca4a02838edfa952f015b1160c799cb14d98eae6`.
  Receipts: `command-owner-20260909-v1/getter-*` and
  `lifecycle-root-review/getter-fixed-*-v2.json` under the existing scratch root.
  The typecheck still sees old generated declarations lacking query intent;
  this is not a passing current type gate and requires the normal root rebuild.
- Real resolver correction preserves directory search checks before explicit
  dot/dotdot collapse and before create-with-terminal-separator rejection.
  Maintained TDD reproduced 12 failures, then the owned suite passed 103/103.
  Root independently ran four Real/allocation test files: 159/159 passed.
  Fresh unchanged native comparison drivers report 16/16 and 2/2 matched
  backend outcomes and selected effects at Real source SHA-256
  `f0df2066dec945f3fcc0d10aa87c9385a25423ff58224f54e004fd6fe3adf303`.
  Source hashes were unchanged across both runs. New captures are
  `real-path-review/native-api-20260909-Oat3xE/receipt.json` and
  `real-path-review/dotdot-20260909-Lj9x4G/receipt.json` under the scratch root.
  Their GNU raw bytes/statuses are retained; these direct Real API comparisons
  do not establish a rebuilt Shell-command comparison or atomic race protection.
- The broader inventory run exposed three stale assertions: default/custom
  portable counts and the inspection-family positional slice after metadata
  insertion. Exact expectations were corrected, not derived from actual output.
  Direct suites passed 42/42 and 21/21. The repeated 16-file integration command
  passed all 16 reported file-level results; that runner output does not expose
  individual case counts. Receipts: `*-inventory-direct-{red,green}-v1.log`
  and `inventory-integration-v{1,2}.log` under the scratch root.
- The maintained browser-bundle test now executes the actual new public
  truncate consumer fixture, including metadata modes, nested invocation,
  binary effects, null-device errors, retained identity and quota refusal:
  9/9 bundle tests passed (`browser-truncate-integration-v2.log`). This uses
  source-built in-memory bundles, not installed tarballs. The earlier combined
  browser/playground run had 71 passes and two stale-dist inventory failures;
  those playground checks remain pending the normal root rebuild.
- Four maintained namespace regressions independently show that Device over
  Mount interprets mounted absolute link targets in the wrong root, including
  an ordinary mounted `/dev/null` and a relative escape toward global null.
  Root approved a narrowly scoped internal symbol-keyed namespace projection,
  with original backend acquisition still authoritative. Implementation and
  wrapper/cancellation validation are pending; no public type or capability
  extension is authorized by that decision.
- Read-only remote checks now observe external main at
  `57a597de2c8e769420899b4230971fe252fbc49d`, two external issue-702 commits
  beyond the earlier 99721028 base. These are not our five local commits.
  External release run 34325920117 is in progress with its unit job running;
  other reported validation jobs passed. The latest completed release remains
  v14.0.97, published September 9, 2026 at 06:32:59 UTC. No push, issue closure,
  rebase, or remote write occurred in this follow-up.

### Retained end-seeking and current integration

- The maintained Bash runner route initially failed under sandbox EPERM on
  child-process fixtures. The same `npm run test:runner --workspace=virtual-bash`
  route passed 302/302 after approved execution outside that sandbox. Receipts:
  `out/issue-678-tmp/runner-integration-v{1,2}.log`; the direct reporting diagnostic
  preserves its seven EPERM failures separately. No runner implementation changed.
- Root now authorizes optional `seekEnd(options): Promise<bigint>` on retained
  read and resize handles. Missing/undefined remains unsupported. This consumes
  an actual retained end-seek operation, never a pathname size approximation;
  no universal native or directory capability follows from the interface.
  Scoped handles preserve the method, receiver, exact offsets, operation charges,
  combined signals and closed admission. The corrected initial scoped red had
  18 failures/2 passes; its first fixture omitted the custom backend's explicit
  resize capability and is preserved as insufficient resize evidence.
- Two additional root regressions exposed canceled seek dispatch after reading
  caller options during signal merging. The first used explicit undefined;
  the corrected typed controls return an AbortSignal and still reproduce both
  failures. The merge now checks its completed signal before dispatch. The
  four-file scope/quota/helper/metadata group passed 86/86, including 27 root seek
  controls, with no native operations or disk fixtures. Receipts:
  `out/issue-678-tmp/scoped-seek-options-{red-v1,red-v2,green-v1}.log`.
- Quota forwarding independently reproduced 18 failures/5 passes before its
  implementation, then passed 30 owned controls and 203 neighboring controls
  across six files. Seek operations preserve the existing global queue, retained
  identity, exact bigint and draining close without quota or content changes;
  read-handle forwarding remains unchanged. Source SHA-256:
  `bf8b676f9239bad5161241449eda743e6155ed623db5598efb7fab13160fa857`.
  Receipts: `out/issue-678-tmp/quota-seek-end-*`; these cohorts overlap other gates.
- Command consumption reproduced 53 focused failures, then passed 59 focused
  and 1556 owned controls at source
  `38f51b8eeba1c22efd286255cc8bf7d34423a19c67ae463f360db9e89e1c9395`.
  Regular references remain stat-only. Nonregular references acquire/read-seek/
  close before target effects, ignoring GNU reference-close failures while
  draining admitted work. Relative targets seek their same writable handle.
  Three previously mismatching null cases match original captures through
  faithful custom handles, not yet through every production backend.
- Root validated that `toFsError` lost genuine ESPIPE errors, added the errno,
  and passed the targeted error-map controls. The command adds GNU `Illegal seek`
  mapping plus 12 controls, but its current public runtime still rejects ESPIPE
  construction before command execution: 1556 pass/12 fail, not a green mapping
  gate. Command source is now
  `2706dffc10c1262134dbb51bd6a21a90fa9411e041333d504bbf536f5aedfc9e`.
  Fresh bounded GNU 8.30 captures independently confirm exact ESPIPE bytes and
  reference-stop versus target-continue effects in two owned FIFO fixtures:
  `out/issue-678-tmp/seek-errno-native-sY4DzW/receipt.json`. All keeper descriptors
  were closed. The initial sandbox EPERM receipt is preserved separately.
- The public consumer fixture now exercises the three captured null end-seek
  cases. Its browser red records ENOTSUP for relative null resizing (1 failed,
  8 passed), rather than hiding that production gap. The Device owner is assigned
  both retained Null methods after namespace work, with separate stage receipts.
  No Memory-directory policy, general native seek adapter or new read-open
  option has been implemented by this decision.
- A source typecheck during active namespace editing failed on Mount's explicit
  undefined `resizeCreate` under exact-optional typing. The owner has the concrete
  diagnostic. Full rebuild, current strict declarations, Shell lifecycle replay,
  playground checks, installed consumers, screenshots and the full gates remain
  pending stable source; partial source-bundle checks do not replace them.

### Native seek feasibility and release monitoring

- The bounded public-WASI investigation established a real Node 22.22.0/Linux
  descriptor route for regular files and explicitly opened null, including exact
  bigint offsets and actual cursor movement. It does not solve the requirement:
  directory/FIFO rights reject with ENOTCAPABLE before native seek, and inspected
  Bun behavior ignores the supplied descriptor mapping and uses a metadata-size
  approximation. Do not translate rights errors into fabricated native errno,
  ship a stat-size substitute, or claim Node/Bun parity. Original Node 8/12 and
  separate corrected 2/2 controls remain distinct; the Bun incorrect-errno
  assertion remains a failure. No WASI production integration is authorized.
  Findings and source provenance:
  `out/issue-678-tmp/seek-feasibility/research-20260909-v1/conclusion.json` and
  `manifest-v1.json`.
- Further source review supports considering an explicit virtual `linux-dx64`
  Memory directory-cookie policy: the indexed-directory terminal cookie is not
  directory storage size. The existing receipt is consistent with that profile,
  but its 0xEF53 filesystem magic alone does not identify the exact ext driver,
  kernel, indexing state or mount options. A future implementation needs pinned
  directory identity/cursor semantics and explicit directory-aware read admission,
  preserving current regular-only callers. Synthetic Mount directories currently
  lack distinct pinned identity. This remains a proposal, not authorization to
  fabricate a universal directory offset or a completed Real/Bun solution.
- Read-only monitoring verified release run 34325920117 completed successfully.
  Tag v14.0.98 points to external commit
  `57a597de2c8e769420899b4230971fe252fbc49d`, also current remote main, and was
  published September 9, 2026 at 08:14:10 UTC. One approval-review timeout was
  retried once before that check ran. The five earlier commits remain local at
  fd72e1df2; this external successful publication does not deliver them or the
  uncommitted truncate work. Remote writes remain unapproved.

### Fresh runtime qualification and actual Playground regression

- Namespace work now resolves absolute symlink targets within the selected
  backing namespace without rewriting stored targets, bypassing confinement or
  swallowing permission errors. Four owned namespace reds became four greens;
  the broader namespace gate passed 1295 controls. Retained Null readers and
  resizers now expose exact `seekEnd() = 0n`, preserving character metadata and
  EINVAL truncation. The combined namespace/Null gate passed 1322 controls and
  the final composition gate 179. These overlapping cohorts are not additive.
  Handoff: `out/issue-678-tmp/path-owner/implementation-xrI36p/namespace-null-handoff-final-v1.json`.
- Normal root development build v3 caught the new ESPIPE member missing from
  Which's exhaustive errno map. Its existing fatal stat/access controls now
  include that code. Build v4 encountered sandbox IPC EPERM; approved v5 passed
  the normal 71-workspace graph, 70 declared builds and root suffix stages.
  The one undeclared build is not a pass. All 13 selected source hashes remained
  unchanged across v5. This is a dirty-source development build, not frozen
  delivery qualification: `out/issue-678-tmp/full-development-build-v5.log`.
- The refreshed runtime exposed 15 old truncate Shell fixtures whose metadata
  namespace did not match retained memfs acquisition. The owner reproduced 18
  focused failures, repaired only the fixture's stat/lstat/access/realpath/
  readlink namespace, and passed 1577 owned-plus-registration controls. Original
  diagnostics, cancellation expectations and snapshot bytes were not changed.
  Source remains `2706dffc10c1262134dbb51bd6a21a90fa9411e041333d504bbf536f5aedfc9e`;
  test hash is `d5f667351a9caa61d33f647b832d2120ea8614172db28c5f633c1ba07aea444d`.
  Separate independent historical fixtures also exposed invalid directory
  metadata; their initial failures are retained, and corrected-fixture replays
  remain a separate cohort rather than relabeling the old receipts green.
- Maintained Bash typecheck found two complete-stat test records missing the
  newly optional preferred I/O block field under their `Required<FileStat>`
  models. The records, prototype getter and optional-field permutation inventory
  now include it. Direct overlay/readonly cohorts passed 45 and 14 controls;
  maintained typecheck v4 passed 26 current consumer groups, with the expected
  negative-consumer compiler failures and four held evidence inputs reported
  separately. This establishes declaration checking, not runtime acceptance.
- The full Safe FS development suite passed 3007 controls in 71 files after an
  approved rerun for sandbox-blocked localhost tests. Original v3 failures and
  unhandled socket EPERM remain in their receipt. Runner integration separately
  passed 302 controls. Neither is a replacement for the final uncached root gate.
- Actual screenshot inspection caught a real gap despite 73 earlier browser/
  kernel/session checks: Playground's worker bridge did not transmit retained
  open operations. Regular-file truncate returned ENOTSUP and left bytes intact.
  The red screenshot and ARIA are preserved as
  `out/issue-678-tmp/truncate-playground-v1.png` and `.aria`.
- Adding the retained bridge exposed a second real issue: the page's bespoke
  pathname quota guard leaked the raw retained resize opener. The actual-worker
  regression allowed hardlink growth past 16 MiB. The shell now uses canonical
  `withFileSystemQuota` rather than a second retained quota implementation. Its
  explicit scan limits preserve the prior unrestricted entry/depth policy;
  editor/upload limits and their serial admission remain unchanged. The red
  captured one failure/one pass; the corrected session suite passed 33 controls.
  Bridge resource-retirement and execution cleanup qualification is still in
  progress; the green unit cohort alone does not finish visual qualification.
- A separate bounded native GNU 8.30 capture verifies the exact Playground
  transcript's stdout, stderr, status, binary zero extension, hardlink identity,
  shrink effects and empty Null-reference target, without normalization:
  `out/issue-678-tmp/playground-truncate-native-CTLJKg/receipt.json`.
  Original sandbox denial remains separately recorded. No directory-cookie
  policy or general Real/Bun native end-seek support has been fabricated or
  waived by these integration fixes. Installed current-candidate consumers,
  refreshed screenshots and final full gates remain outstanding.

### Retained Playground bridge and exact visual confirmation

- The bridge now transmits pinned read/resize handle operations, optional exact
  bigint end seeking and shared stat identity scopes. Ordinary requests, active
  handles including pending acquisitions, read request sizes and identity tables
  are bounded. Close blocks admission synchronously, drains admitted operations
  before physical release and retires late acquisitions; opaque capability
  queries are not promoted into shutdown barriers. Owned bridge controls passed
  48/48. Existing non-Error RPC error serialization remains an explicitly
  unchanged limitation, not a claim of arbitrary thrown-value identity.
- Reading the execution boundary exposed an unresolved-result bug if filesystem
  retirement rejected after `finished` was set. Two tests reproduced it before
  correction. Execution now always settles after cleanup drain, retaining an
  existing nonzero/timeout outcome and surfacing cleanup-only failures. The
  complete execution cohort passed 20/20. The two-file combined 68/68 cohort
  overlaps these counts. Handoff and all intermediate reds/corrections:
  `out/issue-678-tmp/playground-retained-rpc-handoff-v1.json`.
- Root lint corrected two delayed fixture declarations and the empty fallback
  catch without changing their tested behavior. Normal root build v6 retained
  its sandbox IPC failure; approved v7 passed all declared stages and the 24
  selected source hashes remained stable. The complete Playground-plus-browser
  focused gate then passed 229 controls across nine files, including actual
  worker execution and the hardlink quota regression.
- A fresh browser reload and actual command execution now match the native
  transcript exactly: 72 stdout bytes, 70 stderr bytes and status 1. The expected
  failure is the final Null truncation, not regular-file ENOTSUP. The new PNG
  was visually inspected and the ARIA JSON strings were decoded and compared
  directly to the raw native hex, with no output normalization:
  `out/issue-678-tmp/truncate-playground-v2-comparison.json`.
  Both the red v1 and corrected v2 screenshots remain. The task-owned browser
  session was closed and verified absent; the owned Vite server was stopped.
- The first full root unit attempt failed sandbox Git discovery. Its approved
  normal `npm test` rerun stopped in the shared phase with 21779 passes, one
  failure and one skip: `agent-eval`'s real-Vitest integration reported child
  exit 1. This is not full-suite acceptance or yet an established unrelated
  defect; a bounded read-only reproduction is assigned. Later workspace phases
  and native npm post-hooks are not credited as run.
- Full root lint found two prefer-const errors in the retained composition
  tests and two unused-binding warnings in truncate fixtures. Root corrected
  only declarations/ignored-binding names; focused lint is clean and the
  affected composition/command cohorts pass 179 and 1571 controls. The preserved
  first full-lint receipt remains a failure; its normal rerun is in progress.
  Current test hashes are
  `1b39a1d2a6ee660582aafc55748dffc521d627ef8889d8c240e7a43f8fd6dd97`
  (composition) and
  `19b0d5b8fc8ae3715a27a9143442f20ca9c1d37b22b1077be654efe8541a53d7`
  (truncate). Earlier source/test hashes remain historical observations.
- Read-only release monitoring still finds v14.0.98 and successful release and
  scoped-package workflows at external commit 57a597de. No remote writes were
  made. Current installed-tarball consumers and a successful full unit graph
  remain outstanding, alongside the explicitly retained directory/native-seek
  compatibility gaps. None is waived by the exact visual transcript match.

### Full-gate environment and public artifact profile follow-up

- Independent corrected-namespace replays finished with direct 9/9, controls
  56/56, historical Shell 57/58, isolation 11/11, separately corrected held-close
  1/1 and reference-seek smoke 6/6. The preserved Shell failure expects a ninth
  opener getter lookup, but the current implementation performs eight: its
  cancellation never triggers. This is not evidence of post-abort dispatch and
  is not credited as cancellation coverage. No extra semantic-control pass is
  claimed; its approval review timed out before execution. Every historical
  assertion, exact fixture delta and source hash is retained in
  `out/issue-678-tmp/lifecycle-root-review/namespace-v6-summary.json`.
- The shared agent-eval failure was reproduced twice with workspace-local
  TMPDIR. Its child Vitest process discovers the ancestor repository config,
  whose include patterns omit the generated root-level sample. Changing only
  TMPDIR to `/tmp` discovers the intended two child cases and passes the outer
  test. Source/config hashes were unchanged; no product or test edits were made.
- The resulting full-unit v4 rerun passed that test but exposed three real-host
  lint-guard fixture failures: `/tmp` contains 51444 entries, above the unchanged
  30000-entry per-directory cap. The 21777 passes, three failures and one skip
  remain a failed shared phase. No temporary files were broadly removed and no
  guard limits were increased. An approved owned directory under `/var/tmp`
  avoids both ancestor config discovery and the oversized `/tmp` ancestor;
  both affected test files pass all 273 controls there. The normal full graph
  v5 is now running with that explicit temporary-root profile.
- Full root lint v2 passed with 10453 configured/linted subjects, no errors or
  warnings, followed by repository TypeScript and workflow lint. The subsequent
  public-type fixture addition is separately checked by strict installed
  NodeNext compilation and focused lint. It exercises read/resize type parity
  between public Bash and FS entries, create intent, preferred block metadata,
  optional exact bigint seeking and retained close.
- Initial installed development tarballs passed Node, Bun and strict NodeNext
  consumers, but browser bundling failed on `node:stream/web`. The receipt is
  not a green publication gate. Inspection found the intervening normal unit
  graph had rebuilt the Bash workspace, replacing `dist/core.browser.js` with
  its 67-byte source facade after the root build. Root's normal bundle suffix
  supplies the browser platform adapter; the scoped release workflow builds
  that suffix before packaging and does not interpose this workspace rebuild.
  Requalification requires a fresh normal root build after the unit graph,
  then newly packed artifacts with no competing emitter. Do not repair this
  profile mistake with a consumer shim or relabel the failed tarball green.
  Initial artifacts and hashes remain at `/tmp/truncate678-public.uOC8Tm` and
  `out/issue-678-tmp/current-public-tarball-v2.sha256`.

### Full Bash gate and coherent errno milestone

- Full unit v5 progressed through shared 21780 passes/one skip and runner 302
  passes, then stopped in the Bash phase with 26296 passes, six failures and
  63 skips. Later SafeJS/terminal/posttest phases are not credited. Readonly
  namespace/capability assertions, scoped capability identity and one pipeline
  dispatch expectation are under targeted correction and explicit review.
- The packed S3 export failure is a concrete mixed-revision compilation error,
  not an established S3 runtime defect: the verifier archives committed HEAD
  fd72e1df while consuming the current checkout FS peer. That peer now declares
  ESPIPE, but committed Which's exhaustive map lacks it. The actual child and
  focused replay both fail with TS2741 before packaging/runtime export checks.
  Do not change archive diagnostics, omit controls or substitute another profile
  to make this gate appear green. Evidence:
  `out/issue-678-tmp/command-owner-20260909-v1/s3-exports-diagnosis-v1.json`.
- The narrow errno correction is independently separable from unfinished
  truncate support: preserve ESPIPE in the canonical FS error type/mapping and
  add its description to Which's exhaustive map. The original normalization
  regression is moved unchanged into a standalone FS error test, with one
  constructor/identity control. Four FS error/platform controls and 13 Which
  controls pass; focused lint is clean. A local atomic commit of only this
  correction, its tests and this plan can restore committed-source/peer
  coherence without claiming the new utility complete. Remote push/issue
  mutation remains separately unapproved; no release delivery is implied.
- Root also reproduced three absent/negative capability identity regressions.
  The resize normalizer now preserves an unpromised capability object unchanged
  and only revokes affirmative unsupported/readonly promises. All 90 helper,
  scoped-seek and quota-neighbor controls passed at that checkpoint. This
  uncommitted correction remains separate from the errno milestone.

### Namespace review and actual-facade qualification

- The approved local errno-only commit is `7483b924001aaf95ef1f2095bf2370126baced31`.
  The original committed-archive S3 export gate now passes all 188 controls;
  no archive inputs, profiles or diagnostics were substituted. This is a local
  commit and local verification, not remote-main delivery or release publication.
- Readonly now preserves namespace-symbol absence and exposes a detached,
  frozen selector-only view when metadata exists. It does not expose backing
  metadata, callbacks or attached native/delegate fields. Signal-aware capture
  retains the original receiver, validates selected roots and fails closed on
  malformed metadata, including across separately loaded module instances.
  The owner passed 33 authority controls and 1359 owned/Device/Mount neighbors;
  the 77-case Bash source-alias pass is explicitly not a built-facade pass.
- Root review found another concrete ordering defect: a nonfrozen projection
  can abort during `Object.isFrozen`, and the combined condition selected EIO
  before checking that cancellation. Three direct/readonly/nested controls
  failed before the repair; all six new cancellation/noncancellation controls
  and the 59-case focused namespace gate now pass. Invalid metadata without
  cancellation still fails EIO. Evidence and exact source hashes are retained
  in `out/issue-678-tmp/namespace-integrity-abort-handoff-v1.json`.
- The pipeline fixture now distinguishes budget admission from physical backend
  entry. Sequential forms retain exact one-call/event-order assertions; a
  deterministic pipeline waits for first backend entry before exhausting the
  budget, and five falsey pre-entry cancellation controls require zero backend
  calls. The original failing scheduling-dependent assertion remains in its
  receipt; this is a disclosed fixture correction, not an unchanged-input pass.
  All 26 named filesystem admissions now include `openResizeFile`. The scoped
  and per-path capability identity assertions are unchanged.
- A maintained SafeFS-only build passes but does not refresh the actual
  `poe-code/safe-fs` facade: its runtime resolves to root-generated bundles in
  `packages/safe-js/dist`. The subsequent direct readonly test therefore still
  observed the old symbol behavior (76 passes, one failure). That failed receipt
  is retained; no source alias is substituted for the required facade gate.
  Normal root build v8 stopped at sandbox-denied local tsx IPC, before bundling.
  Build v9 is the approved normal-root retry against the now-frozen helper.
- Read-only release monitoring on September 9 still reports successful root,
  scoped-package and schema workflows for remote commit `57a597de2c8e769420899b4230971fe252fbc49d`.
  Those external releases do not deliver the six local commits. No push or issue
  mutation has been retried without human approval.
- Normal root build v9 completed all 70 declared builds across 71 workspaces and
  the root bundle suffix. The five selected helper/readonly/capability/test hashes
  remained unchanged. Actual-facade direct tests then passed readonly 77/77 and
  filesystem-budget 59/59; no source aliases were used. The full SafeFS gate
  passed 3030/3030 after the sandbox-denied loopback attempt was retained and
  rerun with approval. Full uncached unit v6 and root lint v3 are now running;
  neither is counted as passed before its terminal result. Current installed
  artifacts still require a post-unit normal build and fresh packaging.
- Root lint v3 completed with 10454 configured/linted inputs, zero errors and
  zero warnings, followed by successful repository type and workflow checks.
  Full unit v6 has passed the shared phase (21824 passes, one skip) and the
  302-case Bash runner phase; the main Bash and later phases are still pending.
- Full uncached unit v6 completed successfully on September 9. Recorded phases
  are shared 21824 passes/one skip, Python 29 passes, Bash runner 302 passes,
  main Bash 26307 passes/63 skips, SafeJS 21653 passes/37 skips, terminal 288
  passes and native root posttest lint-stress two passes. The maintained graph
  reports 71 workspaces, two required builds and 40 declared unit tasks, with
  no exclusions and cache disabled. Unavailable tasks and skipped cases remain
  explicitly not passes. `out/issue-678-tmp/full-development-unit-v6.exit` is zero.
  This closes the six full-v5 regressions, not the separately documented native
  nonregular-seek/large-value parity limits. Post-unit build v10 and fresh local
  packed-consumer verification are the next artifact qualification steps.
- Post-unit normal root build v10 passed, including the bundle suffix, with
  nine selected source/test/consumer hashes unchanged. Fresh local development
  artifacts `0.0.0-truncate-dev.20260909.2` pass installed Node 22.23.2, Bun 1.3.8,
  strict NodeNext types, browser-platform bundling/runtime and legacy 14.0.4
  coexistence checks. These are new tarballs, not a relabeling of the initial
  failed browser profile. Their hashes and stage receipts are recorded in
  `out/issue-678-tmp/current-public-qualification-v2.json`.
- The initial standalone consumer under `/tmp` failed its exact dependency
  absence assertion because pre-existing `/tmp/node_modules/@poe-platform/safe-js`
  was visible through Node's ancestor lookup. No dependencies were deleted and
  no assertion was broadened. The identical FS tarball and unchanged fixture
  pass both Node and Bun in fresh owned `/var/tmp/truncate678-fs-only.xf0sCu`,
  whose ancestors have no node_modules directories. The original failed
  profile remains preserved separately. No issue closure or push is implied;
  native nonregular-seek and backend large-value limits remain open.

### Additional source-driven differential checks

- A further original-source review covers GNU `truncate.c`, `stat-size.h`,
  `system.h`, `xdectoint.c`, `xstrtol.c` and `quotearg.c`. The resulting 56-case
  bounded regular-file cohort has no argv duplicates against the 1368 immutable
  snapshot rows: 12 three-size chains, 12 reference/order cases, 12 ordered-target
  cases, 12 option-order cases and eight suffix/sticky-modifier cases. All 56
  match exact stdout/stderr bytes, status, complete file bytes, modes, creation
  effects and within-backend retained/hardlink identity relationships, with no
  skips. Native outcomes include 12 expected failures, not just successful calls.
  Largest file is 8198 bytes and largest case including aliases is 32779 bytes.
  Current command, tests, native sources and snapshots remain hash-identical.
  This uses the current command and genuine public Memory backend, not another
  packed/Shell gate. The initial invalid harness configuration remains preserved
  separately and ran no targeted native cases. Evidence:
  `out/issue-678-tmp/truncate-regular-sidecar-20260909-v1/capture-v2/report.json`.
- Eight bounded native observations now distinguish directory reference behavior
  on both local filesystems under GNU 8.30 and kernel `5.15.0-1084-aws`. On the
  `0xef53` filesystem, empty/populated references have stat size 4096 but produce
  a terminal seek offset of 9223372036854775807. On the `0x58465342` filesystem,
  reference stat sizes are six/19 while the observed terminal offset is zero.
  Offset observations use native truncation of null (EINVAL diagnostics), not
  creation of huge files. Successful `-r reference '-s<1' target` cases create
  one zero byte on the first filesystem and an empty file on the second.
  Original absolute argv0 diagnostic prefixes are retained; no normalization
  is used. These are observations, not eight product passes, and no mode-parity
  claim is made for this separate cohort. Evidence:
  `out/issue-678-tmp/directory-profiles-v1.LN7110/receipt.json`.
- The four successful native cases were compared against the current installed
  development tarballs through real Shell execution over both Memory and Real.
  All eight comparisons still mismatch: the adapters reject the directory read
  handle with EISDIR before creating the target. Exact Shell byte arrays, status,
  target absence and each native expected result are retained in
  `out/issue-678-tmp/directory-profiles-v1.LN7110/packed-comparison-v1.json`.
  This rules out relabeling the gap as merely a large-allocation refusal: the
  expected target is at most one byte. Neither a universal directory constant
  nor a stat-size substitute supplies the demonstrated backend semantics.
- Read-only remote refresh still observes main `57a597de2c8e769420899b4230971fe252fbc49d`
  with successful root, scoped-package and schema workflows. No new local
  commit, push, issue closure or publication occurred during this follow-up.
- An approved, isolated install of pinned Koffi 3.2.1 at
  `/tmp/truncate678-koffi-probe.jocHq9` explores a possible native seek route;
  project manifests and lockfile are unchanged and install scripts were disabled.
  Upstream docs describe exact large-integer returns and errno access, but that
  is not a runtime compatibility result. Inspection found its Linux loader reads
  and decodes `process.execPath` ELF metadata. No Koffi import, native probe or
  production integration has been executed; the repository's prohibition on
  executable decoding must be respected rather than bypassed through a private
  binding or silent loader rewrite. This candidate remains unqualified.

### Retained-read admission correction and native primitive investigation

- Reviewing directory-aware read admission exposed a separate current violation
  in `openRetainedReadFile`: it performed observable metadata/acquisition work
  after cancellation during method or capability lookup, and awaited opaque
  pre-acquisition metadata indefinitely after cancellation. Twenty-five new
  controls fail before the correction (one receiver/options control passes).
  They cover availability/query/capability/acquisition lookup phases and pending
  metadata with false, null, zero, empty-string and NaN cancellation reasons.
  Original red receipt: `out/issue-678-tmp/read-admission-red-v1.log`.
- The helper now captures method receivers, checks cancellation after each
  observable admission lookup, interrupts only opaque metadata and rechecks
  before physical acquisition. It preserves the existing nullish query fallback
  and original caller options. Actual admitted acquisition is still awaited;
  late handles are closed and their close drains before the original cancellation
  settles, including secondary close failures. All 33 new controls and 274
  composition/capability/seek neighbors pass in the 307-case focused gate.
  This is a code correction, not a change to expected native command output.
- The previous full-unit v6, build v10 and packed-v2 receipts precede this helper
  correction and are not relabeled current full qualification. Complete SafeFS
  v7 passes 3,063 tests across 72 files; normal-root build v11 and full lint v4
  both finish with exit zero. Actual built-facade gates pass separately:
  readonly 77, budget 59, truncate 1,571 and registration 6. Four additional
  public bundled ReadOnlyFileSystem getter-admission controls pass. These are
  not a fresh full-unit or installed-consumer qualification of the helper.
- A separate bounded worker investigates a minimal original C Node-API bridge
  using the available Node 22.22.0 headers and the stable public Node-API surface.
  It may compile only its isolated experimental addon and run bounded owned-fd
  controls under Node 22.23.2 and Bun 1.3.8. It must not decode executables, load
  Koffi, use private runtime bindings, change project dependencies/configuration,
  or imply production integration. Exact bigint/cursor/errno observations,
  directory profiles, cleanup and platform limits remain explicit acceptance
  criteria; no native route is credited before actual results exist.

### Native feasibility results and resolver review

- The original synchronous Node-API experiment now passes 16 controls separately
  on Node 22.23.2 and Bun 1.3.8. The separate async experiment passes 10 controls
  on each runtime, with 23 native requests completed and all ten owned file
  descriptors closed per runtime. Proofs remain isolated under
  `out/issue-678-tmp/napi-seek-feasibility-v1/` and
  `out/issue-678-tmp/napi-seek-async-feasibility-v1/`; no production native
  integration or project dependency change follows from those results.
- Do not treat the earlier normalized peer comparisons as exact raw equality.
  The supplemental async audit retains all original records: complete raw
  control traces differ in all ten cases (28 fields), and full stdout differs.
  The actual 23 offset/errno return payloads match exactly; the cursor-read and
  no-growth record also matches. Full validation-error message/code/stack
  equality was not captured. The original 31 evidence records are unchanged.
- Async native work does not establish hard cancellation, environment-shutdown
  safety, injected allocation-failure recovery, minimum Node-engine coverage,
  cross-platform support, or production handle retention. Those remain explicit
  gates, as do the eight actual packed directory-reference mismatches.
- Reading the original 399-line GNU utility and its size-usability, block-size
  and decimal-conversion helpers confirms the relevant distinction: a directory
  reference follows open/seek/close, not `st_size`. The reference close failure
  is ignored while seek errno is preserved; target close errors are reported.
  A zero/stat-size stand-in cannot supply the missing directory behavior.
- The design-only native packaging plan had two experimentally validated
  resolver defects. Both Node and Bun reject a private-import target escaping
  its source package scope and a root-only mapping hidden by a nearer workspace
  package scope. An explicit in-scope ESM forwarder succeeds on both. The plan
  now names that route and the separate SafeJS worktree mapping; all six original
  status/stdout/stderr receipts remain under
  `out/issue-678-tmp/native-import-scope-proof-v1/`.

### Explicit visible-parity exclusions

- A source-level audit of the current four snapshot loops finds 1,368 captures
  but only 1,359 rows requiring exact stdout/stderr/status triples. These are
  assertion-policy counts, not a new test run or a new passing cohort.
- One pure `--version` row is wholly excluded. Seven mixed-option version rows
  still execute and compare status, stderr and target effects, but assert the
  22-byte virtual banner instead of the captured 308-byte GNU banner. Twenty-one
  version-option error cases retain exact comparisons. The broad native-loop
  skip predicate is a future coverage risk; today's only excluded row is the
  pure version invocation, not a hidden mixed-error workflow.
- One separate directory-reference row replaces the native parity assertions
  with a characterization of the current unsupported behavior. Three other
  flagged seek rows compare exact output using custom null handles; those
  fixtures do not establish real-backend directory acquisition support.
- These nine rows cannot be credited as exact native-output parity. The test
  label “intentional identity difference” is not a user waiver of the requested
  1:1 comparison. Do not hide those differences, count their characterizations
  as native matches, or claim the virtual implementation is GNU merely to make
  an output assertion pass.
- The audit reads the GNU version dispatch and its actual version-formatting
  helpers from the authenticated archive. Original bytes, 33 relevant rows,
  source/member hashes and precise assertion locations remain in
  `out/issue-678-tmp/truncate-visible-parity-audit-v1/report.json` and its adjacent
  `audit.md`. No product code, tests, snapshots or native captures changed.

### Opt-in retained directory admission

- Add `OpenReadFileOptions.allowDirectory` to the shared filesystem contract and
  Safe Bash type re-export. Literal `true` permits an explicitly supported
  directory handle; omitted/false preserves existing `EISDIR` behavior. This is
  a read-only request, not writable creation intent or an end-seek promise.
- Memory and Real readers now retain the acquired directory identity across
  rename, removal and replacement. Valid byte reads reject `EISDIR`; invalid
  positional bounds retain the ordinary `EINVAL` preflight. Closed operations
  reject `EBADF`. Memory accounts for retained nodes/path references and releases
  them once; Real close drains actual admitted operations and closes the native
  handle once. Neither reader invents `seekEnd`, zero, stat-size or a directory
  cookie. Existing path-based reads and streams keep their previous semantics.
- The shared helper and readonly/mount/device/overlay/quota/scoped composition
  preserve the request. Overlay's regular-only admission now permits real
  backend directories when opted in. Synthetic Device/Mount directories are not
  silently granted a retained identity. The command itself remains unchanged
  until a genuine end-seek implementation can be connected.
- Test-first evidence: composition 7 failed / 14 passed; Real 22 failed / 9
  passed; Memory 30 failed / 31 passed, followed by five failing capability-getter
  cancellation controls. Root review additionally reproduced five Device
  getter-cancellation failures and five Memory bounds-precedence failures before
  correcting them. The Device path now uses guarded retained-read admission
  instead of dispatching a second, uncaptured method lookup after cancellation.
- Integrated new directory tests pass 123/123. The initial complete SafeFS gate
  v8 had three loopback failures due to sandbox `listen EPERM`; unchanged
  maintained membership reran with approved loopback access as v9 and passed
  3,207 tests across 76 files. That whole-suite pass precedes the final Memory
  bounds-order refinement; its three-file post-refinement gate is the 123/123
  result, not a relabeled whole-suite pass.
- Normal root build v12 stopped at the github-workflows workspace because the
  sandbox denied tsx's Unix IPC socket. The complete maintained route reran
  successfully as v13 with approved IPC access, not a partial build. No native
  production dependency/compiler integration, push or issue closure occurred.
- Read-only GitHub observation v9 finds root release 34340847927, scoped release
  34340847717, toolcraft release 34340847681 and schemas 34340847805 completed
  successfully for external main `7618f3558a5f778e9920d522cff3bee48868c0a0`.
  Those jobs do not deliver this worktree's local commits or directory changes.

### Directory admission: current build and installed qualification

- Complete SafeFS v10 passes 3,207 tests across 76 files after the Memory bounds
  refinement. The subsequent strict public-declaration probe finds one concrete
  Overlay query signature still typed as `FsOptions`; its fresh-literal
  `allowDirectory` call fails TS2353. Change that signature to the already
  declared `CapabilityQueryOptions`, retain the failing probe, add the case to
  the maintained scoped-package type fixture, and rebuild through the normal
  root route. The expanded, unchanged probe then passes.
- Normal root build v14 completes all 70 declared builds in the 71-workspace
  graph and the root suffix stages. Full lint v6 passes 10,458 configured inputs
  with no errors or warnings, then passes types and workflow lint. Nine selected
  source/consumer hashes remain unchanged through build and packaging; this is
  not represented as a complete immutable repository inventory.
- Fresh `0.0.0-truncate-dev.20260909.3` tarballs generated by maintained
  `package-safe.mjs` pass Node 22.23.2 and Bun 1.3.8 smoke checks, strict installed
  NodeNext/ES2022 types, the browser-condition bundle and its Node execution,
  `poe-code@14.0.4` coexistence, and standalone SafeFS-only dependency checks.
  Installs are offline with scripts disabled. Preserve the first empty-cache
  `ENOTCACHED` failure; the same tarballs succeed in a new isolated `/var/tmp`
  consumer using the already populated cache, without a registry fetch.
- Actual built-facade, installed-scoped and installed-FS-only directory probes
  each pass 24 controls independently on Node and Bun. Each run opens/closes all
  24 retained handles across eight compositions on Memory and two native
  filesystem locations. Raw metadata, inode relationships, entrypoint paths,
  stdout/stderr and statuses are retained. These are operation assertions, not
  cross-runtime trace equality or a fix for GNU directory seeking.
- `out/issue-678-tmp/current-public-qualification-v3.json` records the precise
  artifact roots, three tarball hashes, 25 successful exit receipts and remaining
  limits. Its audit verifies every listed status, tarball digest and all six
  directory-runtime reports. Full root `npm test` is still historical relative
  to these edits; no issue completion or remote delivery is inferred.

### Additional native runtime profiles

- The unchanged async proof initially stops on its Node 22.23.2 admission guard
  when invoked under installed Node 18.20.8 and 20.5.1: zero controls or native
  requests execute. Keep that failed v1 profile; it is not an addon failure or
  a passing compatibility result.
- In a separate v2 copy, explicitly admit only those two exact Node versions by
  changing one version assertion. The Bun guard, ten behavior controls, cleanup
  and opaque addon bytes remain unchanged. Each initial sandbox run passes nine
  controls with one FIFO unavailable due to `EPERM`, exit 2. Approved unchanged
  retries pass all ten on each runtime, close ten descriptors, complete all 23
  requests and leave no pending resources. Fifty prior records remain unchanged.
- Exact source diff, raw failed/successful profiles and hashes remain in
  `out/issue-678-tmp/napi-seek-async-runtime-extension-v2/`. This adds measured
  Node 18 and 20 release-line evidence on the same Linux x64 host. It does not
  substitute for testing the actual Node 18.18 engine minimum, establish general
  raw-trace equality, or authorize production native integration by itself.

### Production candidate and exact directory command audit

- After directory admission/pinning qualification, the bounded production
  candidate adds a private asynchronous END-only Node-API backend to Real
  retained read and resize handles. Its Linux x64/glibc 2.31 profile is not a
  promise of minimum-engine or other-platform coverage. The packaging plan
  records the build-only header dependency, actual system-toolchain trust
  boundary, binary byte integrity and remaining release gates.
- The command now explicitly passes `allowDirectory: true` to both reference
  capability lookup and retained acquisition. The original GNU utility and
  helpers require nonregular reference open/seek/close, not directory stat size.
  TDD records 47 initial failures followed by 54 passing new controls. The
  superseded exact-options fixture is updated without altering snapshots;
  1,571 existing command tests and six registration tests pass as well.
- Maintained build v17 succeeds after the final cleanup changes. Full lint v8
  passes all 10,470 configured inputs, types and workflows. Full unit v8 does
  not pass: shared tests pass 22,358 with one existing skip, Python passes 29,
  and the Bash runner passes 302, but Bash reports 26,340 passes, 21 failures
  and 63 skips. Twenty failures reject the newly introduced private native
  peer edge; one correctly refuses the uncommitted workspace lock when binding
  a selected committed revision. Neither gate is bypassed or counted as green.
- The fresh built-public command audit runs all eight bounded directory
  workflows on both filesystem profiles for each backend and runtime. On both
  Node 22.23.2 and Bun 1.3.8, Real matches GNU in all eight cases for exact
  stdout/stderr/status and target existence, bytes, size, type and permission
  bits. New and existing targets, empty and populated references, and EXT/XFS
  are retained. Timestamp/inode equality is not asserted. All 16 shells per
  runtime are disposed.
- Memory still mismatches all eight cases on each runtime, reporting that
  reference size is unsupported and leaving the target absent or unchanged.
  Each complete audit deliberately exits 1 because parity is incomplete;
  Memory rows are neither excluded nor counted as successful characterizations.
  No universal zero, directory stat size or guessed INT64_MAX is introduced.
- Reports and source hashes are under
  `out/issue-678-tmp/truncate-directory-command-v1-{node,bun}.json` and
  `truncate-directory-command-v1-inputs.sha256`. The v17 workspace/canonical
  binary bytes equal the earlier installed candidate, but its loader source
  changed; previous installed-consumer qualification is not transferred to the
  new whole candidate. The version-banner differences and other published
  qualification gaps remain unresolved. Nothing in this checkpoint is a push,
  issue closure or release of the local candidate.

### Peer-capture follow-up and final local checkpoint

- Repair both peer capture layers without a blanket private-import allowance.
  The first validates exact native mapping, finite asset membership, hashes,
  fatal manifest UTF-8 and symbol-aware loader imports. The second consumes
  immutable facts only from the original branded binding after fresh source
  and staged-byte validation. Native bytes remain opaque; no executable native
  edge is added to the unchanged cleanup worker. The new and neighboring
  memfs gates pass 175 controls, and the actual public cleanup replay passes
  all 20 controls with its owned snapshot removed afterward.
- The final full lint v10 passes 10,472 configured files with no errors or
  warnings, plus types and workflows. The separately run maintained SafeJS
  workspace task passes 21,653 tests with 37 existing skips; it is not presented
  as completion of the root unit route. That route has not passed the selected
  committed-revision metadata/lock prerequisite. The earlier 21-failure full
  receipt remains intact, followed by the successful targeted cleanup replay.
- Fresh scoped v2 tarballs install offline with scripts disabled in an isolated
  peer consumer. Node and Bun public smoke gates pass, and each runtime executes
  eight Real directory-reference workflows matching the unchanged GNU captures.
  Installed public NodeNext/ES2022 type fixtures and the native-free browser
  bundle pass. Receipt audit:
  `out/issue-678-tmp/native-scoped-v2-qualification.json`. This does not waive
  the Memory/version differences or qualify a packed root artifact, FS-only
  relocation of this new revision, other engines/platforms, or Worker-only
  condition graphs.
- Read-only monitoring verifies root release run 34352845497 for external
  commit `2917f1b8622bfa4663f8edd3cf062bef6481ffa1` completed successfully on
  September 9, 2026 at 13:08:19 UTC. It does not contain or deliver this local
  uncommitted candidate. No new commit, push, issue closure or release is made
  during this checkpoint.

### Directory-reference baseline decision still required

- A subsequent local inspection identifies `/tmp` as ext4 and the worktree as
  XFS using `findmnt`. All ten source hashes in
  `out/issue-678-tmp/truncate-directory-command-v1-inputs.sha256` still match.
  This is a source/evidence revalidation, not a new command replay.
- The same captured argv, `-r reference -s<1 target`, with an empty reference
  directory and absent target succeeds natively on both filesystems, but creates
  different contents: ext4 produces one NUL byte; XFS produces an empty file.
  Both native captures have empty stdout/stderr, exit 0 and target mode 0644.
  The Real rows match their respective native profiles. Both Memory rows instead
  fail before target creation. The original report retains all four rows.
- Reading original `src/truncate.c` reference handling and
  `src/system.h:701` confirms that directory stat size is not the reference
  size: `usable_st_size` excludes directories, so the utility opens the reference
  and obtains its end with `lseek`. Therefore replacing the missing operation
  with Memory's existing zero directory stat size is not source-equivalent.
- Current Memory directories contain an entry map and metadata, with no native
  filesystem profile or directory seek-position representation. Its options
  configure only three allocation limits. Consequently an unconfigured fixed
  Memory result cannot match both different native expectations for this same
  logical input. This does not excuse either failed row or establish that one
  filesystem's behavior is the universally correct replacement.
- A decision about the native baseline Memory is meant to emulate is needed
  before choosing directory seek semantics. Do not infer that decision from the
  host running a test, add a public profile option merely to turn tests green,
  substitute directory stat size, or discard the other profile's evidence.
  The separate version-identity mismatch likewise remains unresolved; copying
  GNU's identity banner is not authorized by a green-test target.
- A read-only release check again reports root run 34352845497 successful at
  external commit `2917f1b8622bfa4663f8edd3cf062bef6481ffa1`, completed on
  September 9, 2026 at 13:08:19 UTC. Local commits and this candidate remain
  undelivered; this observation is not release qualification of either.

### Minimum-engine native qualification: Node 18.18.0

- The installed scoped v2 SafeFS manifest declares Node `>=18.18`. Use exact
  Node 18.18.0, not an installed earlier 18.17.1 or later 18.20.8, to check that
  boundary. The private workspace's test-engine assumptions do not replace the
  public artifact's declared minimum.
- Download only the official Linux x64 runtime archive into an owned temporary
  directory. Its SHA-256 matches the Node release page before bounded XZ/tar
  admission. Extract/hash the single executable opaquely; do not decode it,
  install globally, add dependencies, or run a package install script. This
  checks the published checksum over HTTPS, not a verified release signature.
  Admission receipt: `out/issue-678-tmp/node1818-runtime-admission.json`.
- Execute from the existing isolated scoped v2 consumer with a minimal explicit
  environment and only installed public SafeFS imports. Verify the manifest,
  loader and binary bindings before testing; do not load workspace source or a
  private native binding as a substitute for public consumer behavior.
- On both observed ext4 and XFS roots, create small owned fixtures, retain a
  writable regular file, seek/resize it across rename and pathname replacement,
  and confirm the replacement bytes are untouched. Close each retained handle
  and verify subsequent use fails with EBADF.
- For empty and populated reference directories on both roots, acquire a public
  directory read handle, get its bigint end position, and compare that position
  with the exact bounded diagnostic from fresh GNU `truncate -r REFERENCE -s+0
  /dev/null`. Preserve stdout, stderr and status without normalization. Verify
  retained directory identity across rename/replacement and close every handle.
- Keep this gate separate from Memory-directory parity, version identity, other
  engines/platforms, process shutdown/fault injection, and remote delivery. A
  passing minimum-engine slice does not complete the feature or qualify every
  exported operation. Preserve failed setup/execution receipts separately.

### Minimum-engine results and current FS-only relocation

- Exact Node 18.18.0 reports Node-API 9 on Linux x64/glibc 2.31. The installed
  scoped v2 consumer passes all six retained native controls: two regular-file
  resize/pinning workflows and four directory-reference controls across ext4
  and XFS, with empty and populated directories. The four fresh GNU diagnostics
  match exactly. All six acquired handles close; closed use returns EBADF and
  directory reads return EISDIR. Receipt: `node1818-public-v2.json` and `.exit`
  under `out/issue-678-tmp`.
- The first public attempt remains an incomplete failure: the sandbox reports
  EPERM for the oracle subprocess after two handles are acquired; both close.
  Its partial output is not relabeled a passing native comparison. Normal
  escalation reruns the same controls and produces the successful v2 receipt.
- A fresh filesystem-only consumer installs the checksum-verified scoped v2
  SafeFS tarball offline with scripts disabled, then moves to
  `/var/tmp/truncate678-node1818-fs-only.RbuVHH-relocated` before execution. It
  contains SafeFS, `@types/node` and `undici-types`, not zero installed packages
  beyond SafeFS. Root, SafeJS, SafeBash and build-header package absence is
  checked explicitly. No repository dependency or global runtime is installed.
- The maintained filesystem-only public fixture passes on Node 18.18.0 after
  relocation. The same six native controls also pass there, including four more
  fresh exact GNU diagnostics and six closed handles. Evidence:
  `node1818-fs-only-{install-v1,smoke-v1}` and
  `node1818-fs-only-native-v2` receipts under `out/issue-678-tmp`.
- The first standalone native probe fails during its own setup because this
  Node stdin-evaluation context has no `import.meta.url`. The maintained
  file-based fixture already passes. Replacing only that probe argument with
  the explicit absolute consumer package path makes `createRequire` and all
  absence checks work; the empty v1 JSON and its stderr remain. No product
  loader or native implementation is changed to accommodate the probe.
- Root rechecks all successful receipts, both six-control cohorts, eight exact
  fresh GNU diagnostics, twelve closed handles, relocation, and the temporary
  runtime hash. Native source, loader and adapter hashes remain unchanged.
  This closes the previously untested exact-minimum native slice and adds
  FS-only relocation evidence for the current v2 loader, not the older v1
  candidate. It does not qualify all SafeFS APIs, the SafeJS minimum, SafeBash
  below its declared Node 22 minimum, arbitrary shutdown/fault injection,
  Memory/version parity, the full unit gate, or remote delivery.

### Independent retained-filesystem milestone, September 9

- Prepare a separate local foundation commit containing the retained-read/resize
  contracts, adapters, quota/cancellation handling, END-only native implementation,
  authenticated build/packaging support and current peer-consumer validators.
  Include the generic Playground handle bridge and quota integration: otherwise
  its advertised retained capabilities would lack a corresponding bridge route
  and retained resizing could bypass the previous path-only mutation guard.
- Keep the `truncate` command, default registration, command fixtures and inventory
  changes outside this milestone. The two command-dependent Playground test diffs
  also remain outside; generic bridge, lifecycle and quota tests accompany the
  foundation. This separation does not reduce issue #678's required behavior or
  declare its known Memory-directory and version differences acceptable.
- Root scope review includes the public retained-FS type consumer and excludes
  command-specific smoke/browser/mixed-entry fixtures. The exact local candidate
  path inventory is `out/issue-678-tmp/foundation-commit-paths-v1.txt`; generated
  native binaries, output receipts and unrelated changes are not commit inputs.
- Focused root filesystem/bundle checks pass 3,465 tests in 82 files after the
  original loopback EPERM failure is rerun with approval. The separate maintained
  package-lint workspace task passes 540 tests in 13 files. The maintained
  Playground workspace task passes 220 tests in eight files; this live-worktree
  run includes command tests that are deliberately not part of the foundation.
- The first targeted Node runner reports six file-level passes without inner-case
  counts; do not treat that output alone as 305 executed assertions. Direct
  execution of the same six test files then reports 305 passing test cases,
  zero failures and zero skips. Preserve both receipts under `out/issue-678-tmp`
  as `foundation-bash-focused-v1` and `foundation-bash-direct-v1` respectively.
- These focused results are not a full maintained unit pass or committed-artifact
  qualification. The committed-source metadata/lock equality guard stays intact;
  rerun that gate only against a matching local commit, then the normal full gate.
  Local commit, verified remote-main delivery and publication remain separate.
- The third consumer validator had a reproduced private-native-edge refusal:
  initial controls report three failures and one pass, including two exact
  `Unbound runtime dependency: #safe-fs-native-seek` failures. Its repair reuses
  the original branded peer's authenticated runtime facts, freshly rechecks
  source/staged inputs, and rejects foreign aliases and relative access to native
  assets. Opaque binaries remain hash-only inputs. The metadata/lock guard and
  existing member/read limits remain unchanged.
- The validator's final direct controls pass 44 new cases plus four selected
  archive controls, 68 existing peer cases and 42 required-peer cases. These 158
  cases overlap the root's 305-case cohort; do not sum them as unique coverage.
  Raw red/green receipts and hashes live in
  `out/issue-678-tmp/s3-native-binding-v1/handoff.md`. Its actual committed-archive
  gate remains pending. Add literal discovery assertions for all three new peer
  test files; do not ship pending truncate assertions ahead of their command.
- The literal discovery controls pass two selected inner tests; 672 discovered
  files are membership evidence, not an executed-test count. Root no-emit types
  pass, and the maintained guarded ESLint route completes all 10,474 configured
  files with zero errors or warnings. These results qualify the reviewed live
  inputs, not the pending commit's full unit or release gates.
