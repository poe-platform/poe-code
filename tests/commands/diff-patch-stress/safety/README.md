# Independent diff/patch safety verification

## Reconciliation update

This historical checkpoint is retained below. Current fixture reconciliation
is in `../compatibility/RECONCILIATION.md`, with three-suite strict snapshot
reports in `../compatibility/reconciliation-*.json`. Source is read-only here.
The Shell filename-label pipeline explicitly selects `diff -u` after the
intentional normal-default change. Four contradictory same-target aliases now
expect conflict status 1, still requiring empty stdout, zero mutation calls,
and unchanged complete namespace snapshots. This followed 16 passing coherent
forward/reverse/apply/dry-run controls on the same four alias pairs. Unsafe
headers, symlinks and hardlinks retain their original security expectations.

## Historical author checkpoint

This leaf owns only `tests/commands/diff-patch-stress/safety/**`. Source,
author tests, filesystem implementations, and other verifier subtrees were
read-only. The inspected author revision is
`cd49267c9792c02c6dd9b6ac8a7cffd81c7eaa69`. No product fixes are included.

## Recorded result: August 26, 2026

Node `v22.22.2`, TypeScript `5.9.3`:

| File | Tests | Pass | Fail |
| --- | ---: | ---: | ---: |
| `paths.test.ts` | 38 | 38 | 0 |
| `failures.test.ts` | 32 | 32 | 0 |
| `cancellation.test.ts` | 23 | 23 | 0 |
| `bounds.test.ts` | 28 | 28 | 0 |
| `integration.test.ts` | 6 | 6 | 0 |
| `encoding-gaps.test.ts` | 8 | 5 | 3 |
| Total | 135 | 132 | 3 |

The complete command exits **1**, intentionally exposing all three unmet
common-flow acceptance cases. There are zero skipped, cancelled, or TODO tests.
The 23 cancellation tests additionally passed ten complete strict-rejection
repetitions: **230/230 additional executions**, not 230 distinct cases.
Strict scoped TypeScript validation passed. The 180-value work-budget sweep is
one test, not 180 tests, and observes preparation failure, partial commit, and
success. No whole-product result or superiority claim is implied.

Run from `/Users/kjopek/Workspace/safe-bash`:

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/diff-patch-stress/safety/*.test.ts
node_modules/.bin/tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --target ES2023 --lib ES2023 --types node --module NodeNext --moduleResolution NodeNext --skipLibCheck tests/commands/diff-patch-stress/safety/*.ts
for iteration in {1..10}; do
  node --unhandled-rejections=strict --import tsx --test tests/commands/diff-patch-stress/safety/cancellation.test.ts || exit "$?"
done
```

## Reported failures and minimal reproductions

All three failures were explicitly reported before committing this subtree.
They are **documented implementation limitations that fail the broader
common-flow requirement**, not newly discovered arbitrary-write vulnerabilities
or violations of the author's narrower documented subset. Rejection leaves the
complete virtual namespace, bytes, modes, and inode/link identity unchanged in
these reproductions. Safe rejection is not counted as successful application.

### G1: Git octal-encoded UTF-8 filename rejected

Fixture: `/sandbox/work/café.txt` contains `old\n`; cwd is
`/sandbox/work`; invoke `patch -p1` with these literal input bytes:

```diff
--- "a/caf\303\251.txt"
+++ "b/caf\303\251.txt"
@@ -1 +1 @@
-old
+new
```

Expected: exit 0; exactly that inode contains `new\n`; unrelated sentinel is
unchanged. Observed: exit 2, `patch: unsupported or empty patch filename`, no
mutation. Root cause: `src/commands/diff-patch/unified.ts:16` rejects every
header starting with a double quote before decoding.

### G2: Git escaped quote filename rejected

Fixture: `/sandbox/work/quote"name.txt` contains `old\n`; invoke `patch -p1`:

```diff
--- "a/quote\"name.txt"
+++ "b/quote\"name.txt"
@@ -1 +1 @@
-old
+new
```

Expected: exit 0, exact intended target bytes and identity. Observed: the same
exit 2 and diagnostic as G1, with no mutation. The same unconditional quoted
header rejection is responsible. Tests include a realistic `diff --git` and
regular-file `index` preamble; neither preamble is required for the failure.

Required source work for G1/G2: bounded, strict Git/C filename decoding;
byte-oriented octal handling with valid UTF-8; then validation of the decoded
path before stripping or target selection. Preserve rejection of encoded
traversal, absolute paths, NUL, unknown escapes, and out-of-range octal bytes.
Five passing negative encoding tests remain beside the failing positive tests.

### G3: safe adjacent-slash strip rejected

Fixture: `/sandbox/work/target` contains `old\n`; invoke `patch -p1`:

```diff
--- a//target
+++ b//target
@@ -1 +1 @@
-old
+new
```

Expected: exit 0, update only `target` to `new\n`. Observed: exit 2,
`patch: unsafe patch path: "a//target"`, no mutation. Root cause:
`src/commands/diff-patch/patch.ts:53` rejects every empty component before
strip processing, rather than distinguishing safe adjacent separators from
absolute or traversal paths.

Required source work: treat adjacent separators consistently in the relative
strip algorithm while still rejecting leading absolute paths, traversal,
controls, and invalid decoded paths, and retaining path/depth budgets. This
conflicts with the author's current explicit empty-component rejection policy
and an author test. The root/source owner must reconcile that policy with the
broader user requirement; this verifier did not edit or weaken the author test.

### Primary-source basis

Browsed official documentation on August 26, 2026; no native tool execution was
used as an oracle:

- Git diff-format, section “Generating patch text with -p”, documents quoted
  unusual pathnames: `https://git-scm.com/docs/diff-format`.
- Git `core.quotePath` documents C escapes, UTF-8 bytes represented with octal
  escapes, and default quoting:
  `https://git-scm.com/docs/git-config/2.51.1.html`.
- GNU Diffutils, “Applying Patches in Other Directories”, defines an adjacent
  slash sequence as one slash for `-p`:
  `https://www.gnu.org/software/diffutils/manual/html_node/patch-Directories.html`.

These sources establish the common input encodings and strip behavior, not
an assertion that this implementation already claims full GNU/Git parity.

## Safety coverage and algorithm findings

- Complete-tree snapshots compare file bytes, types, modes, inode/device/link
  identity, and symlink destinations. Timestamps are excluded: reads may update
  access times, so a successful dry-run means no command mutator calls and no
  namespace/content/identity changes, not zero atime activity.
- Unsafe later sections, duplicate normalized/stripped targets, malformed
  counts, integer overflow, repeated headers, binary data, oversized paths,
  and preparation limits leave earlier targets intact. Normalized Unicode,
  decomposed Unicode, spaces, percent-looking names, and shell metacharacters
  are exercised as literal accepted names, not just rejected input.
- Symlink targets, dangling links, symlink cwd/ancestors/input files, reported
  hardlink aliases, directory targets, missing parents, and non-directory
  parents are checked with complete snapshots, not only exit codes.
- Structural VFS injection exercises `lstat`, buffered/streaming reads,
  directory listings, writes, and deletion. Permission and I/O failures in
  later preparation do not leak buffered diff output or patch writes.
  Both commands use `lstat`, not `stat`, in inspected paths; the structural
  adapter also provides the required `stat` contract.
- `src/commands/diff-patch/patch.ts:125` commits sequentially with direct `rm`
  and `writeFile`; creation uses `wx`, existing files use `w`. There is **no
  atomic-publish rename or temporary-file cleanup phase**. The rename fault
  trap remains uncalled even with `atomicRename: false`; that is a verified
  absence, not claimed rename-failure recovery coverage.
- First/middle/last write and deletion failures preserve the completed prefix
  and never attempt later targets. A failing operation may itself mutate and
  is not counted successful; tests assert that documented state explicitly.
  A competing creation survives `wx` failure and no cleanup unlink occurs.
  Status-sink failure after commit does not roll back the files.
- Deterministic barriers cover blocked preflight stat/read/stream, stdin next,
  iterator cleanup, write/delete publication, and stdout/stderr waits. Exact
  abort reasons include Error, object, string, Symbol, null, zero, and false.
  Late rejection is observed under strict unhandled-rejection mode. No fixed
  sleep threshold is used; timeout caps only bound stalled tests.
- An uncooperative in-flight write is deliberately allowed to finish after
  rejection, matching the supplied contract. The already committed prefix
  remains, and later target commands never start. Product-supplied signals
  are verified in injected request paths.
- A deterministic replacement with an equal-content new inode passes the
  precommit comparison and is overwritten. This is a characterization of
  `src/commands/diff-patch/patch.ts:117` checking type/existence/content, not an
  inode lock. It is **not** classified as a violation of the documented
  nontransactional policy or as proof of race-free behavior.
- `src/contracts/filesystem.ts:74` has no no-follow opened file handle,
  conditional unlink, exclusive/no-replace rename, or identity compare-and-swap
  operation. Symlink/parent replacement after inspection therefore remains
  a high-risk boundary. Repeating `lstat` cannot establish race-free POSIX
  guarantees. Optional `nlink` cannot establish alias safety when an adapter
  omits it. A genuine stronger guarantee requires an explicit contract and
  adapter design; no host fallback or invented cast is appropriate.
- Six actual `Shell.use(diffPatchCommands())` tests cover literal-label
  piping, hostile heredoc input, read-only dry-run input outside cwd, partial
  commit, exact cancellation, and hardlink aliases. These use the real shell,
  not a substitute parser or a fake plugin host.

## Capability and validation limits

This is a bounded deterministic safety investigation, not a full compatibility
or fuzz suite. It does not establish real-filesystem race freedom, hardlink
protection without reported metadata, transactionality, binary patch support,
unbounded algorithms, full shell compatibility, performance superiority, or
72 hours of work. No optional RealFileSystem tests were run. All adversarial
paths and side effects exist only in MemoryFileSystem, and no host paths are
targeted. Product source was inspected for use of the supplied VFS; no native
execution was added. Helpers use Node builtins and existing project code only.

The scoped run compiles imported shell/contracts/memory sources but does not
represent whole-repository typechecking. Concurrent unrelated changes were
left untouched. Only this subtree is staged and committed.
