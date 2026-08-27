# Cross-adapter agent-tool integration checkpoint

## Canonical rmdir profile reconciliation

`profiles/README.md` describes the explicit configured WebDAV positive lifecycle
row and two stock-WebDAV refusal rows. The old command/assertion body is retained;
S3 remains the weaker snapshot-marker profile. Before-change canonical bytes are
classified historical data under `profiles/history/`. Historical measurements
below and the sealed stock 78/79 / configured 79/79 artifacts are unchanged, not
current-source certification. Fresh results are recorded separately by profile.

## Required-command preflight correction (separate current cohort)

See `preflight-review/README.md` and its committed raw evidence for the intentional
test-only replacement of the six-family exact-set preflight with 22 explicit
workflow command requirements. On identical frozen dirty production inputs, the
old preflight blocks **79/79** workflows; the new one runs all 79 and records
**77 pass / 2 fail**, preserving the S3/WebDAV safe-`rmdir` failures. Separate
setup controls pass **30/30**. No matrix assertions or CLI bytes changed.
All historical checkpoints below retain their original meaning and counts;
this new cohort does not revise Dirac's 9,686-pass / 164-fail / 70-skip audit.

## Run and recorded outcome

Run from the repository root; no credentials or optional comparator install:

```sh
node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/integration/adapter-tools/matrix.test.ts
npm run typecheck
```

Recorded August 26, 2026, Node **v22.22.2**: **79 tests, 58 pass, 21 fail,
0 cancelled, 0 skipped, 0 TODO**. The focused suite exits **1**, deliberately.
Three consecutive final strict-rejection runs reproduced these totals (1.061,
1.062, 1.201 seconds). Earlier whole-repository `npm run typecheck` passed;
the final full check exited **2** on concurrent foreign work:
`tests/commands/safejs/helpers.ts(4,38): TS2307`, missing
`../../../src/commands/safejs/index.js`. No foreign files were fixed. The owned
tests plus their transitive source imports pass the scoped strict check below.
This is not a whole-repository test-suite result or current whole-repo type pass.

```sh
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 \
  --module NodeNext --moduleResolution NodeNext --strict \
  --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax \
  --forceConsistentCasingInFileNames --skipLibCheck --types node \
  tests/integration/adapter-tools/fixtures.ts tests/integration/adapter-tools/matrix.test.ts
```

The inspected source tree at the earlier passing typecheck was
`8a3df6884238d9865ef7dbd163a030a2cc3f8eeb` (`HEAD`
`658ef25288a706e8fef3497f828523fa34d14ac0`). Final repetitions ended at `HEAD`
`1c66038ec8cee95bb10346067711014e56c1dd39` with concurrent uncommitted structured
command edits; this is an observed working-tree checkpoint, not an immutable
clean-source release benchmark. Aggregate plugin delivery `f4eb0b3` is included
in that history.

| Fixture / cases | Tests | Pass | Fail |
| --- | ---: | ---: | ---: |
| Required: memory | 11 | 11 | 0 |
| Required: real temporary directory | 11 | 11 | 0 |
| Required: S3 mock, default rename policy | 11 | 1 | 10 |
| Required: WebDAV over loopback HTTP | 11 | 5 | 6 |
| Mount: memory root, real `/work`, S3 `/objects` | 11 | 10 | 1 |
| Overlay: memory upper, S3 lower | 11 | 10 | 1 |
| Mount cross-backend pipeline and two copy directions | 1 | 0 | 1 |
| Overlay lower-byte preservation / removal masking | 1 | 1 | 0 |
| Readonly memory: read flow and nine mutation denials | 10 | 9 | 1 |
| Retained independent jq `split` capability reproduction | 1 | 0 | 1 |
| **Total** | **79** | **58** | **21** |

Required four-backend subtotal: **28/44 pass**, not pluggability acceptance.
The complete six-family write flow passes memory, real, mount-local real, and
overlay, but fails S3 and WebDAV. There are **no capability-based skips, xfails,
TODO substitutions, or backend-specific weakened expectations**.

## Actual public plugin dispatch

Every fixture imports `Shell`, `agentCommands`, `createAgentCommands`, and adapter
constructors from `src/index.ts`. Every shell installs **only**
`agentCommands()`: no manual individual-family registration, replacements,
custom command handlers, shell stubs, host command executors, or native oracle.
After awaiting setup, the tests compare the aggregate factory and installed
registry against the union of all six public family factories: **49 distinct
commands** at this checkpoint.

| Delivered family | Representative actual dispatch |
| --- | --- |
| `standardCommands` | `find`, `xargs`, `cat`, file operations |
| `textProgramCommands` | `sed`, `awk` |
| `structuredCommands` | `jq` |
| `searchCommands` | `rg`, including nested invocation through `xargs` |
| `byteCommands` | `sha256sum`, `gzip` |
| `diffPatchCommands` | `diff`, `patch` |

Observational middleware records registered command dispatch and awaits `next()`;
it does not change handlers, inputs, results, or builtins. Each writable backend's
named-file probe case **continues all ten probes even after failure**, asserts
all six families and all nine required representative command names dispatched,
then fails for any unmet expectation. Those are 60 probe assertions inside six
tests, not 60 additional test cases. Registration does not claim all 49 command
implementations were exercised.

The common flow sends `find` results through `xargs rg`, `sed`, `awk`, and `jq`,
writes/reopens a JSON report, compresses redirected binary input, hashes decoded
bytes, generates an exact unified diff (expected exit 1), patches the target,
and compares exact resulting text. Independent cases exercise external/empty
stdin, `cd` and execution cwd, stderr/input/output/append redirection, copy/move/
remove/touch, `sed -i`, patch stdin/reversal, binary sinks, checksum manifests,
missing paths, invalid patterns, unknown commands, cancellation, and output limits.
Ordinary compound flows stop on their first failed assertion; the named-file
probes prevent that from silently omitting entire command families. Cross-mount
write and both copy directions are independently attempted before failure is
reported. Later verification of their destinations requires those operations to
work and is not claimed as passed.

## Failure classification and owner handoff

All snippets below run inside the fixture shell in `/work`; files are seeded by
`fixtures.ts`. Expected success means exact fixture bytes, exit 0 and empty stderr
unless otherwise specified. These remain ordinary failing assertions, not
accepted limitations.

| Finding | Minimal reproduction / actual result | Classification and source-owner recommendation |
| --- | --- | --- |
| S3 content readers | `cat old.txt`: exit 1, `ENOTSUP` streaming read; `rg`, `sed`, `awk`, `jq`, checksum, `diff`, and patch-file reads also fail | **Integration bug**: consumers choose an always-throwing optional method by presence even though `readFile` works. Coordinate adapter/contracts and command owners on capability-aware bounded reads; preserve byte limits and cancellation. |
| S3 missing-file / output-limit checks | `cat missing.txt` reports streaming `ENOTSUP`, not `ENOENT`; `cat payload.bin` with a 32-byte output budget never reaches the intended limit rejection | Consequences of the reader-selection bug, not evidence that missing paths or output limits are accepted. |
| WebDAV shell `<` | `cat < old.txt`: `ENOTSUP` access permission checks; even missing-file redirection reports this instead of `ENOENT` | **Integration policy mismatch**: shell requires POSIX `access(path, 4)` while WebDAV rejects every nonzero mode. Shell/adapter owners must design remote-readable input handling without bypassing actual real-filesystem permission failures. |
| Named checksum / gzip | WebDAV `sha256sum payload.bin` requires absent `readStream`; `gzip -c payload.bin` rejects S3, WebDAV, overlay, and even the real path in the mixed mount | **Explicit byte-tool capability gaps**: checksum requires a method; gzip also rejects advertised `streamingRead: false`. A namespace-wide mount flag is not a per-path answer. Byte/wrapper owners should agree on bounded fallback or genuine streaming support; do not merely lie about capabilities. |
| S3 move | `cp payload.bin move-source.bin && mv move-source.bin moved.bin`: rename `ENOTSUP` | **Explicit adapter capability gap**, not corruption: default S3 disallows non-atomic rename. This matrix does not enable `allowNonAtomicRename` to make the row green. Any opt-in copy/delete matrix must be reported separately, without an atomicity claim. |
| Remote touch partially mutates | `touch touched.txt`: creates an empty file, then exits 1 on unsupported timestamps, on S3 and WebDAV | **Capability gap plus partial-effect behavior**: tests inspect the created bytes before asserting success. Core/adapter owners must decide and document timestamp policy; a failure does not imply rollback. |
| Mounted S3 traversal | `printf x > /objects/out.txt`, and copies in either direction, encounter `ENOTSUP` | **Wrapper/adapter integration mismatch**: mount traversal requires directory `access(..., 1)` that S3 cannot provide. Review namespace-aware permission policy. Mount also restricts cross-backend `copyFile` with `EXDEV`; that later barrier must be retested after traversal is fixed. |
| Readonly named gzip | `gzip payload.bin`: `ENOTSUP` streaming-write preflight instead of the required `EROFS` denial | **Capability/error-precedence gap, not a readonly escape**. Whole namespace and bytes remain unchanged. Eight other mutation cases assert actual `EROFS`; byte owner should distinguish readonly denial from missing streaming support. |
| jq raw line splitting | `jq -R -s 'split("\n") \| map(select(length > 0))'` with `alpha\nbeta\n`: exit 3, unsupported `split/1` | **Structured-language capability gap**, not adapter-specific. Preserved as a minimal red test; the common flow uses the already-supported `jq -R '.' \| jq -s '.'` composition on every backend. |

Useful source locations: `src/fs/s3/filesystem.ts` (access and optional stream
stubs), `src/commands/internal.ts` (core input),
`src/commands/text-programs/shared.ts`, `src/commands/search/shared.ts`,
`src/commands/structured/jq.ts`, `src/commands/diff-patch/shared.ts`,
`src/shell/runtime.ts` (redirection), `src/fs/webdav/webdav.ts` (access),
`src/commands/bytes/checksums/index.ts`,
`src/commands/bytes/compression/files.ts`, `src/commands/filesystem.ts` (touch),
`src/fs/mount/index.ts`, and `src/commands/structured/parser.ts`.
No source-owner fixes are included here. The independent read-only capability
review was consulted; these counts come from executing this owned suite.

## Determinism, isolation and limits

- Fresh fixtures per test. Setup uses real adapter methods to seed known text,
  JSON, patch bytes, and a 4,099-byte `index % 256` binary vector. Assertions use
  exact bytes/JSON values; Node crypto/zlib only independently verify hashes and
  compressed payloads. Gzip container metadata is not assumed identical.
- Real adapters are restricted to test-created `.real-*` directories **inside
  this subtree**. Tests neither execute host tools nor access product host files.
  All created real directories are removed in `finally`; no unrelated `.native`
  directories are touched. No persistent generated outputs are needed.
- S3 uses only `MockS3Client`, a fixed clock, isolated bucket/prefix, and two-entry
  pagination. It creates no cloud client and uses no credentials. **Full S3 remote
  credential/signing/provider interoperability is outside this local matrix.**
- WebDAV uses an ephemeral `127.0.0.1` HTTP server plus the existing unedited
  `tests/fs/webdav/mock.ts` protocol mock. Fetch is origin-guarded; redirects are
  rejected. Requests/responses are bounded to 1 MiB. Server sockets and pending
  handlers are closed/drained in `finally`, then mock files/locks are cleared.
- Shell output and overlay buffering are bounded to 1 MiB; execution has a
  150-command budget, 1-KiB pipe high-water mark, 15-second fixture abort, and
  20-second test timeout. DAV requests use a 3-second client deadline and
  5-second server request timeout. Cancellation waits for an actual stdin read,
  aborts with a fixed reason, checks caller-iterator cleanup, and checks that a
  pre-aborted call dispatches nothing. Its readiness watchdog is 3 seconds.
- All six writable backends pass the blocked **stdin pipeline** cancellation
  case; this does not establish cancellation of arbitrary in-flight remote/host
  side effects. Readonly snapshots compare the complete namespace and bytes,
  excluding legitimate read-induced timestamps.

Remaining scope: resolve the retained failures and rerun unchanged expectations;
real remote interoperability; readonly wrappers over other backends; additional
mount/overlay compositions, links, concurrency, host-operation cancellation,
large-file stress, and the remaining command/option surface. This checkpoint is
not full shell support, not a 72-hour work claim, not a complete product gate, and
not evidence of superiority over `just-bash`.

## August 26 follow-up: exact shell diagnostic oracle correction

The **58/79** results and failure analysis above remain the historical delivery
snapshot, not current failures. A subsequent unchanged read-only verification
observed **70/79**: six missing-input redirection assertions and two readonly
output-redirection assertions rejected the shell's new human-readable format;
the ninth failure was the independently retained jq `split` case.

Before correcting those eight assertions, the verifier inspected the committed
history, documentation, capture provenance, and exact diagnostic tests:

- Commit `19149d3d9c5dc6f309b61f215a140df18adaf6e4` deliberately changes runtime
  diagnostics to `shell: line <number>: ...` and maps redirection `ENOENT` to
  `No such file or directory` and `EROFS` to `Read-only file system` in
  `src/shell/runtime.ts`. This is a committed formatting contract, not an
  inference from the currently failing matrix's output.
- `tests/shell/GAP_EVIDENCE.md`, section “Fatal status and diagnostics,” documents
  the stable `shell` basename, source line numbers, direct GNU capture, and
  correction of earlier diagnostic expectations without dropping effects checks.
- `tests/shell/fatal-reference.json` has SHA-256
  `db7caed2e7d0c484a658bec4d3c4ccf4f920a267419d70484a1114b3b13938a6`, matching
  the file at `19149d3`. Its provenance identifies GNU Bash
  `5.3.0(1)-release (aarch64-apple-darwin25.4.0)`, argv0 `shell`, `LC_ALL=C`,
  and executable SHA-256
  `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
  The captured `value=$(<missing); ...` record contains exactly
  `shell: line 1: missing: No such file or directory\n`. The committed
  `file-shortcut.test.ts` correction corroborates the intentional replacement
  of the old errno-token oracle. No native executable was invoked for this work.
- The existing `tests/shell/fatal-diagnostics.test.ts` gate passed **21/21**,
  with zero failures, skips, or TODOs, using the frozen records. These records
  independently verify the prefix and missing-file wording. They do **not**
  contain a separate GNU readonly-filesystem capture: the readonly wording is
  explicitly established by the same committed redirection error table, under
  that documented and golden-tested rendering contract.

Only the six `cat < missing.txt` assertions now require the complete string
`shell: line 1: missing.txt: No such file or directory\n`. Only the two readonly
`printf` redirection assertions now require the complete string
`shell: line 1: target.txt: Read-only file system\n`. Both use strict equality,
including the relative path, line number, punctuation, and final newline; there
are no alternative-format regexes or ignored errors. Command-generated `EROFS`
expectations for mkdir/cp/mv/rm/sed/patch/gzip remain unchanged, as does the
command-generated `cat missing.txt` errno check in its redirected stderr file.
Every existing exit-status, stdout, routing, byte, namespace, and no-mutation
assertion is preserved. This is **oracle-format correction, not a backend
behavior waiver**. The jq test and its expected successful result are unchanged.

After correction, the exact matrix command at the top of this document ran
**79 tests: 78 pass, 1 fail, 0 cancelled, 0 skipped, 0 TODO**, exit **1**, in
1.023 seconds on Node v22.22.2. Each required backend is **11/11**, totaling
**44/44**; mount and overlay are each **11/11**, both composition cases pass,
and all **10/10** readonly cases pass. Actual six-family root `agentCommands()`
flows and named-file probes pass throughout; no registry or fixture changed.
The sole failing case remains
`structured capability gap: raw slurped text can be split into lines`:
`jq: unsupported function split/1 at offset 12`, exit 3 instead of 0, owned by
Archimedes/structured. No workaround or source fix is included.

The strict owned-scope `tsc` command above passed with exit **0**. The diagnostic
gate command was:

```sh
node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/shell/fatal-diagnostics.test.ts
```

Verification began at `7367ce4bf29dc40875e27a13d724469f59ad26b1` and ended at
`4979cf503bcddf08824b2f397dbd495f79356b97`, with concurrent uncommitted S3,
WebDAV, and wrapper source/tests, including streaming follow-ups. These are
working-tree results, not a clean final backend release gate. No broad filesystem
suite, whole-repo typecheck, or build was repeated for this narrowly scoped
correction; backend race/upload hardening and the next stable full gate remain
with their owners/root. Owned temporary directories were cleaned; foreign
files, staging, native-oracle directories, and dependency manifests were not
modified. Remote-provider interoperability remains outside this local matrix.

## August 26 follow-up: CLI and typed filesystem errors together

The next owned change strengthens the same eight diagnostic cases without
altering their canonical messages or adding/removing test cases:

- On each of memory, real, S3, WebDAV, mount and overlay, missing input now
  requires exit **1**, empty stdout, and the existing exact human stderr.
  The complete namespace/bytes are compared before and after the failed CLI
  redirection. Separate actual `access("/work/missing.txt", 4)`, `readFile`, and
  `stat` calls must each reject with **`error instanceof FsError`**, exact
  **`error.code === "ENOENT"`**, and exact **`error.path === "/work/missing.txt"`**.
  Namespace/bytes must remain unchanged after each boundary call.
- Both readonly redirect cases retain their exact human stderr and all previous
  byte/namespace checks, additionally require exit **1** and empty stdout, then
  call the actual readonly adapter's `writeFile` or `appendFile` separately.
  Each must reject with a real **`FsError`**, code **`EROFS`**, and path
  **`/work/target.txt`**, followed by another complete namespace/byte comparison.
- The shared assertion helper checks the error object's class and typed fields,
  never message parsing or a cast. There are **20 direct typed boundary checks
  inside the existing eight cases**. No fake filesystem wrappers, substituted
  handlers, backend-specific exceptions, skipped operations, or dependencies
  were introduced. All other command-level errno expectations are unchanged.

### Fresh gate after backend handoffs

All three backend final reports were present before the final filesystem run.
S3 source/tests were no longer being edited, and `git status --short -- src/fs
tests/fs` was empty both before and after that run. The checkpoint was
**`acef1118fe4e5e0342114ee7d28de5ea02df2327`**, source tree
**`288b6abc51d7046a62dc96b51268f786d224e034`**:

| Fresh command / gate | Tests | Pass | Fail | Skip / TODO / cancelled |
| --- | ---: | ---: | ---: | --- |
| Strengthened full adapter matrix | 79 | 79 | 0 | 0 / 0 / 0 |
| Full `tests/fs/**/*.test.ts` | 1,132 | 1,132 | 0 | 0 / 0 / 0 |
| Separate shared-conformance rerun | 202 | 202 | 0 | 0 / 0 / 0 |

Every gate exited **0**. Whole-repo `npm run typecheck` and `npm run build` also
exited **0**. Required four backends are **44/44**; the two other writable rows
are **22/22**; composition checks are **2/2**; readonly is **10/10**. The unchanged
jq split case now passes through the structured owner's concurrent fix. The
202 conformance cases are already included in 1,132, not additional distinct
coverage. Matrix, filesystem, and conformance durations were respectively
1.563, 2.332, and 2.110 seconds on Node v22.22.2. The matrix also passed 79/79
before the final handoff window.

In addition to the matrix/typecheck/build commands already recorded, the fresh
filesystem commands were:

```sh
node --unhandled-rejections=strict --import tsx --test --test-reporter=spec "tests/fs/**/*.test.ts"
node --unhandled-rejections=strict --import tsx --test --test-reporter=spec tests/fs/conformance/shared.test.ts
```

Included backend production commits: S3 **`1c846a1`, `acef111`**; WebDAV
**`a5d68b9`, `9e90573`**; wrappers **`402bda8`, `b05b734`, `78f5cd6`, `0011231`**.
The backend paths were clean, but other owners still had uncommitted
structured and diff/patch command changes, including the split implementation.
Thus the adapter matrix is a verified **working-tree integration checkpoint**,
not proof that the archived `acef111` tree alone passes all 79 cases or that the
entire repository is a clean release. All verifier edits remain in this subtree.

The verifier read `benchmarks/reports/ADAPTER_MATRIX_TRIAGE.md`: its immutable
79-case archive results are 58/21 at `6a259ff`, 61/18 at `b01ceda`, 66/13 at
`a5d68b9`, 76/3 at isolated `1c846a1`, and 68/11 at `b8df9e1` (pass/fail).
Those are different source snapshots from the moving-worktree 70/79 and later
78/79 reports, and precede the stronger assertion revision here. They are not
contradictions or retrospectively passing archives. The original evidence above
is intentionally preserved.

### Legacy-test and high-risk review

Inspection of committed `tests/fs` changes from `6a259ff` through `acef111` found
**no deleted filesystem test files and no newly introduced skip/TODO markers**.
The full filesystem glob was run, not a selected replacement for the prior
777-case gate. Relevant existing-test changes were explicit capability/policy
transitions: supported cross-mount copying replaces the former blanket EXDEV
expectation with byte/source-preservation, exclusivity and readonly checks;
rename/link still reject cross-device operations. Conditional streaming flags
and readonly pre-abort call counts reflect real delegated stream behavior.
New stream tests check pull counts, late rejections, cancellation, error identity,
partial writer effects, overlay publication failure, and lower preservation.
WebDAV upload/timestamp tests inject stale ETags and denied/locked responses and
verify unchanged concurrent data, rather than merely asserting capability flags.

S3's prior default-rename refusal was changed to an **explicit
`allowNonAtomicRename: false`** negative test that still asserts no transport
calls. S3 creation-mode refusal was separately replaced by advisory mode-metadata
roundtrip assertions; invalid modes still fail and `permissions` remains false.
That is a documented semantic change, **not equivalent permission enforcement**:
mode 0600 does not establish IAM-restricted staging. Root/Curie's policy review
must not be inferred complete from these passing tests. The untouched independent
`tests/stress/adapters/s3.test.ts:101` still expects default rename refusal;
the S3 worker reports 18/19 there. This verifier neither edited nor reran that
foreign stress test. Its policy/oracle disagreement is outside the 1,132-file-
system-test denominator and is not waived.

**New reproducible data-loss issue, routed to the mount/wrapper owner:** create
two distinct `RealFileSystem` instances over the same test-managed absolute host
root, mount them at `/left` and `/right`, and seed `/file` with `alias sentinel\n`.
The two file stats have the same host inode/device. Then:

```ts
await mount.copyFile("/left/file", "/right/file");
```

The public adapter call **resolves successfully but truncates `/file` to zero
bytes**, instead of rejecting/preserving a self-copy. This was reproduced using
actual adapters, a three-second signal deadline, and a newly created temporary
directory in this subtree; cleanup ran in `finally`. No source was modified.
After reseeding, root `agentCommands()` executing
`cp /left/file /right/file` correctly returns exit **1** with
`cp: EINVAL: source and destination are the same file '/left/file' -> '/right/file'\n`
and preserves the bytes. Thus the command guard protects this shell flow, but
does not make the public `MountFileSystem.copyFile` safe. The fix needs
namespace-aware self-alias protection **before** target truncation; unrelated
backends' inode numbers must not simply be assumed globally comparable.
This bounded probe is separate from the unchanged 79-case matrix and is an
unresolved source defect, not a passing-test waiver or a new claimed matrix case.

The green gates therefore do not establish complete backend safety. Remaining
provider limits include non-atomic S3 copy/delete rename, advisory modes and
virtual timestamps, no distributed metadata-lock guarantee, WebDAV dead-property/
ETag requirements, and unsupported POSIX staging permissions for WebDAV named
`gzip -k`. Mock S3 and loopback WebDAV are not live-provider credential/signing or
interoperability validation. No foreign `.native` directories were touched.

## August 26 append-open boundary coverage correction

Independent audit `d5ac96afd5288234de3b617bc15af3b2a3c42bf5`, specifically
`tests/integration/adapter-tools-diagnostics/{README.md,check-coverage.mjs,coverage.json}`,
found a real coverage gap in `df5bc45`: readonly `>>` first calls
`writeFile("/work/target.txt", new Uint8Array(), { flag: "a" })`, not
`appendFile`. The previous 20 direct typed checks and green 79-case result did
not establish the type of this actual append-open rejection. Its mutation
survived the old row while the independent acceptance row rejected it.

The existing append-redirection row now also invokes that exact public adapter
operation and requires an actual `FsError`, exact `EROFS`, and exact
`/work/target.txt`, then checks the complete `/work` namespace and bytes against
the pre-shell snapshot. The existing direct `appendFile` assertion remains.
There are now **21 direct typed checks within the same eight diagnostic cases**;
the matrix still has **79 tests**. Human stderr, status, stdout routing, existing
byte checks and all other expected outcomes are unchanged. This corrects test
coverage, not backend behavior or the shell's canonical human diagnostic.

### Frozen source and fixture provenance

Run started **2026-08-26T21:59:34Z**, Node **v22.22.2**. All checks below use
committed source **`bb74849174ea9f53420d00b2f5d210d290664c0a`**, `src` tree
**`b77579f5d588d441caf7969b1e56b3eb17229244`**, extracted to
`/tmp/safe-bash-append-open.Y90OUY/snapshot`. Only this corrected matrix file was
copied over its archived version; production source and the independent loader
were not modified. A concurrent foreign `src/commands/diff-patch/patch.ts` edit
and generated untracked JavaScript were excluded by the archive. Package and
lockfile bytes matched the workspace before linking its cached `node_modules`;
no install, network provider or native command oracle was used.

SHA-256 identities:

- Corrected `matrix.test.ts`: `14d9150068fa2b28acd671b6077e56b08c7565840c1760af9387cb5dbba2030d`.
- Unchanged `fixtures.ts`: `59ac2d1835ff329d0bbd08e3ae28bc8c656145e5bb568e6dbca0e851367cb3ab`.
- Independent `revision-loader.mjs`: `30e359042eeb39190754bb2c511d1117bb28896500f215751aec06b774647964`.
- Prior fixture revision: `df5bc453de004a8eb483696cf4ae1986a012cca1`, matrix Git
  blob `f007991b74b780e6aeb5fc4e8e570b1a18379528`.

Archive setup from the repository root (the recorded `mktemp` result was the
directory above):

```sh
root="$PWD"
checkpoint=bb74849174ea9f53420d00b2f5d210d290664c0a
evidence=$(mktemp -d /tmp/safe-bash-append-open.XXXXXX)
mkdir "$evidence/snapshot"
git archive "$checkpoint" | tar -xf - -C "$evidence/snapshot"
cmp package.json "$evidence/snapshot/package.json"
cmp package-lock.json "$evidence/snapshot/package-lock.json"
ln -s "$root/node_modules" "$evidence/snapshot/node_modules"
cp tests/integration/adapter-tools/matrix.test.ts "$evidence/snapshot/tests/integration/adapter-tools/matrix.test.ts"
cd "$evidence/snapshot"
```

Exact validation commands, run in that snapshot:

```sh
node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/integration/adapter-tools/matrix.test.ts > ../matrix-baseline.tap 2>&1
node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/integration/adapter-tools-diagnostics/eight-cases.test.ts > ../independent-baseline.tap 2>&1
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node tests/integration/adapter-tools/fixtures.ts tests/integration/adapter-tools/matrix.test.ts > ../typecheck.log 2>&1

DIAGNOSTIC_REVISION=worktree DIAGNOSTIC_MATRIX_REVISION=df5bc453de004a8eb483696cf4ae1986a012cca1 DIAGNOSTIC_MUTATION=append-untyped GIT_DIR=/Users/kjopek/Workspace/safe-bash/.git node --unhandled-rejections=strict --import tsx --import ./tests/integration/adapter-tools-diagnostics/register.mjs --test --test-reporter=tap --test-name-pattern "^readonly: rejects mutation: printf 'changed' >> target\\.txt$" tests/integration/adapter-tools/matrix.test.ts > ../prior-mutant.tap 2>&1
DIAGNOSTIC_REVISION=worktree DIAGNOSTIC_MUTATION=append-untyped node --unhandled-rejections=strict --import tsx --import ./tests/integration/adapter-tools-diagnostics/register.mjs --test --test-reporter=tap --test-name-pattern "^readonly: rejects mutation: printf 'changed' >> target\\.txt$" tests/integration/adapter-tools/matrix.test.ts > ../corrected-mutant.tap 2>&1
```

Here `worktree` means the isolated archive, not the concurrently changing
repository. `GIT_DIR` permits only the loader's read-only `git show` of the old
fixture; both mutation runs otherwise use identical archived production source.
The independent loader is unchanged: only readonly `writeFile` with flag `a`
throws ordinary `Error` with correct `code: "EROFS"` and `path`, without effects;
all other operations, including `appendFile`, retain their implementations.
The independent writing/report harness was not invoked and no independent audit
files were edited.

| Gate | Pass / total | Fail | Exit |
| --- | ---: | ---: | ---: |
| Corrected complete aggregate matrix | 79 / 79 | 0 | 0 |
| Independent eight-case baseline | 8 / 8 | 0 | 0 |
| Prior `df5bc45` append row, same mutant | 1 / 1 | 0 | 0 |
| Corrected append row, same mutant | 0 / 1 | 1 | 1 |
| Strict owned-scope typecheck | successful | 0 diagnostics | 0 |

The expected mutant failure is specifically
`filesystem boundary must reject with an actual FsError`, at the new direct
append-open assertion, not a CLI mismatch or loader/setup failure. Baseline
subtotals are memory **11/11**, real **11/11**, S3 **11/11**, WebDAV **11/11**
(required four **44/44**), mount **12/12**, overlay **12/12**, readonly **10/10**,
and standalone jq split **1/1**. All recorded test runs have **0 skipped, 0 TODO,
0 cancelled**; targeted mutation runs select one row rather than count omitted
rows as passes. The full baseline still uses actual root `agentCommands()` and
all six plugin families. Test-managed real fixtures and mock/loopback services
were cleaned by their existing lifecycle; raw logs remain in the temporary
evidence directory. No source, foreign test, index entry or `.native` directory
was changed by this task, except for the explicitly owned fixture and report.

The **ORIGINAL `6a259ff`** fixture remains a separate cohort: its previously
recorded modern-source result was **71/79**, not 79/79. It was not rerun here;
the unchanged historical **58/79** initial snapshot above is also retained.
These revised-fixture results neither rewrite those observations nor claim
universal provider interoperability. No full filesystem-suite rerun or new
adapter breadth was part of this narrow coverage correction.
