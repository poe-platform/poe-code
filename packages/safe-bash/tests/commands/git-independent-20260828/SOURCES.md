# Primary documentation actually consulted

Retrieved/read through the web tool on 2026-08-28 (America/Chicago). Only official
Git documentation and the Git project's tagged source are used for external
format claims. URLs below identify sources, not commands to execute. No native
Git version, release search, binary or oracle was run. A manual's displayed
last-updated edition is **not** a claim about the latest released Git.

The index page displayed 2.55.0, pack 2.54.0, layout 2.49.0. Other unversioned
manual URLs below are retrieval-date snapshots; no unobserved edition is assigned.
Web line positions identify the retrieved rendering and are not permanent anchors.
No entire manual, engine or downloaded source is vendored in this review.

| ID | Official locator / edition | Sections actually used |
| --- | --- | --- |
| D01 | `https://raw.githubusercontent.com/git/git/v2.55.0/Documentation/technical/repository-version.adoc` — tag v2.55.0 | Git Repository Format Versions; Version0/Version1, lines1–63; unknown version/extension admission. |
| D02 | `https://git-scm.com/docs/gitformat-index.html` — displayed2.55.0 | The Git index file has the following format; Index entry; Extensions/Cache tree/Resolve undo/Split index; Sparse Directory Entries, lines200–528. |
| D03 | `https://git-scm.com/docs/gitrepository-layout` — displayed2.49.0 | DESCRIPTION; objects/pack/alternates, refs/packed-refs/HEAD, info/grafts/exclude/attributes, shallow/commondir/worktrees, Git Repository Format Versions, lines218–425. |
| D04 | `https://git-scm.com/docs/git-config` — dated unversioned retrieval | --worktree/FILES; extensions.* (objectFormat, compatObjectFormat, partialClone, refStorage, worktreeConfig), lines464/644/2385–2463. Configuration choices beyond these sections are explicitly reviewer recommendations, not quoted native rules. |
| D05 | `https://git-scm.com/docs/gitattributes` — dated unversioned retrieval | DESCRIPTION precedence/index fallback, lines244–283; text/eol/ident; NOTES symlink behavior, lines807–809. |
| D06 | `https://git-scm.com/docs/gitignore` — displayed2.55.0 | DESCRIPTION, PATTERN FORMAT, CONFIGURATION, NOTES, lines223–274; tracked versus untracked and excluded-parent behavior. |
| D07 | `https://git-scm.com/book/en/v2/Git-Internals-Git-Objects` — Pro Git second edition, dated retrieval | Tree Objects/Commit Objects; Object Storage, especially lines380–409 for header/hash/zlib. This is explanatory format evidence, not strict-parser acceptance evidence. |
| D08 | `https://raw.githubusercontent.com/git/git/v2.55.0/tree.c` — tag v2.55.0 | `base_name_compare`, lines94–109 in web rendering; `df_name_compare` explanation, lines111–118. Read only, no import or compilation. |
| D09 | `https://git-scm.com/docs/git-rev-parse` — dated unversioned retrieval | Options for Output/--verify and --short, lines321–336. Existence verification is not implied by native plain --verify. |
| D10 | `https://git-scm.com/docs/gitrevisions` — displayed2.42.0 | SPECIFYING REVISIONS, ref disambiguation and parent/peeling selectors, lines227–252,333–349; broader language is not adopted. |
| D11 | `https://git-scm.com/docs/git-check-ref-format` — displayed2.52.0 | DESCRIPTION name restrictions, lines208–241; no execution of the examples. |
| D12 | `https://git-scm.com/docs/gitglossary` — dated unversioned retrieval | pathspec/literal/glob/attr entries, especially lines462–485; tree/tree-ish entries, lines659–668. |
| D13 | `https://git-scm.com/docs/git-diff` — dated unversioned retrieval | DESCRIPTION comparison forms, lines279–310; --exit-code/--quiet/--no-ext-diff/--no-textconv, lines781–800; Raw output format and Generating patch text with -p, lines876–1020. Raw format inspection does not add --raw support. |
| D14 | `https://git-scm.com/docs/git-log` — dated unversioned retrieval | --first-parent, lines509–513; PRETTY FORMATS/format placeholders, lines1105–1131. Exact subject folding/date parser acceptance remains a closure/oracle question, not inferred from a placeholder name. |
| D15 | `https://git-scm.com/docs/git-show` — dated unversioned retrieval | DESCRIPTION, lines276–286: commit/tag/tree presentation versus plain blob contents. |
| D16 | `https://git-scm.com/docs/gitformat-pack` — displayed2.54.0 | Checksums and object IDs; pack header/object/size/delta/instruction/offset encoding; idx v1 trailer and Version2 layout, lines210–408. No unrelated MIDX algorithm is required. |
| D17 | `https://git-scm.com/docs/git-ls-files` — dated unversioned retrieval | --stage/-z/--deduplicate and OUTPUT, lines279–315,433–443; cwd-relative discussion at397. |
| D18 | `https://git-scm.com/docs/git-status` — dated unversioned retrieval | Short Format/XY/unmerged table, lines394–459; Porcelain Format Version1, lines485–493. |

## Accessible versus unavailable

Every D01–D18 locator above returned usable content and relevant sections were
read. The attempted `https://git-scm.com/docs/gitformat-repository` lookup (twice)
did not yield a usable document in the tool response. This is an unavailable
lookup, not a proved HTTP403 or fabricated retrieval; repository-version evidence
comes from the accessible D01 and D03 instead. No local/native fallback was used.
The author's historical failed Node-doc lookup is not our retrieval; no Node
API-documentation/version guarantee is added here.

## Evidence interpretation

Factual format references justify parser invariants. Project recommendations
(fixed limits, fail-closed supported subset, metadata control rejection,
binary-patch refusal, UTF8 path admission, no native/ambient execution) are marked
as project choices, not attributed to upstream Git. No third-party implementation,
search snippet, user-provided oracle correction or passing test is substituted
for the official sections. Local code and packet hashes are recorded separately
in BINDINGS.json.
