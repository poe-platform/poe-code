# Independent patch-path regressions

Owned scope: this directory only. Source, contracts, existing tests, root
configuration, adapters and benchmarks are read-only to this verifier.

## Post-fix checkpoint: August 26, 2026

Against committed source `9d6d292febce66d2e7ffa564a059e8f44e4ebff9`,
including explicit-target authorization `e685231032b34f06c34038ce4c443376af7e066d`,
the unchanged suite first reported **619 tests: 615 passed, 4 failed**.
Those four assertions incorrectly rejected valid absolute headers despite a
user-authorized explicit target. They now require success on a distinctly named
explicit target, exactly one target write, and a complete VFS snapshot proving
all header-name decoys and other entries retain their bytes and identities.
All four no-explicit-target counterparts still require rejection before strip.
Traversal, control, drive/backslash, symlink/hardlink, and explicit directory-label
rejection remain unchanged. No security failure became an accepted rejection.

Final result: **619 passed, 0 failed, skipped, TODO, or cancelled**; strict scoped
TypeScript passed. The original 16 directory-label/mail-metadata failures now
pass without changing their assertions. The companion edit-flow suite passed
31/31. No remaining defect was observed within these two suites.

`postfix-checkpoint.json` records both pre/post-contract runs, exact commits,
test hashes, source hashes before/after, scoped typechecks, and native provenance.
Concurrent source edits made the live tree unsuitable as an immutable checkpoint,
so both suites ran in an owned temporary `git archive` of the exact source commit,
with only the three changed test files overlaid. All 102 archived source files
remained unchanged. No source was edited; the temporary snapshot was removed.
The historical validation and native captures below remain intact. This is not
a whole-repository pass or evidence of superiority.

## Historical recorded result: failures retained

On August 26, 2026, three strict-unhandled-rejection runs each reported
**619 tests: 603 passed, 16 failed, 0 skipped, 0 TODO, 0 cancelled**.
The scoped strict TypeScript check passed. Both `.mjs` scripts passed
`node --check`. This is not a product-wide pass.

`validation.json` records the execution timestamps, Node version, HEAD,
individual test-file hashes, tracked source hashes before/after each run,
failure names and TypeScript output. Each recorded run had stable tracked
source hashes. Other workers were active; the working tree was not an
immutable checkout, and the tracked hash set is not every transitive import.
Root/source owners must route fixes and rerun this suite against their final
revision. No failures are skipped, weakened or turned into TODO tests.

## Historical root-routed findings

1. **Directory syntax collapses into a writable regular file: 10 failures.**
   With `target` and `first` containing `old\n`, append a replacement of
   `"a/target/"` to a replacement of `a/first`, then invoke `patch -p1`.
   Current behavior returns 0 and writes both files. `a/target//`,
   `a/target/.`, `a/target/./` and `a/target/./.` behave the same way.
   The five spellings also bypass header validation with an explicit
   `target` operand. Tests require no mutation and status 1 or 2: they do
   not demand an exact native diagnostic/status for the stricter virtual
   header-safety policy. GNU/Apple native probes without explicit operands
   return 1 and leave the target unchanged. The source-level review points
   are `safeTarget` and the subsequent lexical `resolvePath` calls.
2. **Mail envelope hides unsupported metadata: 6 failures.**
   Before a valid patch, a mail preamble silently discards
   `new file mode 120000` or `deleted file mode 120000` (two cases).
   After a valid patch and `-- ` signature boundary, it silently discards
   those same two lines and `similarity index 100%` or
   `dissimilarity index 100%` (four cases). All six currently return 0 and
   mutate the safe section. This violates the assigned unsupported-metadata
   policy; these tests are not native mail-parity claims. Review
   `unwrapPatch`'s preamble and signature classification. Minimal shapes:

   ```text
   Subject: [PATCH] metadata boundary

   new file mode 120000
   --- a/first
   +++ a/first
   @@ -1 +1 @@
   -old
   +new
   ```

   For the signature variant, remove the metadata before `--- a/first`
   and append `-- `, `2.50.1`, then the metadata, each on its own LF-ended
   line. Expected: status 2, no filesystem mutation or success output.

The quoted-path decoder, coherent normalized duplicate updates/dry runs,
conflicting duplicate status 1 with no early writes, and actual Shell
`diff -u | patch` check passed in the recorded run. Neither failure category
is a claim that host path escape was demonstrated: all malicious paths were
executed only against MemoryFS.

## Coverage

- `names.test.ts`: 160 distinct deterministic filenames, each with two
  header encodings (320 cases), plus seven boundary names and one
  simultaneous NFC/NFD/BOM lookalike test. Families cover octal UTF-8,
  literal Unicode, tabs, quotes, spaces, shell metacharacters and glob-like
  characters. Valid cases must return 0, update the exact bytes/inode,
  write only the intended target, and preserve the rest of the namespace.
- `malformed.test.ts`: 51 malformed/unsafe headers in old/new positions,
  with and without an explicit target; seven raw invalid-byte inputs and
  five later-section truncations. Covers octal truncation/range errors,
  invalid UTF-8, invalid escapes, quoted suffixes, encoded absolute paths,
  traversal, drive prefixes, controls and backslashes. Earlier files,
  outside-cwd MemoryFS sentinels, decoy replacement-character paths and
  namespace identities must remain unchanged.
- `sequences.test.ts`: repeated separator/dot strip counting; directory
  syntax; three normalized duplicate pairs with coherent apply/dry-run
  and status-1 conflicts; octal/normalized final and ancestor symlinks,
  hardlinks, and distinct names for one inode. Unsupported aliases remain
  status 2 rather than mutating aliased bytes.
- `envelopes.test.ts`: a positive quoted-Unicode/tab mail control,
  malicious/truncated later sections on both sides of a signature boundary,
  unsupported rename/copy/mode/binary metadata, and unknown between-section
  metadata. Arbitrary plain signature prose is not treated as metadata.
- `bounds-shell.test.ts`: a valid 4,079-byte path represented by a
  16,318-character quoted header; explicit quoted/path/depth limits; input,
  work and file budgets; cancellation of a bounded 384-file quoted batch;
  and a real Shell pipeline with explicit `diff -u` after checking normal
  diff's default `1c1` output. Native filenames do not test huge paths.

The helpers reuse actual `MemoryFileSystem` and the existing structural
filesystem instrumentation/snapshot helper, not casts or permissive mocks.
Snapshots exclude timestamps because reads can change atime; they retain
paths, types, modes, device/inode/link identities, symlink targets and bytes.
Positive tests restore only the expected target bytes through the backing
MemoryFS before comparing the complete identity/content snapshot.

## Independent primary evidence

Official documents consulted through `web.run` on August 26, 2026:

- GNU Diffutils manual, “Applying Patches in Other Directories”:
  `https://www.gnu.org/software/diffutils/manual/html_node/patch-Directories.html`
  defines adjacent slash runs as one slash for `-p` counting. All strip
  probes specify a count explicitly; they do not assert GNU default-strip
  parity for the virtual command.
- GNU Diffutils manual, “Multiple Patches in a File”:
  `https://www.gnu.org/s/diffutils/manual/html_node/Multiple-Patches.html`
  describes applying sections as separate patches. The no-early-write
  requirement is the assigned staged-preflight contract, not GNU rollback
  behavior and not Git rename/swap metadata support.
- Git `diff-format` and `git-config` (`core.quotePath`):
  `https://git-scm.com/docs/diff-format.html`
  `https://git-scm.com/docs/git-config#Documentation/git-config.txt-corequotePath`
  describe quoting unusual pathname bytes. The encoder uses byte-level
  octal output independently of the implementation decoder.

`native-evidence.json` is the full independent safe capture, including
explicit executable paths, versions, SHA-256 hashes, inputs, statuses,
stdout/stderr and resulting target bytes. The readonly binaries inspected
were GNU patch 2.8, GNU diffutils 3.12, Apple patch 2.0-12u11, and Apple Git
2.50.1 (Apple Git-155); GNU diff was version/hash inspected only.

The native matrix has 20 path probes (ten per patch binary): five safe
repeated-separator/dot cases apply and five directory-syntax cases reject
for each binary. Five additional patches are generated by the actual Git
binary; GNU patch applies four. The fifth, an unquoted leading/trailing-space
filename, is rejected by GNU patch and remains visible in the capture.
The macOS host/Git reports the decomposed `e` + combining acute filename as
composed `é`; this native capture is not evidence of byte-distinct Unicode
normalization semantics. The separate MemoryFS test verifies that contract.
No native discrepancy is removed from these denominators or called a
product pass. Quoted trailing-space inputs still must succeed virtually.

Native probes run only fixed, safe, relative cases with literal argv, no
shell expansion, disabled Git external/textconv execution, isolated HOME
and TMPDIR, a three-second process deadline, and temporary directories under
this owned subtree. They never consume the malformed/adversarial corpus.
The temporary namespace is removed after each capture. Do not replace the
recorded evidence with a diagnostic rerun; retain reruns separately.

## Reproduce

From the repository root:

```sh
node tests/commands/diff-patch-stress/path-regressions/run.mjs
node_modules/.bin/tsc --noEmit -p tests/commands/diff-patch-stress/path-regressions/tsconfig.json
node tests/commands/diff-patch-stress/path-regressions/capture-native.mjs
```

The first command emits a JSON report and exits nonzero on retained test
failures. It bounds the suite process to 60 seconds. The native capture
requires the exact explicit binaries to exist, prints evidence rather than
rewriting files, and is a capture command, not a claim that all native
outcomes succeed. No new dependencies or root scripts are introduced.

Cancellation is cooperative; individual decoder work is synchronously
bounded by source limits. These tests do not promise interruption of an
uncooperative host operation, race-free lookup/write identity, universal
symlink security, host rollback, universal Bash compatibility, scope
completion, or superiority over another package.
