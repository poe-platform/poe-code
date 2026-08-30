# Read-only VFS Git — M1B author candidate

This module is not registered by the package root or default plugins. Its local
API is createGitCommand(options), createGitCommands(options), and gitCommands(options).
GitCommandsOptions accepts only replace:boolean and discoveryBoundary:absolute
VFS path. All limits are fixed; unknown option keys/accessors are rejected.

The implementation reads genuine SHA1 loose zlib objects, directory/bare Git
repositories, packed-refs, DIRC v2/v3 working indexes and bounded pack v2/v3 with
SHA1 idx v2 through FileSystem. This is an author candidate, not independent
acceptance or ordinary packed-repository readiness. It never
spawns Git, runs hooks/filters, reads process environment/host paths, fetches,
executes configuration or mutates the repository. Node crypto/zlib are library
APIs; there are zero runtime dependencies. Read-only access may change provider
access times; namespace/content races are detected where observed, not atomic.

Supported commands:
- status --short/-s/--porcelain[=v1], -z, -uno/-unormal/-uall, --no-renames.
- diff [--cached/--staged] [REV], diff REV REV, -p/--patch, -U0..100,
  --name-only/--name-status/-z, --quiet/--exit-code, --full-index,
  --no-renames/--no-ext-diff/--no-textconv/--no-color.
- log --first-parent --format=%H or --format='%H %s' or --oneline,
  -n/--max-count=0..2000; show --no-patch with the two explicit formats.
- show REV:path emits verified raw blob bytes, including binary content.
- rev-parse REV/--verify REV, --show-toplevel, --absolute-git-dir,
  --is-inside-work-tree, --is-bare-repository.
- ls-files [--cached] [--stage/-s] [-z].

Global --no-pager, up to eight -C, and --literal-pathspecs are accepted. Paths after
-- and status/ls-files operands use component-prefix literal selection, effective
cwd relative. :(literal) admits wildcard characters. Other magic/globs refuse.
REV accepts HEAD, full40hex, fullref or unambiguous heads/tags shorthand and
left-to-right ^/~ counts. No reflogs/ranges/abbreviated input IDs. REV:path is
repository-tree relative. Output abbreviations use the bounded loose+packed OID census.

Promisor storage, alternate/shallow/replace/graft/reftable storage,
gitfiles/linked worktrees/commondir and unsupported formats refuse BEFORE success.
Every pack/idx pair, CRC, frame, same-pack OFS/REF delta and reconstructed object
hash is verified BEFORE any success, including metadata-only and loose-selected
queries. Thin/external delta bases refuse. The selected Git2.54.0 reader profile
requires delta programs of at least four bytes and idx large-slot extent N0/L0
or, for N>0, L<=N-1. Small indirect offsets remain eligible within that extent.
Same-stem regular .rev/.bitmap/.keep/.mtimes require a complete pair; regular
multi-pack-index and objects/info/{packs,commit-graph} are inert. Their bodies
are unused/unverified; only membership/type/size/available-stat observations bind
them, at most16MiB each. Unknown names, links and incremental directories refuse.
Unsupported config keys, includes/conversion/routing/case settings
refuse. The exact finite config table and attribute detection domain are in
tests/commands/git-author-20260828/CLOSURE.md. No ambient global config is read.

Status retains all seven unmerged stage classes. Selected-unmerged diff refuses.
No rename detection, submodules, combined patches or write commands. Ignore rules
are bounded UTF8 glob/negation/directory rules, not every Git pattern extension.
Nested repositories found during untracked scanning refuse rather than being
silently treated as ordinary directories. Metadata/path symlinks refuse; tracked
symlink text is compared without following its destination. Unknown executable
metadata requires explicit core.filemode=false, not fabricated mode parity.

Text patches require strict UTF8 without NUL, preserving BOM/CR and final-newline
state. Binary patch output refuses while raw show/names/quiet remain byte-based.
Prefix/suffix-trimmed, delete-first LCS yields applicable unified hunks, not a
promise of native hunk choice. Commit subject rendering refuses multiline titles,
controls and unsupported encoding headers; full %H does not render message bytes.

Fixed caps: argv64KiB/128 args, paths4096B, cumulative reads64MiB/inflation128MiB,
object/working-file8MiB, index16MiB, metadata1MiB, owned reservations64MiB,
entries20000, objects32768, commits2000, nesting128, ref depth16, steps32000000,
diff cells1000000, lines200000, stdout16MiB, diagnostic64KiB, chunk64KiB and32768
chunks. Packs8/each32MiB/delta intrinsic depth32 remain fixed. Read/inflate/work
are cumulative; resident is live logical ownership; sizes are per value; depth
is per representation even on cache hits. Verified bodies are invocation-pinned,
not evicted. Every physical duplicate verifies before body deduplication.
The eager work profile can refuse packs far below32MiB: even the static lower
bound4P-52 exceeds32,000,000 at P=8,000,014 before index/inflate/query work.
Additional frame/observation hashing also spends that same budget. No cap override.
Provider allocations and zlib internals are not a hard RSS/CPU bound.

Cleanup is registered before reader/codec acquisition. Pure stdout work uses the
accepted owned-output scope; stderr/validation remain under the caller. The
module does not read stdin or invoke other commands. Caller abort and escaping
host/sink identities are preserved; only locally observed consumer closure may
map to141. Local failures128/usage129 are distinct from diff's difference1.
Opaque providers cannot be forcibly preempted. Earlier log/diff records may remain
after a later failure; raw blobs validate before publication.

Primary format references: Git gitformat-index, git-status, diff-format,
gitrepository-layout and gitrevisions at git-scm.com. Native oracle workflows
remain unexecuted; this is a bounded author module pending different review,
not full Git/GNU parity, pack readiness or an accepted public registration.
