# Python shell stream fragmentation — issue 4185

## Acceptance plan

Reuse the shell adapter delivered by issue 1445; do not rewrite its bridge.
Verify finite-envelope producer-size independence, mixed binary streams, chunk
boundaries and remainders, cumulative budgets, backpressure, cancellation,
early-close settlement, one successful exit and invocation retirement. Qualify
through actual Python in workerd and independently installed public tarballs.
Deliver regression coverage and documentation to remote main. Publication is a
separate outcome; the user explicitly does not require waiting for the release.

## Implementation

`4d791e9b883c2f832c1bae77fd9ea09829a21274` delivers fragmentation before
array serialization. `maxStreamChunkBytes` defaults to 16384 and accepts only
positive finite safe integers. Each fragment awaits admission. Raw cumulative
shell output and serialized cumulative bridge limits remain independent.
Buffered subprocess results retain their whole-result envelope requirement.
No message budget was raised, bytes truncated, private filesystem introduced,
file-size support reduced or native process added.

The dedicated issue worktree adds the exact 262144-byte all-255 reproduction
with both one large write and sixteen smaller writes under the reported finite
budgets. Existing tests cover mixed binary stdout/stderr, exact boundaries and
remainders, backpressure, early close and one terminal event. Added tests cover
partial output followed by shell/bridge cumulative rejection, parent abort while
publishing, retirement and invalid chunk ceilings. The real workerd fixture now
checks both producer write sizes through `poe_shell.Client`.

## Delivery and qualification

The original adapter delivery is verified in remote-main ancestry. Issue-specific
regression/documentation delivery is recorded in the issue completion comment.

An independently installed public candidate `0.0.0-python-shell-1445` passes the
expanded actual Pyodide 314.0.6 / Miniflare 5.20260917.0-alpha /
workerd 1.20260917.1 gate (2/2). The safe-bash tarball SHA-1 is
`18ebb98a2f0df61f1a091fb7c6e4dbaa34979dc7`; all three public packages are
installed from tarballs without workspace symlinks. This establishes public
artifact/runtime qualification, separately from npm publication.

npm latest remains `0.1.753` at verification and predates the stream fix.
No qualifying npm publication or full-release success is claimed. Release waiting
is waived by the user's explicit delivery instruction.

Source-mode replay of the expanded actual Python/workerd gate also passes 2/2.
Maintained `npm test -- --workspace=@poe-platform/safe-bash --
--test-file=tests/plugins/python-shell-capability.test.ts
--test-file=tests/commands/python/host-capabilities.test.ts
--test-file=tests/commands/realpath-missing-admission.test.ts` completes with its
declared build dependencies and postbuild, 704 runner checks, 77 selected passes
(one unavailable native oracle skipped), and the root posttest (2 passes).
Focused ESLint passes with zero errors (four existing unused-symbol warnings
in the filesystem adapter).

## Verification repair

The maintained build revealed a missing `resolvePath` import in synchronous
logical realpath. A focused regression fails with ReferenceError before the
import repair and passes afterward. The concurrent main chmod arity repair is
retained by rebase. These are distinct from the Python adapter implementation.
Temporary verification output belongs in `out/` and is removed after use.
