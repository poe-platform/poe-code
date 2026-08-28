# Git M1A additive author closure

Status: Author closure under ROOT ratification70ba55eaaa705307eec5b985fc3d8963f6764159
and implementation grant; different-agent source acceptance still required.
Implemented Through: Not applicable at this pre-implementation seal.
Purpose: Make the ratified loose/index profile executable without rewriting589d1d93.

## Authority, API and storage

Only src/commands/git/** and tests/commands/git-author-20260828/** are authored.
Product base MUST be authenticated coherent78/8437e4eda904e1248c25eeef0d9d455b1d251495
plus new Git files; no moving runtime/arrays/YQ/XAN or root manifest/export edits.
`createGitCommand`, `createGitCommands`, `gitCommands` accept only own-data
`replace?: boolean`, `discoveryBoundary?: string`. Unknown properties, accessors,
symbols and invalid values fail before acquisition; cross-realm records do not
require a particular prototype. There is no public limits/codec/host injection.
Existing package exports do NOT expose this new family: installed/moved tests use
authenticated installed leaf paths, not a claim of public root/subpath registration.

Discovery MUST select nearest .git DIRECTORY or bare directory with HEAD/objects.
A .git file, commondir, gitdir marker, config.worktree, worktrees routing, shallow,
info/grafts, objects/info/alternates or http-alternates, nonempty objects/pack,
any .pack/.idx/.promisor member, refs/replace (loose or packed), reftable, partial/
promisor configuration, or unsupported format MUST refuse128 before success output.
An empty objects/pack directory is allowed. Metadata components MUST NOT be symlinks.
Only standard two-hex fanout loose objects and empty/inert info/pack directories
are admitted as object storage. Unknown storage entries refuse, not get ignored.
Packed-refs is supported and is not packed-object storage. Gates run even for
rev-parse/ls-files/n0; no mixed loose/packed exception. Bare permits metadata,
history/raw-show/tree-tree diff, not index/working-tree-dependent operations.

## Exact local config table

Read gitdir/config only; absent means format0 and discovered bare value, fileMode
true, symlinks true, ignorecase false, byte-content/no-renames profile. Parse ASCII
section/key syntax, quoted subsection names and quoted values with Git's simple
backslash escapes; inline comments outside quotes, duplicate keys last-value-wins.
Malformed syntax, continuation lines, NUL and unsupported escapes refuse128.
All keys not explicitly admitted below refuse128; this is conservative profile
admission, not a claim that native Git rejects them.

| Key | Admitted values / behavior |
| --- | --- |
| core.repositoryformatversion | 0 only; any extensions.* or version1+ refused |
| core.bare | bool consistent with discovered layout |
| core.filemode | bool; absent/true requires permissions:true for working regular-file mode comparison; false compares bytes/type without guessing executable mode |
| core.symlinks | true only; false is an unsupported materialized-link profile |
| core.ignorecase, core.precomposeunicode, core.autocrlf, core.safecrlf | false only |
| core.eol | lf only; still no active attributes/conversion |
| core.quotepath | true only; output is fixed C-byte quoting |
| core.abbrev | 7 only; complete bounded census still ensures uniqueness |
| diff.renames, status.renames | false only |
| diff.context | 3 only; explicit CLI -U can select0..100 |
| status.relativepaths | true only; porcelain remains repository-root relative |
| core.logallrefupdates | valid bool, ignored: no mutation occurs |
| user.name, user.email | bounded inert strings, ignored |
| remote.<name>.url/fetch/pushurl, branch.<name>.remote/merge/description | bounded inert strings, ignored; never route/fetch/execute |
| include.*, includeif.*, alias.*, filter.*, diff drivers, core.worktree/excludesfile/attributesfile/pager, all extensions and all other keys | refused |

Virtual env GIT_* routing/config/algorithm variables refuse, except
GIT_OPTIONAL_LOCKS=0/1, GIT_PAGER empty/cat and GIT_TERMINAL_PROMPT=0 which are inert
under this no-exec/read-only profile. No process.env/HOME/system config reads.

## Objects, index and REV closure

Loose framing MUST be zlib with one complete member, no dictionary/trailing bytes,
canonical `blob|tree|commit|tag SP decimal-size NUL`, no leading zeros except0,
128-byte header, exact body length and SHA1 filename/header/body agreement.
node:zlib/crypto are permitted library APIs, not host-process fallbacks. Streaming
inflation reserves bounded output before growth and verifies consumed compressed
input. All object bytes are verified before raw show. Malformed codec data is128;
caller/host/sink failures are not recast as codec corruption.

Tree modes:40000/100644/100755/120000, with referenced object type validation;
160000 refuses. Tree comparison uses unsigned names terminated by slash for dirs;
index uses full unsigned path bytes then stage. Reject duplicate/bad/invalid-UTF8
names, .git case aliases, NUL, absolute/traversal and file-directory collisions.
DIRC v2/v3/checksum/padding/envelopes are verified. v2 extended flag refuses;
v3 only zero extended flags admitted. Assume-valid/intent-to-add/skip-worktree,
split/sparse/v4 refuse. Uppercase optional extensions are length-checked/skipped,
not trusted caches. Stage0 cannot coexist with stages1–3 or duplicate stages.

REV is HEAD/full40-hex/fullref/unambiguous heads-or-tags shorthand followed by
zero or more left-to-right ^/~ suffixes. Omitted digits mean1; ^0 peels to commit,
~0 validates commit and selects itself; ^N selects Nth parent; ~N repeats first
parent. Missing parents/type mismatches fail128. No negative/overflow counters,
reflogs/ranges/other peeling. Full OID must exist; rev-parse tag returns tag OID
unless ancestry requested. Consumers peel tags with declared target-type checks,
depth16/cycle checks. Commit has one tree/author/committer, parents as40hex; bounded
decimal timestamp with optional minus and valid +/-HHMM (HH<=23,MM<=59), bounded
strict UTF8 identity. Unknown/duplicate headers/continuations are refused.
Tag has one object/type/tag and optional tagger, no signature verification.

REV:path uses repo-tree-relative nonempty literal paths; ./, ../, absolute or
trailing-slash forms refuse. Ordinary pathspecs are effective-cwd relative within
worktree with component-prefix matching; global literal mode or :(literal) admits
literal magic characters. Other wildcards/magic/empty specs refuse129. Abbreviated
input OIDs unsupported; output prefixes begin7 and lengthen against complete
bounded loose-name census. Census exhaustion fails, not ambiguous output.

## Observable query semantics

Keep README589 command grammar except ratified discovery/storage changes. Status
requires short/porcelain; -z implies porcelain v1. Porcelain paths root-relative;
short paths effective-cwd relative. Sort raw UTF8 bytes; tracked first, untracked
last. C quote space/control/high bytes with octal for non-ASCII; -z stays raw.
Unmerged masks1/2/3/12/13/23/123 => DD/AU/UA/UD/DU/AA/UU. No renames. Selected
unmerged diff refuses128, not combined/ordinary diff. Missing index is empty but
does not erase HEAD differences; unborn HEAD is distinct from corrupt/missing OID.
Working files are hashed regardless of stat cache. Directory obstruction acts as
tracked deletion; symlink-vs-regular is type change. Readlink text is compared, never
follow target; unknown/nonroundtrippable link behavior refuses. No mutator calls.

Ignore domain: bounded strict-UTF8 .gitignore per traversed directory + info/exclude,
last matching rule, nested precedence, leading/slash anchoring, directory-only,
escaped space/#/!, *,?, ASCII bracket ranges/negation, slash-aware **. POSIX bracket
classes and malformed/unhandled escapes/ranges refuse. Excluded directories are
not descended for negation; tracked entries are never hidden. Symlinked ignore
files refuse. -uno need not load ignore files. Untracked normal groups only wholly
untracked dirs that contain visible files; empty/ignored-only dirs do not print.
All metadata/index/tree/worktree records and matcher transitions consume counters.

Content-comparison status/diff conservatively refuses any nonblank/noncomment
attribute line in info/attributes, relevant worktree .gitattributes, or selected
tree/index .gitattributes fallback; metadata-only queries/raw show do not apply
attributes. Config routing/conversion refusal still applies to every command.
No symlinked attribute-file contents are followed. This may refuse inert rules.

Patch text domain: strict UTF8, no NUL, preserving BOM/CR/final LF. Binary/invalid
UTF8 patch presentation fails128; names/quiet/exit-code/raw show compare exact bytes.
Algorithm: trim equal prefix/suffix, cumulative bounded LCS, delete-first ties,
context3 or U0..100. Git headers use a/b paths, six-digit modes and /dev/null only
file-side add/delete headers; include missing-final-LF markers. Type changes are
delete plus add, not a false ordinary mode-only diff. Proof is patch applicability,
not every native hunk choice. --quiet/--exit-code return1 for differences, default
diff returns0; failure128/usage129 are not differences. --quiet has no stdout.

Log requires --first-parent and accepted format/oneline. n0 selects no commits but
still runs repository admission. Exhausted default max2000 with another parent
fails, not silent truncation. Full %H avoids subject rendering; subject format
allows one printable strict-UTF8 title (empty allowed), followed by empty line/body;
multiline title, controls, encoding headers refuse. Percent characters are literal.
History is first-parent order, not timestamps. Output records end LF. Raw show is
blob only. Earlier complete history/diff records may survive a later nonzero failure;
status/list and raw blob withhold until selected data validated.

## Fixed caps, lifecycle and qualification

All24 values in PRESEAL.json are fixed ceilings, no overrides. maxEntries is
cumulative index/tree/readdir records, diff cells/lines across files, all reads and
inflations across rereads; census counts distinct names. Yield/signal check within
4096 explicit work units; hashing, scans, comparisons and empty chunks count.
Own byte reservations precede allocation/copies. Provider arrays/chunks and codec
internals are not hard RSS/CPU accounting. No opaque host preemption guarantee.

Validate options/CLI under original caller; createOutputOperation before repository
acquisition. Register readers/codecs before activation, preserve borrowed chunks,
await owned cleanup. Required stderr uses original context, stdout charged once
through operation.output. Caller abort wins; actual escaping host/sink failure
wins over cleanup. Only locally observed consumer-close control may map to141;
mere reason equality/aborted flag does not swallow an unrelated error. Raw host
errors (including falsy values) remain escaping. Local Git failures map128/129.
Read-only provider effects/atime and namespace ABA/TOCTOU remain explicit limits.

No unresolved policy expansion is required. Native oracle six workflows remain
UNRUN. M1B twelve cases remain deferred, not M1A passes. Author execution is limited
to PRESEAL; independent source/package review is required after author handoff.
