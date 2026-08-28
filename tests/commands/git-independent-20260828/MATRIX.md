# Finite independent future matrix

Status: **ALL UNRUN**. 72 scenario rows: A01–A60 (M1A), B01–B12 (M1B).
This denominator counts rows, not assertions, provider combinations, fixture
files or passes. A01–A06 preserve the author's six expectations; the other 66
rows are independent design vectors. They are not executed tests, sealed binary
holdouts or newly materialized repositories. ROOT choices R1–R6 remain proposed.

Basis: `N` = unchanged neutral fixture/expectation; `F` = documented format or CLI
obligation; `P` = proposed project restriction or engineering invariant. Combined
labels do not imply native Git enforces P. Source IDs resolve in SOURCES.md.
Every rejection below also requires a bounded diagnostic, no success-as-clean,
no product mutation or fallback. Exact native diagnostics are not presumed.

## M1A: six inherited workflows, 54 independent cases

| ID | Basis | Finite input / action and future obligation |
| --- | --- | --- |
| A01 | N | Neutral proposedOutputs[0]: porcelain v1/no-renames/uall; preserve exact four XY/untracked rows, status0; no invocation now. |
| A02 | N | Neutral [1]: working diff name-only; preserve `src/app.txt` expectation. |
| A03 | N | Neutral [2]: cached diff name-only; preserve README/obsolete expectation and order. |
| A04 | N | Neutral [3]: show HEAD:src/app.txt; preserve exact `two\n` bytes. |
| A05 | N | Neutral [4]: first-parent full-hash/subject log n2; preserve both complete rows. |
| A06 | N | Neutral [5]: ls-files -z; preserve two NUL-terminated index names. |
| A07 | P | Neutral nested under `/outer/repo`, cwd `/outer/repo/src`; boundary `/outer`; chained -C (0,8,9 operands), nearest unsupported nested `.git`, boundary escape; correct root or explicit refusal, no ancestor fallback. |
| A08 | F/P | Ordinary repo, in-bound relative gitfile, out-of-bound gitfile, metadata symlink and gitfile cycle; supported discovery only, no linked target content outside boundary (D03). |
| A09 | F/P | Two linked worktrees with distinct HEAD/index, common ordinary refs/config; enabled/disabled config.worktree with conflicting fileMode; correct per-worktree/common precedence, or ROOT-recorded whole-commondir refusal (D03/D04). |
| A10 | F/P | Bare copy of neutral metadata: truthful bare/inside/toplevel queries; log/show/tree-tree diff allowed, worktree forms refuse; no created worktree/index (D03/D09). |
| A11 | F/P | Detached HEAD; unborn main with empty index; then remove index from born neutral repo; distinguish no commits, staged HEAD deletions and untracked files from broken HEAD target (D13/D18). |
| A12 | F/P | Format0; format1 SHA1/files; SHA256; compatObjectFormat; unknown extension/version; refStorage URI; each admitted/refused according to R3 before decoding SHA1 widths (D01/D04). |
| A13 | F/P | Quoted/mixed-case config keys, booleans, duplicate scalar precedence, invalid escape, include/includeIf, core.worktree and core.bare conflict; no include loading or silent routing (D04). |
| A14 | P | Virtual routing env keys GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/GIT_COMMON_DIR/GIT_OBJECT_DIRECTORY/GIT_ALTERNATE_OBJECT_DIRECTORIES/GIT_CONFIG_COUNT/GIT_CONFIG_SYSTEM; each refuse; inert user/remote settings never invoke host code. |
| A15 | P | Empty pack plus loose graph; packed-only graph; orphan idx; `.promisor`; alternates/http-alternates; R2 preflight refuses each even when selected loose target exists; packed-refs-only control remains usable. |
| A16 | F/P | Add shallow marker, graft entry or refs/replace in loose then packed-refs; no truncated/root-like history or silent replacement bypass; reject admitted query per R2 (D03). |
| A17 | F/P | Loose branch overrides stale packed row; detached valid HEAD; malformed/duplicate packed row; orphan peeled row; reject malformed metadata, do not trust stale peeled hints over object type/content (D03/D11). |
| A18 | F/P | Symbolic HEAD chain length16/17, self/two-ref loop, missing target and malformed ref (`..`, `.lock`, control byte, backslash); finite traversal and precise missing-versus-unborn distinction (D11). |
| A19 | F/P | Annotated tag to commit, tag to tag, declared target-type mismatch, noncommit tag in log; rev-parse returns original tag OID, log peels to commit or refuses (D09/D10). |
| A20 | F/P | Same shorthand branch/tag; explicit qualified ref; full40 nonexistent OID; abbreviated OID; `HEAD^0`, `HEAD~1^1`, omitted digits, huge N and repeated suffixes; enforce frozen grammar/typing/caps, not native DWIM assumptions (D09/D10). |
| A21 | F/P | Two raw names sharing first7 hex digits, collision-free control, census32768/32769 names; abbreviation lengthens or refuses complete census, full hash avoids census; never invent collision-free prefix. |
| A22 | F/P | Status/diff/ls-files literal `src`, `src-old`, `:(literal)a*b`, global literal `:(literal)x`, ignored tracked file, empty operand; select component prefixes, not wildcard/ignore expansion; reject unsupported magic (D06/D12). |
| A23 | F/P | Neutral index version changed to3 with legal flags and recomputed checksum; v4; v2 extended bit; v3 reserved/intent/skip bits and assume-valid; explicit supported-versus-profile-refused outcomes (D02). |
| A24 | F/P | Index truncated header/body/trailer; checksum flip; count beyond remaining bytes; bad name length, padding, mode or unsigned byte/stage ordering; no preallocation from untrusted count (D02). |
| A25 | F/P | Valid unknown uppercase extension, TREE/FSMN/UNTR cache with false hints, oversized extension length, `link`, `sdir`; skip optional envelope only, refuse mandatory/split/sparse, don't derive clean from cache (D02). |
| A26 | F/P | One pathname with stage sets {1},{2},{3},{1,2},{1,3},{2,3},{1,2,3}; status codes DD/AU/UA/UD/DU/AA/UU respectively; stage listing retains all entries; selected index diff refuses under R4 (D02/D17/D18). |
| A27 | F/P | Duplicate stage; stage0+stage2; index path empty, leading slash, dot/dotdot/.git component, invalid UTF8, stage0 file/descendant collision; no merged/normalized fake entry. Cross-stage directory/file conflicts are a separate explicit M1 refusal, not declared invalid Git (D02). |
| A28 | F/P | Loose blob bodies empty, NUL, invalid UTF8, BOM, 0xff; valid header/hash and raw show preserve bytes exactly; text refusal is separate (D07/D15). |
| A29 | F/P | Loose header missing NUL/type/size, leading-zero size, negative/oversized decimal, length ±1, wrong object filename/hash; fail before exposing body (D07 plus strict P spelling). |
| A30 | P | Truncated zlib footer/body, checksum flip, appended byte/second member and small compressed expansion exceeding object cap; no partial raw show and no collect-then-check claim. |
| A31 | F/P | Tree siblings file `a.c` and directory `a`, modes 100644/100755/120000/40000; unsigned directory-aware order, raw OID width, duplicates and truncation; index comparator must not be substituted (D08). |
| A32 | F/P | Commit wrong/missing tree, malformed parent OID, duplicate required header; tag target type mismatch; tree mode160000; explicit corruption/profile refusal, not recursion into submodules (D07/D08). |
| A33 | P | Valid depth128/129 tree and shared subtree referenced twice; separate cycle/depth defense from legitimate DAG sharing; no permanent visited-set omission of second path; cumulative work remains charged. |
| A34 | F/P | Working bytes altered without size/mtime change; HEAD/index equal but working changed; staged+unstaged same path; hash actual bytes and preserve both XY columns (D18). |
| A35 | F/P | Working delete, staged delete then recreated untracked path, file↔directory obstruction, symlink↔regular change; correct type/deletion reporting, not recursive target read (D18). |
| A36 | F/P | core.fileMode false/true with executable bit changed; permissions false/unknown; mode-only staged versus working changes; truthful mode result or capability refusal, never guessed host inode semantics. |
| A37 | F/P | Symlink target text change, dangling link, target points outside root, absent readlink, non-roundtrippable target, core.symlinks=false; compare admitted link text or refuse; never read target bytes. |
| A38 | F/P | `.gitignore` `*.tmp`, tracked ignored tmp, nested override, info/exclude; last applicable rule/precedence, no tracked suppression (D06). |
| A39 | F/P | Ignore `build/` then `!build/keep`; `a/**/b`, leading/trailing slash, escaped space/#/!, bracket class, `?`, literal backslash; preserve parent pruning and finite byte-token work (D06). |
| A40 | F/P | Symlinked .gitignore; malformed/unhandled active pattern; core.excludesFile; no matches; reject unsupported policy rather than silently replacing ignored with untracked or clean (D06). |
| A41 | F/P | One all-untracked directory, one mixed tracked directory, empty directory, ignored-only directory; -uno/-unormal/-uall groups correctly and explicitly omits only requested untracked detail (D18). |
| A42 | F/P | TAB/LF/quote/backslash/Unicode pathnames; porcelain from subdir versus short, -z versus quoted; exact byte order/terminators, strict UTF8 admission, no JSON quoting (D17/D18). |
| A43 | F/P | Worktree attributes, missing worktree but indexed attributes, selected-tree attributes, info/attributes, core.attributesFile, autocrlf=input/true; comparison refusal under R4; raw blob show remains untransformed (D05). |
| A44 | F/P | Neutral diff default/cached/one REV/two REV, born versus unborn cached; independently freeze exact name-status bytes; no comparison-side inversion (D13). |
| A45 | F/P | New/deleted/empty text file, mode-only change, no final LF, CRLF/BOM; full-index patch and U0/U3/U100, invalid U101; `/dev/null` only correct header positions (D13). |
| A46 | P | Repeat-line tie and two individually-small files whose total cells exceed1000000; deterministic delete-first LCS, cumulative line/cell/work accounting, no per-file budget reset. |
| A47 | F/P | Binary change with NUL after byte8192 and invalidUTF8 without NUL; name-only/status/quiet/exit-code correct, patch refuses under R5; no native binary-heuristic claim. |
| A48 | F/P | Equal and changed inputs with diff default/exit-code/quiet, unsupported --binary/--raw/--no-index/rename flag; distinguish 0/1/129/128 and stderr, no false success. |
| A49 | F/P | First-parent merge whose parent timestamps reverse chronology; n0/n1/n2, omitted first-parent, cap2000/2001 and missing nonroot parent; follow graph order, no implicit history truncation (D14). |
| A50 | F/P | Empty subject, ordinary subject, multiline title, invalid encoding, NUL/ESC/CR controls, huge/malformed timestamp, message containing `%H`; bounded metadata presentation or named refusal; LF terminators, no evaluation (D14/D15). |
| A51 | F/P | show HEAD:path empty/blob/tree/nonexistent/`../x`, path with colon, option-looking ref after separator; exact raw blob only, correct parser boundaries and explicit unsupported presentation (D10/D15). |
| A52 | P | All 24 D1 limit keys at boundary and +1 in isolated future adapters; R1 fixed API also rejects override attempts. Injected local test counters may test edges without huge files; distinguish such counter tests from actual allocation acceptance. |
| A53 | P | Claimed huge stat, short reads, 65536/65537-byte producer chunks, 32768/32769 empty chunks, huge provider readdir array; reject before owned copying/growth; disclose preallocated external memory. |
| A54 | P | Borrowed Buffer with nonzero offset reused on next/final return; retained compressed/header/blob/diff fragments unchanged; completed awaited transient writes need no unnecessary copy. |
| A55 | P | Preabort reasons undefined/null/0/errno-shaped object, midread abort, codec abort; preserve actual reason provenance/identity and await registered cooperative cleanup; no fabricated fatal128. |
| A56 | P | Slow sink, rejected sink, stdout consumer close coincident with unrelated host failure; obey backpressure/outcome precedence; stderr/sibling scopes survive destination close. |
| A57 | P | Acquisition resolves late after close, overlapping close/finally, cleanup rejects, direct host omits hook; cleanup registered before start, no new admission, one shared release completion, observe late rejection. |
| A58 | P | Memory/read-only wrapper/Real new owned fixture/S3 mock/WebDAV loopback future adapters; mutations and invoke forbidden, lying-mode/case-alias/remapped namespace controls; no deployed-service or cross-provider inode inference. |
| A59 | P | Index/ref/body changes between observations; unreadable metadata error; arbitrary host getter side effect; selected change refusal where detected, no atomic/ABA/host-sandbox guarantee. |
| A60 | P | No stdin reads, no ambient fs/process/config/hook/filter/network route; no mutation methods; earlier complete log/diff record then later failure gives nonzero; raw show withheld; parent output budget defeats larger local allowance. |

## M1B: deferred, not M1A positives

These rows require independently generated/authenticated pack bytes later. None
exists here. They do not authorize pack construction or native commands now.

| ID | Basis | Finite input / action and future obligation |
| --- | --- | --- |
| B01 | F/P | Same neutral graph packed nondelta in pack v2 and v3/idxv2, loose copies removed; qualify A01–A06 unchanged under packed representation (D16). |
| B02 | F/P | OFS delta to earlier exact entry; distance128 multi-byte encoding; distance0, before-header and middle-of-entry references refuse (D16). |
| B03 | F/P | REF delta whose in-pack base occurs earlier then later; mixed REF/OFS chain; resolve type/body without recursion overflow (D16). |
| B04 | F/P | Delta-program size differs from result size; validate both, base-length mismatch and result under/overrun independently (D16). |
| B05 | F/P | Copy0x80 size-default65536 with sufficiently large base; partial offset-byte masks, insert1/127, opcode0 and truncated instruction; exact output or refusal (D16). |
| B06 | F/P | SHA1 pack/idx trailer corruption and mismatch; isolated entry CRC corruption including base/header bytes; checksums over correct domains, never POSIX cksum (D16). |
| B07 | F/P | Nonmonotone fanout, wrong bucket totals, unordered/duplicate OID, count mismatch, missing pack/idx; refuse before unsafe count-driven allocation (D16). |
| B08 | F/P | Large-offset index outside table, unsafe 64-bit offset, overlapping/duplicate/out-of-file offsets, trailing pack bytes; entry boundaries and limits before conversion/materialization (D16). |
| B09 | F/P | REF cycle, missing base and external thin base present only loose/other pack; explicit self-contained-pack profile refusal, never fetch or false missing-clean (D16). |
| B10 | P | Delta depth32/33, repeated shared bases/cache eviction, result-copy expansion beyond cumulative inflated/resident/work caps; no recharge omission or per-object reset. |
| B11 | F/P | Multiple valid packs with duplicate OIDs, acceleration-only MIDX/rev/bitmap alongside them, pack count8/9 and bytes33554432/+1; complete census or explicit refusal, not missed packed objects. |
| B12 | P | Packed reads with chunk reuse, truncation, cancellation and slow/closed output; reuse A54–A57 obligations, verify final OID before raw publication and drain owned resources. |

## Future qualification, not execution permission

F cases need literal frozen expected bytes and a separately authorized native
Git/version/platform oracle on a **new** fixture root. P cases primarily need
instrumented VFS/ownership assertions; native disagreement with a deliberate
restriction is a profile gap, not an oracle defect. A01–A06 are inherited data,
not six independently established semantic passes. No generated expectation may
be derived from the product parser/registry under test.

Freeze inputs, binary/tool provenance, argv, environment, cwd, stdout/stderr/status
and namespace/content effects before author execution. Preserve original expected
bytes and all later corrections beside each other. Source-module execution,
installed/moved-package/public integration and deployed backends are separate
future qualifications; this matrix does not certify them or reopen the gate.
