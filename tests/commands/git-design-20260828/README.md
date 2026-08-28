# Bounded read-only VFS Git — proposal, 2026-08-28

**DESIGN ONLY; implementation and native/product execution are not authorized.**
User priority is git117897/8.73%, USER-PROVIDED rather than independently measured.
This proposal does not change root exports, defaults, dependencies or the frozen gate.
Only this directory is owned. No Git executable or operation on existing Git
repository data, private engine, external service, compiler or product was run.
Official public documentation was read; neutral fixture bytes were constructed in
memory with Node crypto/zlib, without materializing a repository.

## Recommended decision and practical release path

Approve a **genuine SHA-1, raw-content, read-only Git reader**, not a wrapper around
host Git or outputs inferred from filenames. Two independently reviewed increments:

1. **M1A — useful loose-object/index slice.** Real repository discovery, local config,
   refs/packed-refs, index v2/v3, loose commit/tree/blob/tag readers; tracked/untracked
   status, working/index/tree diff, bounded history and exact blob retrieval. This
   can be a standalone plugin for explicitly supported repositories. Packed-only
   object requests fail explicitly; it is not default-ready general clone support.
2. **M1B — ordinary packed repositories.** Pack v2/v3 + index v2, nondelta/OFS_DELTA/
   REF_DELTA reconstruction under strict caps. Required before recommending default
   agent registration for ordinary packed repositories. Same independent corpus
   must produce identical semantic bytes for loose and packed representations.

Do not spend the first milestone implementing writes, network protocols, every
config feature, arbitrary pathspecs or the entire revision language. Do not call
M1A/B full Git. Storage refusals remain measured gaps, not clean results.

## Proposed API and future write scope

API follows existing command-family conventions; **these exports do not exist yet**:

```ts
interface GitCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<GitLimits>;
  readonly discoveryBoundary?: string;
}
declare function createGitCommand(options?: GitCommandsOptions): CommandDefinition;
declare function createGitCommands(options?: GitCommandsOptions): readonly CommandDefinition[];
declare function gitCommands(options?: GitCommandsOptions): VirtualShellPlugin;
```

`discoveryBoundary` is an absolute POSIX **VFS** path, default `/`; it limits discovery
and resolved metadata references, not host process authority. No host-FS option,
transport, subprocess hook, native fallback, permissive format switch or evaluator.
All functions operate on `context.fs/cwd/args/env/stdout/stderr/signal`. No nested
command execution is needed. Top-level replacement follows registry conventions.
No global/shared-contract or root-barrel change is needed for module authorship.

Proposed author paths, only after a new grant:
`src/commands/git/{index,types,limits,io,discovery,config,refs,index-file,objects,
tree,revisions,pathspec,ignore,status,diff,history}.ts`, module README and
`tests/commands/git/**`. M1B adds local `pack.ts`/`pack-index.ts`/`delta.ts`.
Names are suggested organization, not permission to touch peers or create all
files mechanically. Public root/subpath/default integration is a later grant.

## CLI profile to freeze before implementation

Global options: `-C <VFS-path>` (at most8, local to invocation), `--no-pager`,
`--literal-pathspecs`, `--` where applicable. No `-c`, `--exec-path`, `--git-dir`,
`--work-tree`, aliases, help-command spawning or environment-driven external routes.
Unknown flags fail129; unsupported repository features/corruption/limits fail128
with a specific bounded diagnostic, never empty status0. Successful queries return0.
Caller abort and escaping host/sink errors retain actual identity through the
existing invocation boundary; do not turn them into a fabricated Git exit status.

| Command | M1A accepted grammar / semantics | Deliberate gaps |
| --- | --- | --- |
| `rev-parse` | One query: `--show-toplevel`, `--absolute-git-dir`, `--is-inside-work-tree`, `--is-bare-repository`, or `[--verify] REV` yielding full OID | No shell-evaluation/output quoting modes, all-ref enumeration or arbitrary revision expressions. Bare queries return truthful values; show-toplevel in bare errors. |
| `ls-files` | Default/`--cached`, `--stage`/`-s`, `-z`, literal path prefixes after `--`; actual index entries and stages | No filesystem-only flags, eol/debug/format modes, sparse/split-index approximation. Unmerged entries are real stage records, not silently collapsed. |
| `status` | Required `--short`/`-s` or `--porcelain[=v1]`; `-z`; `-uno`/`-unormal`/`-uall`; `--no-renames`; tracked XY, unmerged stages, untracked groups and ignores | Long default status, porcelain v2, branch/ahead/behind, rename/copy detection and submodule dirtiness deferred. Fixed no-renames profile must be explicit in help/comparison, not claimed as native default configuration parity. |
| `diff` | Working tree versus index by default; `--cached`/`--staged` versus HEAD or REV; one REV versus working tree; two REV trees; literal paths; `--name-only`/`--name-status`, `-z` for those lists, `--exit-code`, `--quiet`; text patch `-p`/default, `-U0..100`, `--full-index`, `--no-renames`, `--no-ext-diff`, `--no-textconv`, `--no-color` | No `--no-index`, rename/copy, textconv/filter execution, binary patches, combined merge diff, stat summaries, word/whitespace algorithms. No exact hunk-choice parity for every ambiguous edit. |
| `log` | Explicit `--first-parent`; `-n N`/`--max-count=N`; `--oneline` or `--format=%H` / `--format=%H %s`; optional starting REV | No silent merge-history omission: absence of explicit first-parent mode is refused in M1. No ranges/graph/decorations/reflog/signature verification/author filters/general pretty language. |
| `show` | `REV:path` resolves and emits exact blob bytes; `--no-patch` plus one accepted log format emits commit metadata | General default commit/tag/tree presentation and patch-producing show deferred. Never substitute raw commit content for native show output. |

Revision subset: `HEAD`, full40-hex OID, valid fully qualified ref, unambiguous
branch/tag shorthand, bounded `~N`/`^N`, and `REV:path` only where declared.
Annotated tag peeling is bounded and cycle-checked; ambiguity fails instead of
inventing precedence. No reflog `@{}`, ranges, searches, replacements or grafts.
Abbreviated input OIDs are deferred. Oneline/patch output can use a minimum7-digit
**repository-unique** abbreviation only after a bounded complete object-name
census; otherwise fail the census limit, not print an ambiguous prefix. Full OID
output bypasses abbreviation work, not object verification.

Pathspecs: literal repo-relative/cwd-relative file or directory prefixes, including
`:(literal)`/global literal mode for names containing glob magic. Reject unhandled
magic/wildcards rather than treating them as an empty match. `--` disambiguates
path operands from revisions/options. No recursive filesystem traversal outside
the discovered worktree, and no traversal into `.git` as worktree content.

Status porcelain v1 uses root-relative paths and XY fields; short uses cwd-relative
paths. `-z` emits raw UTF-8 filename bytes and NUL separators; otherwise use Git-style
C quoting, not JSON quoting. Supported pathnames must round-trip through the VFS
string API as strict UTF-8. Non-UTF8 index/tree names are a reported profile gap,
never replacement-decoded or silently merged. Blob content remains arbitrary bytes.
Native format references: S02/S03/S08 in SOURCES.md.

## Storage/discovery contract

| Layer | Required implementation / refusal boundary |
| --- | --- |
| Discovery | Walk from effective cwd toward boundary; accept ordinary `.git` directory, or one bounded `gitdir:` file pointing inside boundary. Bare metadata-only repositories are recognized. Stop at nearest repository, never fall through an unsupported nested repo to an ancestor. |
| Linked worktree | Resolve `commondir` within boundary; HEAD/index remain per-worktree, objects/ordinary refs/packed-refs use common dir. Check both configs with declared precedence; reject unsupported worktree-specific refs/features instead of applying all common paths blindly. |
| Config | Parse local Git config syntax without executing anything; enforce repository format/hash/ref-storage and supported boolean modes. Honor `core.fileMode=false`; require truthful executable-mode metadata if true. Fixed byte-content policy requires no active autocrlf/clean/working-tree-encoding transformations. Active attributes, sparse checkout, config includes/includesIf and unknown format extensions refuse relevant content queries. Ordinary remote/user settings can be ignored without contacting them. No global/system/home config. |
| Environment | Read only virtual context values. Refuse routing/config overrides such as GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/alternates/GIT_CONFIG_*; do not use process.env. No hooks, credential helpers, pager/editor, external diff, filters, SSH or HTTP. Harmless presentation variables do not override the documented fixed profile. |
| Refs | Read symbolic/detached/unborn HEAD; loose refs override packed-refs. Validate syntax/components, duplicate/conflicting packed rows, peeled tag rows, exact OID lengths, bounded symbolic chains and cycles. No reftable/replace/grafts/alternates/promisor fetch. Shallow history truncation is not treated as an ordinary root. |
| Index | Validate DIRC, v2/v3, big-endian fields, full checksum, sorted byte paths/stages, lengths and alignment. Support normal stage0 and stages1–3. Validate v3 extended flags, but refuse intent-to-add/skip-worktree/assume-unchanged semantics in M1 rather than silently overriding them. Uppercase optional extensions may be length-checked/skipped; mandatory unknown/lowercase extensions refuse, including split/sparse. v4 deferred. |
| Loose objects | Inflate zlib, parse bounded type/decimal-size/NUL header, require exact body size and no trailing compressed member/data; verify SHA-1 of canonical header+body equals requested name. Accept blob/tree/commit/tag only; validate tree modes/order/duplicates/paths and typed references. SHA-1 format integrity is not collision-resistant authentication. |
| Worktree comparison | Hash actual bytes (not stat-cache equality); compare HEAD tree→index and index→working tree. Symlinks compare readlink text, never target bytes. Required readlink unavailable gives explicit refusal. Gitlinks/submodules are unsupported, not recursively followed. Detect file/type/mode differences where provider contract supports them. |

Index fields and optional-extension rules derive from S04; object layout from S01/
S06. These tables describe a **proposed strict subset**, not everything native Git
accepts. A missing index is handled explicitly as an empty index in a valid repo;
it must not suppress HEAD-side deletions or untracked files. Unborn HEAD is separate
from a missing/corrupt referenced object. Validate unmerged stage combinations and
all seven corresponding status codes against future literal native fixtures.

Untracked status needs a bounded **Git** ignore matcher: per-directory .gitignore,
common info/exclude, order/negation/escaped spaces/#/!, slash anchoring, directory
patterns, `*`, `?`, bracket classes and `**`; excluded-parent traversal follows
S07. No ambient excludes file. Use charged byte-token matching, not unbounded host
RegExp or an assumed-compatible rg ignore parser. Unsupported active pattern
syntax must error, not list ignored files as untracked. Tracked paths stay tracked.

Metadata symlinks are refused; check every component with lstat/realpath against
boundary. Git-controlled paths must never escape via `..`, NUL, absolute names,
case aliases of `.git`, or linked worktree pointers. POSIX backslash is not a
separator; platform-alias support requires separate tests. No OS reads outside
`context.fs`. Faithful providers are trusted; these checks are not a sandbox for
malicious host JavaScript, atomic no-follow handles or a global namespace snapshot.
Pre/post index/ref/content observations detect some concurrent changes; same-value
ABA and hostile remapping remain limits. No index refresh/lock/optional-lock writes.
Reads may update provider atime; “read-only” means no mutating FS methods invoked,
not zero physical metadata activity on every server.

## M1B pack reader — planned, not an M1A shortcut

Use the S05 pack and idx formats, not gzip or a fixture-only serializer. Require
valid pack signature/version/count/checksum and idx v2 fanout, ordered OIDs, CRCs,
offsets and both trailers. Decode large offsets safely before applying small
profile caps. Inflate one bounded member; check consumed bytes at the next entry
boundary. Reconstruct OFS/REF deltas with checked base/result lengths, ranges,
insert/copy instructions and exact output length; reject reserved opcode0.
Resolve bases iteratively, cap depth, track cycles and verify final canonical OID.
CRC covers the actual packed entry, not POSIX cksum output. Thin/missing external
bases refuse. Index v1, SHA-256 and incremental MIDX are deferred; ordinary pack
pairs can be enumerated without trusting MIDX acceleration. Damaged/missing indexes
must not hide objects or produce a clean repository. All relevant pack data stays
inside finite VFS reads; no unpacking into scratch files.

## Proposed finite limits and admission ordering

All limits are validated nonnegative/positive safe integers as appropriate, with
finite documented hard ceilings; no Infinity/NaN/zero-disable escape. Values below
are proposed defaults, not measured memory guarantees or accepted public API.

| Charge | Default |
| --- | ---: |
| argument bytes / one path bytes | 64KiB /4KiB |
| total compressed+worktree+metadata read bytes | 64MiB |
| total inflated/reconstructed bytes, including repeated work | 128MiB |
| single object / working file / index / metadata file | 8MiB /8MiB /16MiB /1MiB |
| total owned resident byte reservations | 64MiB |
| index/tree/worktree entries / object-name census | 20000 /32768 |
| commits / tree-discovery depth / ref-tag chain / delta depth | 2000 /128 /16 /32 |
| steps / diff matrix cells / line records | 32000000 /1000000 /200000 |
| stdout / stderr / I/O chunk / chunks including empty | 16MiB /64KiB /64KiB /32768 |
| packs / one pack | 8 /32MiB (also total read/resident caps) |

Proposed `GitLimits` keys map in table order to `maxArgumentBytes`, `maxPathBytes`,
`maxReadBytes`, `maxInflatedBytes`, `maxObjectBytes`, `maxWorkingFileBytes`,
`maxIndexBytes`, `maxMetadataBytes`, `maxResidentBytes`, `maxEntries`, `maxObjects`,
`maxCommits`, `maxDepth`, `maxRefDepth`, `maxDeltaDepth`, `maxSteps`, `maxDiffCells`,
`maxLines`, `maxOutputBytes`, `maxDiagnosticBytes`, `maxChunkBytes`, `maxChunks`,
`maxPacks`, `maxPackBytes`. Additional fixed admission ceilings:128 argv entries,
128-byte loose-object header and at most8 `-C` operands. Author ceilings for option
overrides require review; defaults alone must not imply arbitrarily large accepted
user limits. No internal limit or counter is a mutable global/per-object reset.

Charge before our allocation, array growth, copy, cache insertion, loop edge or
codec input. Validate integer arithmetic and encoded counts against remaining
input before Number conversion/allocation; no unchecked varint shifts. Reserve
codec output chunks before starting the stream; declared object/delta lengths
must fit before materializing bodies. Reject actual overflow while streaming;
destroy and await codec/input cleanup, never collect first then check. Charge
compressed input, emitted output and delta copies independently. SHA-1/hash updates
use bounded chunks. Yield/check signal at most4096 explicit work units; count empty
chunks too. Bounded caches retain owned copies, release evicted/consumed storage,
and charge rereads on fallback. Never reset budgets per object/subcommand recursion.

Important existing-interface limitations: `readdir()` returns an already allocated
provider array; a ByteSource may deliver an already large producer chunk. Reject
before copying/adopting but do not claim to have prevented external allocation.
`readFile({maxBytes})` relies on the truthful provider; pre-stat alone is insufficient.
Node codec internals/host callbacks are not charged hard RSS or synchronously
preemptible CPU. Streaming zlib details require version-pinned implementation tests;
the existing gzip codec is not automatically safe Git zlib reuse. No new FS API is
proposed merely to hide these limits.

## Lifecycle, errors, formatting and reuse

Validate options under original context. For repository work whose purpose is
stdout, enroll `createOutputOperation` before acquisition; use its signal/output,
register reader/codec cleanup before activation, await close in finally. Required
stderr uses original caller. Distinguish exact consumer-close provenance from
caller abort or an unrelated escaping failure; do not swallow arbitrary errors
because a consumer also closed. No extra stdin reads: this profile never consumes
stdin. Late acquisition is released; siblings retain their own resources. Direct
handlers without optional enrollment still await their own cleanup. Opaque host
promises need cooperative adapters; no universal head-zero/preemption promise.

Status/list outputs validate their selected metadata first, within bounded buffers.
Blob output is withheld until object hash/size is verified. History/diff may have
earlier complete records when a later read fails; partial stdout plus nonzero is
explicit, not transactional publication. Await writes, copy retained fragments
before advancing a borrowed producer, account stdout once through operation.output.
Raw sink/abort rejection identity takes precedence per existing contracts.

Git diff exit0 normally includes changes; --exit-code/--quiet produce1 for changes,
0 otherwise (S03). Fatal/unsupported diagnostics are virtual `fatal:`/usage messages,
not claimed byte-for-byte localization parity. Text patches have Git headers, mode
changes, correct `/dev/null` additions/deletions and missing-final-LF markers; do
not emit ordinary Unix-diff headers and call them Git. Binary content supports
name/status/raw-show first; binary patch payloads are refused. Define detection and
summary bytes before author tests, with native predicates qualified separately.

Reusable source inventory (read only; source hashes in BINDING.json):
- `src/contracts/command.ts:4`: context/invocation/registry. **No generic Budget
  object is exposed on CommandContext.** Keep Git's local finite counters; outer
  shell sink accounting remains authoritative and is not reset/replaced.
- `src/contracts/filesystem.ts:78`, `io.ts:140/208`, `output.ts:13`: VFS methods,
  byte reads/writes and owned operation. These are appropriate shared imports.
- `src/commands/bytes/checksums/index.ts:124`: streaming node:crypto pattern;
  digest is private. Use node:crypto directly, not the checksum CLI or POSIX CRC.
- `src/commands/bytes/compression/gunzip.ts:69`: private raw-inflate/gzip lifetime
  pattern, **not** a zlib object decoder or certified reusable Git parser.
- `src/commands/diff-patch/diff.ts:120` and `diff-format.ts:83`: bounded edit and
  formatting ideas, private budget/Unix presentation. No peer extraction/change
  without separate ownership; no command invocation via temporary VFS files.
- `src/commands/search/glob.ts:12`: worker-based rg matching is not a ready Git
  pathspec/config/index reader. No existing Git parser was found in these sources.

## First end-to-end data and review plan

`NEUTRAL-FIXTURE.json` contains actual zlib loose objects, two linked commits,
trees, a checksummed DIRC v2 index, HEAD/ref/config and working files as bytes.
Staged README edit, staged deletion, unstaged source edit and untracked notes are
deliberately distinct. Proposals include status XY, cached/working diffs, raw show,
two-row history and NUL ls-files; these cannot pass with git--version/canned output.
It is **not native-validated** and is not an actual repository on disk.

`MATRIX.md` freezes the intended finite categories and future oracle recipe, not
passing tests. Different reviewer should freeze independent bytes/mutations before
product source, then replay source + full installed/moved package. First verify
loose/index semantics; independently transcode the same graph to real packs for
M1B, including both delta forms, without replacing old expectations. All mutating
FS methods throw in tests; method-call logs, content/name snapshots and atime
qualification remain separate. No native/private/network/build permission follows
from this document.

## Root decisions requested before authoring

1. Ratify M1A standalone loose/index slice plus M1B pack requirement before ordinary
   default integration, rather than pretending packed repos work or delaying all
   useful read-only commands for every Git feature.
2. Ratify fixed raw-byte/no-renames/explicit-first-parent/literal-pathspec profile,
   strict UTF-8 path admission, and explicit refusals for active transformations,
   unsupported index flags, shallow/partial/alternate storage and submodules.
3. Ratify proposed limits, boundary/faithful-provider and cooperative-cleanup
   qualifications. If mode tracking is required on advisory-mode providers, decide
   a truthful separate profile; do not fabricate native executable-bit evidence.
4. Grant only local Git module/tests after independent design review; separately
   authorize a finite isolated **new fixture repository** native oracle. None has
   run here. Do not inspect or operate on the user's/host/private repositories.

No estimated completion time, full GNU/Git compatibility, new default count,
benchmark win or broader gate acceptance is claimed.
