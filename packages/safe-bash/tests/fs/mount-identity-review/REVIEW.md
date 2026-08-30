# Independent mount identity review — initial RED checkpoint

## Result and provenance

This is the requested independent leaf checkpoint, not fixed-revision acceptance.
Only new files in `tests/fs/mount-identity-review/` belong to this verifier.
No delegation, product/contract/original-test edits, historical-report edits,
dependency installation, unrelated suites, or root-document changes occurred.

| Frozen committed source | Original repro | Independent review | Scoped strict noEmit |
| --- | --- | --- | --- |
| `3731587fa287333ca59c7a81569b367cec66f61d` | 1/4 pass, 3 fail | 10/19 pass, 9 fail | exit 0 |
| `b98e239374ccdb53860c88f41b06a4bc977ecc1d` | 1/4 pass, 3 fail | 10/19 pass, 9 fail | exit 0 |

Each gate ran once per pin, with zero skips, TODOs, and cancellations. These are
two revision cohorts, not 46 different cases. The independent cases deliberately
overlap the three original aliases; do not add their denominators as new coverage.
The 15 archived `src/` files are byte-identical between these pins. The current
column means the frozen committed checkpoint, not a moving working-tree fix.

Captures ran on August 26, 2026, from 22:45:01.868 to 22:45:05.029 UTC, using Node
22.22.2, TypeScript 5.9.3, tsx 4.23.12, Darwin arm64, and existing development
tooling. This records actual capture time, not the total duration of project work.
Each JSON records archive SHA-256, per-file Git blobs/SHA-256, tool versions,
commands, exit statuses, full before/after observations and ordered call events.
The original TAP and new TAP are retained as separate raw `stdout` strings in
each JSON, preserving whitespace through JSON escaping. Frozen inputs were checked
again after execution and remained unchanged. Owned temporary archives and real
fixture directories were removed by their creating harnesses.

`tests/fs/mount/copy-identity.test.ts` was read from the actual commit, then run
unchanged inside the owned archive. Its original `d4f5e53d20c7c748ee6a3fc1d867f94ae7ca42db`
SHA-256 is `e752e633abc902025670c09305c09e7319b171549350ddec7573b6644d29d115`;
both pins match. The supplied historical report at
`/tmp/safe-bash-fs-3731587-refresh-kMXBVH/REPORT.md` was read, hashed, and not changed.
Source hashes include:

- mount: `539f22e42f7505aaa20fa643ebeecf1a5b7a1e21f1fb2596fbd7e8fa2d7ae5e0`
- real: `4977b7780b067cdd16bd8c128982758cd3401d2f72864f786981d2c315b74f82`
- filesystem contract: `7c63db5052a28014ac185f86e6b97d2c3ef00ce61b80638baa850a6933f57457`
- independent test: `2bc38df054648975d1c66e7a445c6efcb761b69802b57ade24ff736737837845`

## Nine destructive alias cases

All nine public `MountFileSystem.copyFile` calls unexpectedly resolve, leaving
the original 30-byte source **empty**, not merely returning the wrong error:

1. Separate real instances, same root and same pathname.
2. Separate same-root real instances, hardlink destination.
3. Separate same-root real instances, symlink destination.
4. Nested source mount retaining the same real pathname.
5. Readonly over nested source mount retaining a real hardlink alias.
6. Overlay source reading its real lower, direct alias destination on that lower.
7. Overlay source reading its real upper, direct symlink destination on that upper.
8. Two transparent instrumented views of one memory backend, same pathname.
9. Nested target mount and a hardlink in the shared memory backend.

The preserved snapshots include every source/target root entry, file bytes as
base64 and SHA-256, modes, device/inode/link counts, and symlink text. Read atime
and mutation ctime are not asserted immutable. Namespace comparison is additional
to byte comparison. The intended error is `FsError` with `code: EINVAL`,
`syscall: copyFile`, and exact *outer virtual* source/destination paths. No target
write entry is permitted before rejection. Assertions remain RED; error-null and
byte loss are not characterized as successful guest semantics.

For the direct real cases the actual instrumented order is:

`readStream.acquire -> writeStream.enter -> readStream.next -> readStream.return -> writeStream.complete`

There is **no source chunk**. Readonly/overlay laziness can defer even the lower
read-stream acquisition until after the real target's `writeStream.enter`.
These are actual public/backend call observations, not native-open interception.
Source inspection connects that trace to real `writeStream` opening with
`O_TRUNC` before its `for await`, and memory `writeStream` calling `openWrite`
before consuming input. The public mount method is never replaced or bypassed.

## Ten controls and preservation cases

- Independent memory filesystems with deliberately equal synthetic `dev=7`,
  `ino=11` still copy different bytes. Raw stat-number equality is not identity.
- Different same-root real files containing equal bytes still perform a copy;
  different real roots with the same local pathname remain copyable.
- An existing exclusive real hardlink alias rejects exact `EEXIST`; a readonly
  destination rejects exact `EROFS`. Full root snapshots remain unchanged.
- An exclusive destination is deterministically created as a source hardlink
  after source-stream acquisition and before target write entry. The real writer
  receives `wx`, rejects exact `EEXIST`, and preserves the entire independently
  inserted namespace/bytes/inodes. `insertedState` is captured before publication.
- A synchronous injected source-acquisition `EIO` preserves the real destination,
  with only the source acquisition event and no target write entry.
- An overlay incoming stream emits a real source chunk, then fails with `EIO`.
  Existing published target and both underlying layers are preserved; staging
  entries are cleaned and no target rename is attempted.
- Overlay publication receives injected `EACCES` at upper `rename` *before any
  rename effect*. Its preexisting destination survives, source/lower snapshots
  match, and temporary entries are cleaned. The trace proves staging and the
  attempted publication, not a skipped write path.
- An exclusive overlay target appears during incoming stream consumption. The
  writer revalidates and rejects exact `EEXIST`, preserving the independently
  inserted target's bytes, inode and metadata, with no publication rename.

Every failure-control checks typed error/code/syscall and exact outer paths.
Successful stream assertions require real acquisition, chunk transfer and write
completion without unnecessarily prescribing whether source consumption starts
before or after writer entry. The events preserve the observed total order.
Test-only proxies bind original methods and preserve ordinary property access;
they do not invent an identity field, cast around a missing interface, or inspect
private decorator state.

## Root/author handoff: required semantics and limits

The committed cross-mount path has no alias preflight. Comparing mount records,
backend object references, local paths, or globally comparing optional `dev/ino`
cannot establish the needed general identity relation. Real instances can share
one native inode; memory instances can reuse the same metadata numbers; wrappers
must retain the selected underlying reader's identity. A same-object/same-path
shortcut alone does not solve these nine cases. Eagerly reading one chunk is
also insufficient: a later truncating target open can destroy the unread tail.

The author must route an identity-contract proposal through the root to Curie,
the contract owner. No new optional contract field is assumed by this review.
The proposal needs trusted identity scope, same-object comparison across real
instances, wrapper propagation, final-symlink policy, and a distinction between
overlay visible-read identity and the object affected by copy-up/publication.
The overlay alias cases here deliberately write **directly to the aliased real
layer**; they do not prejudge whether a copy-up into an unrelated upper counts
as a same-file error.

Generic mount writes are documented nontransactional. Accordingly this suite
does not promise rollback after a real write has begun, snapshot isolation,
hostile nonexclusive path-swap safety, or race-proof identity based on a metadata
precheck. An atomic/handle-based seam would be needed for stronger guarantees.
Overlay failed-publication controls use its actual documented prerequisite:
an atomic upper rename that leaves its paths unchanged when it fails. They do
not simulate an upper that modifies the target and then dishonestly rejects.

Concurrent uncommitted author changes were observed but not overlaid into either
pin, modified, staged, or accepted. In the intermediate diff inspected after the
captures, mount added a same-backend/same-local-path check and `wx` for previously
missing targets; real added a metadata precheck. Those are not evidence of the
missing cross-instance/wrapper identity fix. Changing nonexclusive copies to
exclusive whenever preflight saw a missing target also needs an explicit
compatibility/race-policy decision; this suite's race controls explicitly request
`exclusive: true` and do not endorse changing ordinary overwrite semantics.
The intermediate overlay diff changed the same-path **rename** branch rather
than its copy branch; the author should check that this is intentional. This is
a point-in-time review concern, not a claim about the author's eventual patch.

## Guard mutation review: explicitly pending

The source-author identity fix was not available in either frozen revision.
No guard-removal mutant ran, and **no mutation kill or fixed-revision pass is
claimed**. Removing a nonexistent guard from already-red source is meaningless.
The deterministic target-creation, input-failure and publication-failure
injections above are completed preservation evidence, not guard-mutation kills.

On the parent's fixed-revision resume, freeze the delivered revision and exact
identity-contract source closure; rerun these unchanged expectations and original
tests. Then remove/alter each relevant guard only in an owned temporary archive
or an in-memory loader, record the exact original/mutant SHA-256 and diff, and
require the applicable semantic assertions to fail while controls still work.
Mutants must continue through public `MountFileSystem.copyFile`; do not bypass it
or weaken byte/namespace/native-VFS expectations to make a test green. Cover
alias guard removal, loss of wrapper identity propagation, false synthetic
identity collisions, and preservation/late-exclusive checks where the delivered
contract supports them. This checkpoint can be committed without waiting for
that separate author delivery.

## Reproduce

From the project root, the focused live commands are:

```sh
node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 tests/fs/mount-identity-review/identity-review.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tests/fs/mount-identity-review/tsconfig.json
```

To capture another immutable committed cohort, use a **new** evidence label:

```sh
node tests/fs/mount-identity-review/capture.mjs REVISION unique-label
```

The capture harness freezes selected committed inputs beneath this owned
subtree, overlays only the independent tests, uses existing development tooling,
runs original/new tests and scoped noEmit, verifies input stability, and adds
generated evidence using `apply_patch`. It refuses to rewrite old evidence,
cleans only its own temporary archive, and exits nonzero for any failed gate.
Its present source closure and pending-mutation annotation are for this initial
checkpoint; extend the closure and add the separate mutant runner on resume if
the delivered fix introduces new modules. Native subprocesses are used only by
the test capture harness, never by product code.
