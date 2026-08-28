# VFS apply_patch — proposed literal profile v1

Date: 2026-08-28. Status: AUTHOR DESIGN, awaiting root policy/implementation GO.
No product module, native oracle, product execution, or semantic pass is claimed.
The editing tool used to create this document is not the proposed product command.
User priority: 34,447 uses / 2.55%; existing `patch` does not implement this format.

## Scope and prospective API

Only `src/commands/apply-patch/**` and this author-test subtree. Root exports,
aggregate defaults, package metadata and integration docs stay with Curie. No
contracts, shell/parser, other commands, providers, or runtime dependencies change.
Proposed module exports: `createApplyPatchCommand(options?)`,
`createApplyPatchCommands(options?)`, `applyPatchCommands(options?)`, with
`ApplyPatchCommandsOptions { replace?: boolean; limits?: Partial<ApplyPatchLimits> }`.
Single command name `apply_patch`; array factory returns one definition; plugin
collision/replacement follows the existing command-family pattern. These APIs do
not exist yet. Private parser/planner/collector/publisher, not an invocation of
unified `patch`, another Shell, host executable, eval or an external package.

## Primary-source binding and compatibility

`SOURCES-v1.json` pins official OpenAI Codex `rust-v0.145.0`, commit
`25af12f7e61572b0bc18ddb1008be543b91519b0` (tag dated 2026-07-21), plus the
official prompting guide. This is a selected reference, not a latest-version claim.
Read source only; no upstream CLI or implementation was executed or vendored.

Source findings, not native observations:

- The official tool prompt describes Add/Delete/Update, optional Move, context
  anchors, prefixed body lines and an EOF marker. It shows chained named anchors
  and asks for relative paths. The pinned parser also accepts absolute paths and
  an omitted first `@@`; its streaming parser rejects consecutive empty chunks.
  Thus prompt and implementation are not one perfectly identical grammar.
- The pinned matching implementation searches exact matches first, then relaxed
  whitespace and punctuation passes, returning the first match. Its EOF branch
  searches only the suffix despite a comment mentioning fallback. We propose no
  relaxed passes, no comment-derived EOF fallback, and no implicit blank-line trim.
- The pinned application writes Add even over an existing file, makes missing
  parents, writes a move destination before removing the source, and can fail
  partially. Updates split on LF and ensure a final newline. We propose explicit
  byte retention instead, and no overwrite of an existing Move destination.

This is a useful, bounded literal-format profile, NOT full Codex parity, not the
Responses API's JSON operation protocol, and not GNU/BSD unified patch syntax.

## Invocation and grammar (root choices R1/R2)

Zero arguments consumes effective stdin through EOF, including shell-provided
quoted heredoc input. One argument is the entire literal patch; stdin is not
acquired in that branch. More than one argument fails status 2 before input/FS
access. No flags, filename operand, embedded shell/heredoc evaluation, JSON,
environment preamble, code fences, or `--` parsing. Shell expansion is the existing
shell's responsibility; the command never re-expands an argument or patch body.

LF and CRLF patch framing are accepted, stripping exactly one CR preceding each
LF. Begin must be the first line and End the last, with an optional single final
line terminator; no trim of payload, paths, header indentation, or outer blank
lines. Empty envelope fails status 2. Markers are case-sensitive literal text.

- `*** Add File: path`: zero or more `+text` lines; empty Add creates zero bytes.
- `*** Delete File: path`: no body; target must be an existing regular file.
- `*** Update File: path`: optional immediately following `*** Move to: path`,
  then at least one nonempty hunk. Move-only/no-body updates are refused; a
  context-only hunk permits an unchanged-content move.
- Hunk starts `@@` or `@@ literal anchor`. The first hunk can omit `@@` when
  its first line has a body prefix. Consecutive named anchors are supported as
  the prompt's context-navigation form; each advances after its selected line.
  A bare empty `@@` followed by another header is invalid.
- Bodies use ` ` context, `-` removal, `+` insertion. An unprefixed empty line
  is invalid, not an implicit context blank. At least one body record is required.
  A context-only hunk is valid. `*** End of File` ends the last hunk of that file.
  More hunks after EOF, misplaced Move, unknown headers and bare unified-diff
  no-newline annotations fail the whole parse before any FS call.

R1 recommendation: exact matching, first full match at/after the forward cursor;
not unique-match rejection and no whitespace/punctuation fuzz. Named anchors use
the same first exact rule; old-body context/removal records match consecutively
after them. Match on the original target, not text produced by earlier hunks.
Advance cursor to the end of each old region; reject overlap/backward matches.
EOF requires the old region end at the actual final record and start >= cursor.
Pure additions append after all original records; repeated pure additions retain
patch order. They advance the cursor to EOF, so later consuming hunks fail.
Unlike the pinned source's trailing-empty retry, explicit empty context is real.

## Bytes, lines, final newline (R2)

Patch text and updated target content must be valid UTF-8 without NUL. Decode
fatally with BOM preservation; BOM before Begin is a syntax error, BOM in file
content is literal content. Argument strings with unpaired UTF-16 surrogates are
rejected rather than silently replacement-encoded. No Unicode normalization.
Delete and Add-overwrite may snapshot binary original bytes without decoding them.

R2 recommendation: preserve line records as text plus original LF/CRLF/no-ending.
Exact context compares text, not the record terminator. Unchanged records retain
their original bytes (including mixed LF/CRLF). Inserted records use the first
existing terminator, or LF when none exists. Add always emits LF per `+` line.
After an Update, a nonempty result preserves whether the original nonempty file
ended with LF; an originally empty file receiving text gets a final terminator.
An unterminated old final record that becomes internal gets the selected separator.
When a different record becomes final, strip its ending if the original lacked
one. Deleting every record produces zero bytes. The format has no operation to
request only a final-newline change. This intentional difference is NOT an
upstream newline-equivalence claim. Unchanged-content Update skips its write.

## VFS path, alias and write policy (R3/R4)

R3 recommendation: accept relative paths resolved against `context.cwd` and
absolute VIRTUAL paths. These are not host paths or URLs. Preserve Unicode and
spaces literally; do not unquote path text or interpret backslash as a separator.
Reject empty paths, NUL/control characters, `..` components, trailing slash,
final `.` and root targets. Normalize `.`/duplicate slashes for conflict checks.
Backslash is literal POSIX filename data, not a Windows drive/UNC escape.
Header names are not shell-expanded. Never enumerate or mutate outside context.fs.

One canonical source/destination participation per patch: reject repeated paths,
move chains/cycles, and file-versus-parent conflicts before target reads. Inspect
every existing path component with lstat, rejecting symlinks (including dangling
leaf/ancestor links), non-directory ancestors and non-file existing leaves.
This follows the existing patch family's conservative symlink policy; lexical
normalization is not a no-follow lease. Known complete scoped identities or an
existing compareEntry result of `same` between participating existing entries
reject conflicting alias operations before writes. Invalid/conflicting comparison
results or comparison failures are not converted to `distinct`/`unknown`.
No fake identities from URLs, client objects, bare inode numbers or bytes.

R4 recommendation: Add replaces an existing regular target, matching the useful
upstream behavior; Update writes its own existing regular target. Move requires
an absent destination and uses actual `writeFile(..., {flag:'wx'})` before source
removal, never a check followed by truncation. Existing Move destinations refuse
even when distinct; report this narrower overwrite profile. There is no native
rename/copy fallback or unknown-source/destination truncation. Source removal is
nonrecursive and occurs only after successful destination write plus source
revalidation; a failed/uncertain write never permits unlink. Ordinary new-path
moves work without fabricated cross-provider identities. Provider refusal of
exclusive creation is a real capability failure, not permission for `flag:'w'`.

Unknown identity across DIFFERENT operations does not prove distinctness. Detect
known aliases and revalidate bytes/metadata before each publication; unknown
relationships can still cause a later conflict/partial application, not an atomic
manifest guarantee. A single in-place Update/Add-overwrite can affect existing
hardlinks as its provider defines; this is not copy-on-write/inode isolation.
Stable ancestor/namespace and no competing external writer is the positive
profile. Revalidation is not atomic compare-and-swap, an ABA defense, or hostile
provider authentication. Followed read identity cannot certify a future overlay
write target; this profile does not claim otherwise.

## Preflight, authorization, partial outcomes (R5)

Phases: input admission/collect -> complete parse and lexical conflict checks ->
readonly capability check -> all metadata/alias checks -> bounded original reads
and every hunk result -> summary/output-size reservation -> mutation phase.
No mkdir/write/rm before ALL initial target/content preflight succeeds. Syntax
failure makes zero FS calls. A missing later file/context leaves earlier targets
unchanged. Read side effects such as atime or existing Overlay content-read
garbage housekeeping are NOT promised absent; no explicit command mutation is
issued during preflight. Overlay.readFile currently calls run with cleanup enabled.

R5 recommendation: `capabilities.readOnly === true` refuses before target reads.
Preflight W_OK on existing write target or nearest existing parent; deletion
checks parent. A typed EACCES/EROFS (or other real failure) is fatal. Only typed
ENOTSUP/EOPNOTSUPP with permissions not true means authorization cannot be
preflighted, NOT a grant; defer to actual provider mutation authorization. In
particular WebDAV intentionally lacks W_OK while supporting PUT. No mode/UID
inference, blanket readonly-capability-false guarantee, or permission bypass.

Create missing parents one level at a time AFTER preflight; validate a raced
EEXIST as a directory, never swallow arbitrary errors. Fresh observations and
byte comparisons precede each destructive operation. Existing-target writes use
`w`; missing Add/Move destinations use `wx`. All calls carry the original signal.
No recursive removal, rollback, temp-file rename transaction, or parent cleanup.
New file metadata follows provider write defaults; existing writes retain only
what that provider preserves. Move is a content operation, not inode/ACL/ctime
preservation. Earlier completed files/parents remain after a later IO error;
even the failing write may have partially changed bytes. Error includes operation
ordinal/path and says prior changes may remain. Never print success on failure.

Success stdout is `Success. Updated the following files:\n` followed by one
`A path\n`, `M path\n`, or `D path\n` per operation, in patch order (not the
upstream grouped order). Use the literal header path; Move reports its destination
as `M`. No success stderr. Context-only Update is reported as `M` even when its
write is elided. Paths contain no control characters under R3. Preflight failure
has empty stdout and one bounded `apply_patch: ...\n` diagnostic on stderr;
mutation failure adds `operation N; prior changes may remain` to that diagnostic.
No rejected-patch files/backups are created. Exact upstream prose is not a target.

## Limits and cancellation

Proposed configurable positive-safe-integer ceilings, inclusive. No public shell
limit or shared contract is added. Counts use checked subtraction before allocation.

| Limit | Default | Accounting |
|---|---:|---|
| maxPatchBytes | 4 MiB | complete argv patch or copied stdin bytes before decoding |
| maxFiles | 256 | file-operation headers; Move is one operation |
| maxHunks | 4,096 | update hunks plus named anchor records |
| maxPathBytes | 16 KiB | each raw and normalized absolute UTF-8 path |
| maxPathComponents | 256 | raw nonempty components and normalized absolute components |
| maxFileBytes | 8 MiB | each original/revalidation read and each resulting file |
| maxReadBytes | 64 MiB | cumulative target bytes, including publication revalidation |
| maxStagedBytes | 32 MiB | sum of all proposed output-file bytes |
| maxLines | 262,144 | aggregate retained patch/original/output line records |
| maxInputChunks | 65,536 | every stdin chunk including empty chunks |
| maxFsCalls | 65,536 | every public VFS method invocation, not provider RPC count |
| maxWork | 128 Mi units | scanning/copying code units, compared units, records and probes |
| maxOutputBytes | 1 MiB | full precomputed success summary UTF-8 bytes |
| maxDiagnosticBytes | 16 KiB | command-owned diagnostic including prefix/newline |

Charge each inspected/copied code unit and record/probe before the operation;
compare one unit at a time or charge the complete bounded comparison before it.
Yield every 4,096 work units using interruptible setImmediate, checking signal
before/after and at final flush. Limit operations cannot allocate huge split/maps
before admission. Bound source fragment ownership with copying before next pull.
Limits are independent, not a promise all maxima can be reached together; no RSS,
whole-process memory, global deadline or hard host-work preemption claim.

Use existing supplied signal, sinks, readBytes/writeBytes and invocation cleanup
contracts. CommandContext has NO public shared Budget object: normal dispatch
charges already occur, supplied sinks retain shared output accounting; private
work/file caps neither reset nor substitute for that budget. No nested invoke is
needed. Register command-local close admission before acquiring owned input state;
same idempotent close in finally. Do not register an arbitrary pending host next
as cooperative owned work. readBytes owns its acquired iterator finalization on
early exit; raw uncooperative next/return has only existing late-rejection handling,
not a new public-settlement guarantee. VFS readFile(maxBytes) avoids inventing an
unregistered target-stream lease; provider methods own their internal cleanup.

No FS work is a child of stdout. Only final summary emission may use
createOutputOperation for destination-specific enrollment; closing stdout cannot
cancel sibling file/stderr effects. Await writes, emit <=16 KiB chunks, and retain
exact sink/caller reasons (including falsy/errno-shaped reasons). Check cancellation
before interpreting typed FS errors. Format/usage -> 2; matching, safety, limits or
typed FS failure -> 1; completed success -> 0. Unexpected provider/iterator/sink
rejections escape unchanged to existing runtime mapping, not coercion to usage.
Cleanup-only failure must not be hidden by a numeric result. Output failure after
publication does not roll back. Bound diagnostics without first building an
unbounded error/string; truncation reserves the ASCII suffix ` [truncated]\n`
inside maxDiagnosticBytes. Option values must leave at least 32 diagnostic bytes.
Invalid patch encoding is a format error (2); invalid target encoding is a
preflight content refusal (1). Existing parent shell argument/expansion/output
limits still apply even when smaller than this module's limits. No shared cap is
raised to fit this profile.

## Evidence plan and requested root decisions

`CASES-v1.json` is finite pre-implementation DATA, not an executable/pass count.
After policy GO: freeze author fixture bytes, implement, then run owned parser and
actual Shell/VFS tests; Memory, configured Real temp root, readonly/mount/overlay,
and injected S3/WebDAV profiles stay distinct. No native oracle required. Different
reviewer must challenge alias/late failure/output/cancel/resource mutations and
installed/moved module bindings before root/default integration.

Root must approve/replace R1 exact-first matching; R2 newline retention; R3 virtual
absolute paths with traversal/symlink refusal; R4 Add overwrite but absent-only
Move; R5 explicit unsupported-permission-probe handling. Also approve finite caps
and nontransactional publication profile. No new contract is needed for these
semantics. Atomic multi-file or race-proof replacement WOULD need stronger VFS
primitives and is not promised. No implementation starts merely from this seal.
