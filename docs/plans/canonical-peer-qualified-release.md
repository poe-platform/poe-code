# Canonical peer qualified-release repair

Date: August 30, 2026. Baseline: `c88efaed74968bc27e879b87bae23b44ec01b198`.

## Authorized scope

Exactly ten paths: the two current qualification scripts; the stream public
checks; metadata canonical runner; new shared `peer.mjs`; new
`canonical-peer.test.ts`; qualified-release README; this plan; and the package
manifest/lock for dev-only `memfs@4.56.10`. No other product, fixture, inventory,
historical manifest or filesystem implementation is changed.

The already committed canonical migration remains intact. The required peer is
`poe-code >=13.0.0` with an exact development pin of `13.0.0`. Publication of
safe-bash is not part of this work; no remote is configured or created.

## Root causes and bounded repair

The real c88efaed qualified job copied virtual-bash without its required peer,
so all 25 current consumer groups failed before emitted execution. Its mandatory
metadata phase also reread retired private source paths from a historical source
manifest and failed before running its unchanged 318 cases. A later packed
consumer had the same missing-peer setup by inspection.

One helper authenticates the explicitly supplied published artifact and stages
only the public runtime/declaration closure in both consumer layouts. Existing
declaration binding and source-fallback checks are reused, not replaced by broad
node_modules permission. Exact byte/file-set checks survive moving the consumer.
The fixed version, registry URL, SRI, metadata, public exports, build tool bytes,
runtime import edges and declaration closure must all agree. Unsupported archive
types or import dependencies fail closed; nothing is installed by the harness.

Metadata verification receives the real snapshot's current source inventory as
an explicit profile. Historical test and oracle inputs stay present and checked.
Missing, modified, extra or redirected current source entries fail. The default
historical profile remains unchanged; no missing-file filtering or hash reseal
is permitted. The original 318-case and 22-native-row assertions remain exact.

## TDD and dependency evidence

Evidence stage: `/tmp/safe-bash-qualified-repair.ocdgKi`.

- Ten approved beforehashes, six protected fixture hashes, the empty index and
  unrelated status census were checked before editing.
- Normal npm resolution of exact memfs 4.56.10 adds 27 dev-only lock entries;
  every pre-existing lock package record remains identical. Registry SRI,
  dependency metadata and licenses are retained in the stage. An initial
  logical `/tmp` prefix resolution produced unsuitable relative lock paths and
  was rejected without application; rerunning in the physical directory
  produced the verified additive lock. No dependency upgrade or formatter was
  introduced. A fresh candidate `npm ci --ignore-scripts` succeeds.
- The 41 new memfs unit cases first fail before implementation, then pass:
  archive/peer refusal, metadata/runtime/declaration tampering, unsupported
  imports, symlink and source fallbacks, moving the admitted consumer, and
  current/historical source selection. No unit test creates native files.
- The actual published peer binds successfully to four runtime and 26
  declaration files. This is artifact admission, not a service/backend claim.
- The shell build passes and the source/test type diagnostics remain the same
  33 lines as the retained baseline. These failures are not waived.

## Commit-bound acceptance procedure

Commit only these ten paths on local main with normal Conventional Commit and
hooks. Then validate a real clone at that exact commit using the existing native
assets and explicit published peer13 tarball. No invented commit, working-tree
source overlay, private FS restoration, historical exclusion or false green is
allowed. A precommit helper/unit result is not commit-bound wrapper acceptance.

Run the actual qualified wrapper, new/adjacent harness tests, scoped migration
and cancellation cohorts, current public types, S3 committed/WORKTREE checks,
and installed SDK/shell identity/recovery. Keep positive types separate from
emitted runtime and provider execution; retain all expected negative controls.
Record actual results in a fresh receipt rather than predicting a green job.

The unrelated broad 136 failures, 25 cancellations, 33 type diagnostics and four
protected historical FS expectations remain explicit out-of-scope gates. Their
fixtures, old red/green receipts, 845 ownership and 573 original canonical
assertion maps stay unchanged. No cleanup deletion, branch or push is authorized.

## First actual-commit result and owned follow-up

The normal ten-path commit is `410fe17d40129696c2bca7f44abd9327b256b7cc`.
Its actual qualified wrapper admits the peer, compiles all 25 current consumer
groups, and passes the unchanged native archive 11/11 and metadata 318/318 with
all 22 native rows. The snapshot is retained under
`qualified-current-consumers-SP05BV` in the system temporary directory.

One current consumer imports only the public timeout leaf. An existing file-list
guard incorrectly required `dist/index.d.ts` even though the exact public leaf
resolved and compiled. Eight new memfs cases reproduce that admission mismatch
and reject empty, foreign, source, unknown, changed and symlinked declarations.
The follow-up uses the existing exact declaration binding for every listed
candidate declaration and retains per-import public export checks. It does not
permit arbitrary declarations or discard the positive candidate-resolution guard.
The shared guard is used by both consumer paths. All 49 new units plus 24
adjacent coverage controls pass; the source diagnostics remain unchanged.

The first full wrapper still fails two of its 18 generated current stream cases:
the generator expects 70 commands, while the independently reviewed maintained
catalog is 80. The original frozen input remains byte-identical. The generator
`tests/plugins/stream-five-public/current-profile.mjs` is outside the ten-path
scope; its exact SHA-256 and a one-path approval request are recorded in the
evidence stage. No generator, historical fixture or count is silently changed.
This result is not a qualified release pass.
