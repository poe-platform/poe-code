# diff3 engine qualification

Scope: the `engine-diff3` task. Report, merge/ed serialization, CLI options and
command/SDK VFS adapters remain separate tasks. No shell command is registered
by the engine export.

## Repeatable checks

1. Run `npm run test:unit --workspace=safe-bash-command-diff3` and
   `npm run lint --workspace=safe-bash-command-diff3`.
2. Build the explicitly selected safe-bash closure using
   `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`.
   For fresh engine compilation, use the same route with
   `--workspace=safe-bash-command-diff3 --no-cache`.
3. Exercise the generic artifact boundary with the focused maintained tests:
   `npx vitest run --config vitest.root.config.ts scripts/bundle-safe-bash-private.test.ts scripts/safe-command-publication.test.ts scripts/package-safe.test.ts`.
4. Run the maintained `scripts/package-safe.mjs` builder into a temporary
   workspace `out/engine-diff3` directory with an explicit development version.
   Copy the resulting safe-bash artifact into a consumer's
   `node_modules/@poe-platform/safe-bash`, without any private workspace.
   Copy `scripts/fixtures/safe-packages-diff3.mjs` and its `-types.mts` companion
   into that consumer. Run the runtime fixture with Node's permission model
   allowing filesystem reads only inside the consumer. Compile the type fixture
   using strict NodeNext module resolution. Ancestor checkout modules must be
   inaccessible to the runtime witness.
5. As development-only research, acquire the official GNU diffutils 3.12 archive
   from `https://ftp.gnu.org/gnu/diffutils/diffutils-3.12.tar.xz`, verify SHA256
   `7c8b7f9fc8609141fdea9cece85249d308624391ff61dedaf528fcb337727dfd`,
   and build with `./configure --disable-nls` and `make -j4` inside `out`.
   Re-run the 18 alignment fixtures in
   [the independent controls](safe-bash-diff3-native-controls.md) using its
   matching GNU diff via `--diff-program`, C locale, and unset POSIXLY_CORRECT.
   Compare exact native output/status/diagnostics with the captured controls.
   Inspect the engine's three corresponding line ranges for each block against
   those outputs, treating adjacency as GNU DIFF_ALL. This is an engine boundary
   witness, not validation of a shipped merge renderer.
6. Purge temporary archives, build logs, operands, artifacts and consumer files.
   Screenshots are unnecessary for this engine-only change: it has no visual
   CLI surface.

## Recorded execution: 2026-09-19

The initial engine contract tests failed against unimplemented entrypoints,
then passed after implementation. The final engine suite has 33 passing tests,
including byte ownership/invalid UTF8, chunk splitting, newline metadata,
explicit CR comparison, binary admission, adjacent/overlapping/identical edits,
transitive regions, 18 horizon controls, replay across byte realms,
post-spool work exhaustion, cancellation inside comparison and cleanup.
A deterministic 100-case repeated-line corpus additionally reconstructs variants
from returned edits; it makes no native tie-parity claim.

Package lint/typechecking and focused ESLint checks passed. A fresh uncached
engine build and the selected safe-bash closure built successfully. Generic private-artifact
tests passed 164 assertions across three test files. The guarded package builder
produced safe-bash with diff3 implementation/declarations inside its artifact.
The consumer runtime passed with reads restricted to the consumer tree, and its
strict NodeNext type fixture compiled successfully. The artifact required no
private workspace installation.

The freshly built archive's SHA256 matched the pinned release. All 18 native
alignment outputs, statuses and diagnostics matched the captured controls, and
all corresponding engine ranges matched those outputs. This qualifies only the
specified 99/100/101 repeated-prefix/suffix swap, insert/delete and nested-block
fixtures, both with and without final LF.

The engine explicitly rejects GNU's costly-search shortcut at its default
cutoff with `ALIGNMENT`; work/graph/token/payload exhaustion is `LIMIT`.
There is no implicit minimal-mode switch or greedy fallback. Its byte buffers,
token counts and logical graph slots are bounded independently; these counters
do not claim exact JavaScript heap or RSS accounting. Stream/VFS adapters must
register disposal before acquisition and enforce file/stdin admission when
implemented. No command package was published, committed or pushed.

## Current-workspace review: 2026-09-19

The engine and export implementation already existed when this review began;
no product code was changed or unrelated edits reverted. Reviewed tokenization,
pairwise alignment, region classification, ownership transfer, failure cleanup,
cancellation and logical resource accounting against the engine task. The
existing diff-patch implementation uses decoded strings and a quadratic matrix,
so it does not meet this byte-preserving alignment contract.

Fresh checks passed: all 33 engine unit tests, package lint and both source/test
typechecks, the uncached selected safe-bash workspace build closure, and all 164
focused artifact/publication assertions. An additional in-memory probe exercised
10,000 independently generated three-input repeated-line cases, reconstructed
both variants from their edits and checked every region range against its file.
This probe validates reconstruction and range bounds, not GNU tie parity.

The maintained package builder staged version `0.0.0-engine-diff3-review`. Its
safe-bash artifact alone was copied into a consumer outside the checkout; no
private workspace was installed. The maintained diff3 runtime fixture passed
under Node 22.22.2 permissions restricted to reads inside that consumer. Its
strict NodeNext declaration fixture also passed with exact optional properties
and unchecked indexed access. These are staged-artifact checks, not a fresh
tarball installation or browser/workerd qualification. Native GNU controls were
not rerun; their earlier scoped receipt remains above.

No unresolved engine finding was identified. Report/merge/ed output, option
parsing and command/SDK VFS adapters remain separate tasks. `/out` is read-only
on this host; review artifacts used a unique canonical `/private/tmp` directory
and were purged. An initial `/tmp` staging attempt was correctly rejected by the
native-asset symlink guard; canonical-path staging passed without changing it.
Local commits: none. Remote-main delivery: none. Releases/publication: none.
