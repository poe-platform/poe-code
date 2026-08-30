# Independent review: useful read-only VFS Git

Status: Design direction supported; bounded closure decisions required.
Implemented Through: Not applicable; no Git implementation assessed.
Subject: `589d1d93e2cd87296949ff32d8bf4d9bbef6cbcc`.

## Root decision payload

Retain M1A as a genuinely useful optional loose/index reader with all seven
proposed command surfaces, then M1B pack/idx/OFS/REF-delta before ordinary packed
readiness. This is **not implementation, public export, default, or oracle GO**.
The author README:263 decision table is the closure target; README:59 is CLI
grammar, while the actual numeric table is README:159, not line 59.

| Decision | Recommended smallest closure; ROOT must ratify |
| --- | --- |
| R1 limits/API | Keep the author's 24 defaults exactly; make them fixed M1 ceilings and omit public `limits` overrides initially. Alternative: retain `Partial<GitLimits>` only after publishing a numeric hard ceiling and admissible minimum for every key. Keep `replace` and VFS `discoveryBoundary`; no host/codec/fallback injection option. |
| R2 storage admission | M1A preflight rejects any pack/idx/promisor storage before successful command output, including packs coexisting with loose copies. Packed-refs alone remains supported. This is deliberately stricter than README:19's requested-object refusal; ROOT must select it explicitly, not silently narrow the author profile. |
| R3 discovery/config | Retain bounded ordinary/gitfile/bare/linked-worktree support as proposed, but close the exact config/ref routing rules in D2 below. If ROOT instead defers linked worktrees, record a named `commondir` refusal and change future case A09, not the immutable author packet. No full worktree feature implementation is demanded. |
| R4 raw content/status | Ratify raw bytes, no renames, literal-only paths, strict UTF-8 names and truthful modes. Choose the conservative attribute/config refusal table in D3. Keep conflict status and stage listing, but explicitly refuse diff forms involving selected unmerged index entries until a separate conflict-diff profile exists. |
| R5 rendering/revisions | Adopt D4/D5's bounded grammar, object-type distinction, deterministic text algorithm and explicit binary refusal. Preserve exact raw blob show. Full-hash formats avoid census work; oneline/abbreviated patch headers require complete bounded census. |
| R6 permissions to proceed | After an additive author closure response, ROOT may grant local module/tests only. A different-agent executable corpus/native fixture grant and later M1B/public integration remain separate. This review itself grants none. |

## Findings and smallest repairs

**No demonstrated binary-format contradiction** was found in the supplied v2/v3
index or proposed pack descriptions. No semantic command was executed. The
following are design incompleteness/qualification defects, not invented failing
product tests. `D` references official sources listed in SOURCES.md.

### D1 — limits are defaults, not an accepted override contract

Author README:35 and :155 promise configurable limits with finite ceilings, but
:178 explicitly leaves override ceilings undecided. Implementation cannot claim
bounded admitted options until R1 closes this. Fixed defaults are sufficient for
M1; neither arbitrary safe-integer limits nor invented larger ceilings are needed.
Define `maxEntries` as cumulative index/tree/worktree records, `maxLines` as both
diff sides cumulatively, `maxDiffCells` as cumulative charged cells across files,
and all reads/inflations/rereads as invocation-wide. Census counts distinct names;
revisits still consume steps/read/inflation budgets. A retained-byte reservation is
not JavaScript heap/RSS accounting.

Exact author defaults, transcribed without increasing them (KiB=1024; MiB=1048576):

| Keys | Defaults |
| --- | --- |
| `maxArgumentBytes`, `maxPathBytes` | 65536; 4096 |
| `maxReadBytes`, `maxInflatedBytes` | 67108864; 134217728 |
| `maxObjectBytes`, `maxWorkingFileBytes` | 8388608; 8388608 |
| `maxIndexBytes`, `maxMetadataBytes`, `maxResidentBytes` | 16777216; 1048576; 67108864 |
| `maxEntries`, `maxObjects`, `maxCommits` | 20000; 32768; 2000 |
| `maxDepth`, `maxRefDepth`, `maxDeltaDepth` | 128; 16; 32 |
| `maxSteps`, `maxDiffCells`, `maxLines` | 32000000; 1000000; 200000 |
| `maxOutputBytes`, `maxDiagnosticBytes` | 16777216; 65536 |
| `maxChunkBytes`, `maxChunks` | 65536; 32768 |
| `maxPacks`, `maxPackBytes` | 8; 33554432 |

Keep fixed 128 argv, 128-byte loose header, eight `-C` operands, `-U` 0..100,
and yield/signal checkpoints within 4096 explicit work units (README:61, :74,
:177, :189). These are project limits, not Git format constraints. R1's fixed
option requires no new public tuning API; later lower-only overrides are a
separate possible ROOT choice. Invalid options precede acquisition. Parent shell
budgets/signals win even when a local ceiling has not been reached.

### D2 — storage and config routing need an executable admission table

README:104–110 gives the right intent, but not the exact admitted format versions,
extension values, config precedence or M1A mixed-pack policy. Recommend format0
without extensions, or format1 with only understood `objectFormat=sha1`,
`refStorage=files` without payload, and `worktreeConfig` boolean. Other keys/values
in `extensions` refuse; this intentionally excludes some harmless native
extensions, rather than claiming they are corrupt. SHA256/compat hashes and
ref-storage URI payloads must never be parsed as SHA1/default paths (D01/D03/D04).

For linked worktrees: common config first; `config.worktree` overrides it only
when enabled. HEAD/index are private; ordinary refs/objects/packed-refs are common;
reject selected worktree-special ref namespaces. Resolve relative gitfile paths
from the gitfile's parent, relative commondir from gitdir, then enforce boundary
and metadata-component symlink refusal. Reject active includes even if a condition
looks irrelevant: evaluating them is unnecessary. Refuse `core.worktree` routing
and unsupported `core.bare`/worktree-layout combinations, rather than overriding
discovery. Bare supports metadata/log/show/tree-tree diff; worktree/index-dependent
forms explicitly refuse. Nearest invalid/unsupported repo is not skipped.

R2 preflight also needs named detectors for alternates/http-alternates, shallow,
replace refs (loose AND packed), grafts, partial/promisor config/markers and
unsupported ref storage. Absence is not EACCES/cancellation. Ordinary irrelevant
remote/user settings do not cause a fetch or host lookup. Refusal is 128 with a
bounded reason, not empty/clean 0. This is admission, not an exhaustive fsck of
every unreachable object. Recheck selected observations, but never claim an
atomic namespace snapshot or ABA defense (author README:127).

### D3 — active transformation, ignore and capability boundaries are underspecified

README:106/:120 does not say how to detect active attributes without an attributes
engine. Smallest explicit policy: content-comparison queries refuse any nonempty
noncomment attribute rules in relevant worktree/index fallback/selected-tree
`.gitattributes` or common `info/attributes`; refuse configured `core.attributesFile`
and active autocrlf transformations. This conservative rule also refuses harmless
attributes and must say so. Raw `show REV:path` bypasses rendering/conversion and
remains exact. Do not run an inactive filter merely because its config exists.
Attribute absence in the worktree does not establish absence in the index (D05).

Untracked status refuses explicitly configured `core.excludesFile` instead of
reading ambient paths or silently omitting a declared ignore source. Native ignore
precedence is not rg precedence. Match slash-aware tokens with charged transitions;
bound pattern count, token storage and candidate comparisons through the existing
metadata/entries/resident/steps caps. A trusted constant regex can still be
superlinear on untrusted input: use bounded scans/simple proven grammar, not a
blanket claim that constant regex is safe. Do not follow symlinked `.gitignore`
or `.gitattributes` content (D05/D06). Ignore rules never suppress tracked entries
or explicit tracked literal-path queries.

`permissions:false` is not truthful executable-bit evidence. `core.fileMode=false`
permits raw content comparison; true/default requires a documented truthful mode
binding or refusal. `core.symlinks=false` needs a separate materialized-link policy
or refusal when symlink entries matter. `readlink` string bytes must round-trip,
or symlink comparison refuses. No symlink target content read; no device/inode
inference across providers; case-fold/normalization aliases and unknown namespace
faithfulness require refusal/explicit host qualification, not lexical-security
claims. The existing FS contract exposes no general case-sensitivity certificate.
Read-only calls/getters may have trusted-host/provider effects, including atime;
zero mutator calls is not a hostile-JavaScript sandbox.

### D4 — parser and query semantics need a few exact choices

README:78/:109/:110 requires validation but leaves edge decisions implicit:

- Require exact ASCII loose header `type SP canonical-decimal-size NUL`, four
  types only, and hash the actual validated header+body bytes. Reject oversized
  decimal before conversion, truncation, checksum failure and trailing zlib data.
  Trailing-data/canonical-spelling strictness is a project rule, not a statement
  that every native reader enforces it. Header/body SHA1 is integrity, not strong
  adversarial authentication (D07).
- Tree sibling order is unsigned-byte comparison with directory-name termination
  behaving as `/`; index order is full pathname bytes then stage, a different
  comparator. Pin canonical tree modes 40000/100644/100755/120000; 160000 is an
  explicit submodule gap. Reject duplicate names, bad components, invalid UTF-8,
  type mismatches and truncated raw OIDs. Never locale-sort (D02/D08).
- Index v2 extended-bit refusal; v3 validates reserved bits and refuses the named
  unsupported flags; v4/split/sparse refuse. Optional extension envelopes may be
  skipped but must be inside the checksum boundary. Do not apply optional TREE/
  FSMN/UNTR caches as truth. Stage0 cannot coexist with stages1–3 at one path;
  duplicate stages refuse. Pin all seven nonempty conflict stage sets and selected
  conflict-diff refusal. File-size stat fields are not trusted content lengths.
- `rev-parse tag` returns the tag's OID; only commit/tree consumers and declared
  ancestry operators peel it. `^0`, omitted suffix digits, repeated `~`/`^`,
  missing parents and operand types need explicit grammar. Recommend digits
  optional with default1, left-to-right suffixes, iterative traversal, and
  existing argument/steps/commits/ref-depth caps; reject ranges/reflogs/other
  peeling syntax. Ambiguous shorthand refusal and full-OID existence verification
  are stricter project semantics, not native `rev-parse --verify` equivalence
  (D09/D10/D11).
- Literal directory prefixes match component boundaries (`src` not `src-old`).
  Resolve cwd-relative paths once; `REV:path` is repository-tree-relative, with
  explicit `./`/`../` forms either normalized within worktree or refused. Recommend
  refusing those special REV:path forms in M1. Global literal mode makes magic
  text literal; otherwise only `:(literal)` is interpreted. Empty, wildcard and
  unsupported magic forms refuse rather than becoming an empty result (D12).

These clarify the promised parser, not requests for arbitrary revision/pathspec
features. Check safe additions/multiplications before arrays, strings, sorting,
decoded counts or varint conversion. Charge hashing, validation, sorting compares
and ignore matching as well as diff cells; do not count only outer loop iterations.

### D5 — rendering is explicitly unfinished in the author packet

README:221–227 asks to define binary detection/summary bytes later. Close this
before author tests: compare raw bytes first; text patch eligibility is valid
UTF-8 with no NUL, preserving BOM, CR and final-LF state. Recommend explicit128
for binary patch presentation, while name-only/name-status/quiet/exit-code and
raw show remain byte-correct. This is not native binary-detection parity.

Use a deterministic bounded line algorithm (prefix/suffix trim, LCS, delete-first
tie) with cumulative cells/work and a fixed context default3. Retain empty blobs,
missing-final-LF markers, six-digit modes, type changes, add/delete headers and
quoting; `/dev/null` belongs to applicable file-side headers, never replaces
`a/...`/`b/...` in the `diff --git` header. `--raw` is NOT added to the CLI profile.
Ambiguous hunk choices remain a separately measured compatibility gap, not
normalized passes (D13).

Log follows the first-parent chain, not timestamp sorting; date/identity header
syntax and numeric ranges need bounded validation, but no date rendering option
is requested. Recommend printable strict-UTF8 subject presentation, refusing
unsupported encoding/control characters and multiline title folding in M1 rather
than escaping them into claimed native `%s` bytes. Full `%H` may avoid subject
rendering. Freeze LF terminators and empty-subject output. Do not interpret commit
message `%` as format syntax, launch a pager or generate ANSI controls. `-n0` is
an intentional empty selection; hitting maxCommits without an explicit completed
selection is a limit error, not an invented end of history (D14/D15).

Status/list validate selected data before stdout; raw blob show verifies the whole
bounded object before publication. History/diff can leave complete prior records
plus nonzero on later failure as the author already states. Diagnostics must bound
and safely render untrusted paths separately from exact raw blob output.

### D6 — lifecycle is a correct direction, not borrowed implementation proof

Author README:182/:204 is aligned with the contracts. Keep local invocation
counters; CommandContext has no generic budget handle. Register cleanup before
codec/source acquisition or admission, share idempotent completion, acquire through
the output operation where applicable, and await final close. Pre-abort and host/
sink thrown values retain identity. Stdout consumer close must not abort required
stderr or siblings. A direct host without enrollment still needs finally cleanup.
Copy retained borrowed Buffer fragments before advancing/finalizing the producer;
an awaited transient write need not copy indiscriminately. Bound repeated empty
chunks; backpressure is awaited. No constant-memory, hard RSS, uncooperative-host
preemption, or atomic-provider claim is warranted.

### D7 — M1B is deferred acceptance, not a blocker requiring implementation now

README:138 is a sound outline. Before M1B acceptance explicitly distinguish the
pack entry's inflated delta-program length from its reconstructed object length;
validate both. OFS distances must identify earlier entry starts; REF bases must
exist in the admitted self-contained pack. Copy size0 means 65536, whereas opcode0
is reserved. Verify idx fanout/OID ordering/counts, unique valid entry offsets,
large-offset table bounds, both trailers, entry CRC covering header/base/compressed
bytes, zlib boundaries and final canonical OIDs (D16). Apply delta depth32 and
cumulative graph/work/inflation/resident caps; cache reuse must not erase charges.
Reject missing pairs, thin/external bases, corruption and unsupported storage.
Ignoring acceleration-only MIDX/rev/bitmap files is not permission to miss packs.
These remain twelve future B cases, not evidence of packed readiness.

## Read-only reuse assessment

Bound source hashes are in BINDINGS.json; line references below name inspected
code, not executed acceptance:

| Existing source | Assessment |
| --- | --- |
| `src/commands/bytes/compression/gunzip.ts:2`, :69 | Uses Node `createInflateRaw`, not a pure-JS DEFLATE engine. Its private wrapper parses gzip; concatenation/trailer policy is not Git zlib admission. No reusable pure-JS inflater was found by the scoped source search. Node builtins are allowed; codec byte-consumption/cleanup tests remain necessary. |
| `src/commands/bytes/compression/gunzip.ts:5`; `src/commands/bytes/checksums/index.ts:118` | First is a reflected CRC pattern; second includes POSIX length folding and is not pack CRC. Both are private. Do not invoke checksum CLI or extract peer internals without ownership. |
| `src/commands/bytes/checksums/index.ts:124` | Private streaming Node crypto pattern. Direct builtin hashing is plausible zero-runtime-dependency design, not measured performance or approved new API. |
| `src/commands/diff-patch/diff.ts:120`; `src/commands/diff-patch/shared.ts:71` | Bounded LCS and strict text ideas exist; private per-pair matrix checks and Unix presentation cannot establish cumulative Git work/rendering. Local adaptation needs ownership; no temporary-file command invocation. |
| `src/commands/search/glob.ts:12`, :44 | Uses RegexSession worker matching and rg ignore parsing. Not automatically Git-compatible, cheap, or a safe shared API. A bounded Git-local token matcher is real new work, not a free parser reuse. |
| `src/contracts/output.ts:13`, :90; `src/contracts/io.ts:140`, :153 | Appropriate existing ownership/acquisition/read/write contracts; retained copies and final concatenation both need reservation accounting. |
| `src/contracts/filesystem.ts:6`, :28, :78 | Optional capabilities/identity, provider-allocated readdir arrays and maxBytes-dependent reads justify the author's limits; they do not prove read isolation or exact executable modes. |

`src/plugins/index.ts:61` composes command families; `src/shell/runtime.ts:2091`
consults registry, then VFS script lookup, then command-not-found. These observations
support the priority document's missing bundled Git assessment, NOT a claim that
every invocation named git must fail: injected commands/VFS scripts remain possible.
No dispatch was executed, no root inventory/default count changed.

## Evidence and closure

All six author packet files and eleven author source inputs authenticate. Literal
data contains 11 hash/length-valid loose objects (5 blobs, 4 trees, 2 commits), one
184-byte v2 index with two stage0 records and a valid trailer. The six proposed
workflows remain UNRUN; neither those structural checks nor this review establish
native acceptance, Git semantics, provider interoperability or lifecycle behavior.
Original transcription corrections remain in the author's binding, unchanged.

ROOT should answer R1–R6 and request an additive closure binding to D1–D7, then
grant only the next owned phase. MATRIX.md is finite: 60 M1A scenarios (six inherited
expectations plus 54 independent cases), 12 M1B scenarios; all unexecuted. Native
expected-output qualification requires an explicit new-fixture grant with binary,
version/platform, environment, byte/effect and input hashes; no native version was
queried here. The held gate/declaration review was neither resumed nor certified.
