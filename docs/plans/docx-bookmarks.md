# Bounded DOCX bookmark ranges

Status: bounded implementation complete and verified locally.
Scope: only this task on main, with an owned local commit; no push/release.
The unrelated edits to docx-typescript-safe-bash.md and all later tasks remain
pending and outside this commit. No reference runtime, downloaded fixture,
product networking, ambient filesystem access or README additions are involved.

## Implemented contract

`inspectDocumentBookmarks(bytes, options, context)` and
`editDocumentBookmarks(bytes, request, context)` are always-async utility APIs.
The existing command engine exposes bookmarks list/add/set/remove and safe-bash
uses that engine. Product behavior is in packages/docx; root wiring is unchanged.

Creation requires a nonempty paragraph Unicode-scalar range token produced by
`DocumentLocations.range`. It splits simple runs at scalar boundaries, preserving
formatting, Unicode text, paragraph XML annotations and existing range markers.
A paragraph in a table cell is supported. Creation through fields, hyperlinks,
tracked/controlled wrappers or opaque run content rejects. It does not introduce
a second range syntax, implicit paragraph selection or cross-paragraph creation.
Existing ranges between paragraphs in the same story/container can be inspected,
renamed and removed, including within one table cell.

Names are 1–40 ASCII letters/digits/underscore, beginning with a letter or
underscore, including conventional hidden names. Names and decimal IDs must be
unique across the stored document; allocation picks the lowest unused nonnegative
ID. Leading-zero IDs compare numerically. This bounded mutation profile is more
restrictive than story-scoped ID reuse: reused IDs in different stories reject
instead of conflating owners. No caller-supplied ID or implicit renaming exists. Common selectors are narrowed
to applicable owners and one explicit mutation target; bulk rename/removal and
cross-paragraph creation are outside this bounded profile.

Inspection checks all stored XML parts for missing starts/ends, duplicate names
or IDs, reversed ends, illegal parents/containers, complex-field instruction
boundaries, nested overlaps and crossings. Any such diagnostics block edits.
Malformed input returns document-wide `issues` with empty `items`, because the
ordinary location engine cannot issue usable handles for semantically invalid
packages. Valid input yields selected starts with ID/name, revision-bound
bookmark location, paired end part/path and empty issues. End addresses are
structural diagnostics, not independent mutation tokens. Existing annotation
inventory/resolve behavior is retained alongside the additive bookmark kind.

Mutations require one explicit range/resource. Set requires references=update or
reject; removal requires references=remove or reject. Same-name set is a no-op.
Reject blocks dependent edits. Update changes literal internal hyperlink anchors
and simple/complex REF/PAGEREF operands, including operands split across multiple
instruction text nodes. Quoting, switches, unrelated fields, XML annotations and
cached results remain unchanged; no field is executed or recalculated. External
relationship anchors are separate destination data and remain unchanged.

Removal deletes only bookmark markers. With references=remove, supported internal
hyperlinks and simple reference fields unwrap to their original displayed
content, retaining annotations. Complex-field removal, nested dependent complex
fields, malformed delimiters, deleted/opaque potentially dependent instructions
and unwraps that would lose local namespace or XML inheritance reject explicitly.
Stacks are isolated across stories, including textboxes. Unknown XML attributes
or text with a potential matching dependency block edits conservatively. Detached
or stale revision tokens reject before publication. Shared story ownership uses
the existing ambiguity guard. All output uses existing budgets, cancellation,
dry-run, binary stdout and atomic VFS publication rules.

## Exact JS/security mappings and documentation drift

Read docs/specs/docx.md, office-cli.md, office-sdk.md and the pinned public API
inventory/audit. The inventory remains historical; this utility milestone does
not promote unrelated model rows to implemented or hide underscore-prefixed
public interfaces. The F21 standards register identifies ECMA-376 Part 1
§§17.13.6 and 17.16, CT_Bookmark/CT_MarkupRange/CT_Hyperlink, and Part 2 §6.5.
No new standards revision, downloaded source or certification claim is made.

| Surface | Exact mapping / remaining obligation |
| --- | --- |
| Bookmark utility | Owned Uint8Array input, Promise<BookmarkListData/BookmarkEditData>, closed camelCase options, explicit injected streams/VFS/limits/signal; no ambient environment options. These are original additive operations, not invented live model aliases. |
| Selection | One-based CLI ordinal bookmark, scoped table/cell/story ownership; Unicode-scalar offsets in revision-bound tokens. Arrays use JS length/iteration; no Python indexing/coercion is inferred for utility results. Existing annotation query behavior is preserved. |
| Values | Strings and booleans without coercion; name absence/null/invalid syntax rejects. ID values are stored decimal strings and checked numerically. No environment, clock, filesystem or network capability is acquired. |
| Hyperlink.fragment/address/url/text/runs | Existing inventory retains neutral names, readonly values and ordered live Run collections as planned. This engine edits stored anchor attributes; it does not implement live getters or change address/fragment assembly. |
| Hyperlink.part / Paragraph.hyperlinks / iter_inner_content | Inherited bounded part view remains security-mapped; live owner and ordered Run/Hyperlink traversal remain planned. No public inherited member is hidden or declared complete by bookmark tests. |
| Run / paragraph / table / story APIs | Existing owner-bound methods, destructive text setter semantics, enums, helpers, zero-based live collections and public _Cell/_Header/_Footer obligations remain pending except previously recorded implementations. Bookmark preservation does not claim complete model coverage. |
| Field mapping | Literal REF/PAGEREF operands are parsed without regex, eval or executing instructions; cached values are retained. Complex removal and unverified instructions reject; general field/batch/model APIs remain later tasks. |
| Errors/publication | Existing usage exit 2, invalid/unsupported/stale/ambiguous edit exit 1, publication failures exit 3, resource limits exit 4 and cancellation exit 130. Listing malformed bookmarks reports diagnostics without inventing valid mutation handles. |
| Grammar correction | Earlier short F21 prose required existing destinations and ASCII-letter-only names, conflicting with the implemented link grammar. Align it with section 9.1: link destinations may be unresolved; authorable bookmark names permit leading underscore. Missing ends/dependencies still block unsafe bookmark mutation. |
| Discovery | Advertise only bounded list/add/set/remove and exact result shapes, retaining broader F21 and whole-model limitations. Numeric bookmark selectors remain separate from links.add/set string bookmark destinations. |

No reference-project names, links, copied assets or derived implementations are
added to product source, tests, identifiers or output. Tests use original coastal
wording and authored OOXML with memfs for every file mutation. No additional legal
notice is required for these independently authored cases.

## Test-first evidence

- `/tmp/docx-bookmarks-red.log`: all first 15 core regressions failed on absent
  exports before bookmarks.ts/index implementation.
- Reference engine first failed for missing module; its original 12 cases then
  passed. Nine additional safety failures preceded the neutral-root, XML
  inheritance and story-isolation fixes; final reference suite has 26 cases. The last four failures and green run are
  recorded in `/tmp/docx-bookmark-reference-final-red.log` and
  `/tmp/docx-bookmark-reference-final-green.log`. Earlier reference failures are
  retained in the tool transcript, not separate filesystem logs.
- Initial command tests failed on absent dispatch and help. A further red test
  proved loss of the original annotation inventory; additive indexing corrected
  it without dropping the original annotation behavior.
- Core runs exposed unknown bookmark location admission before its allowlist fix
  and zero-width marker range rejection before the location-range correction.
- `/tmp/docx-bookmarks-field-boundary-red.log`: a new complex-field bookmark
  boundary was accepted without diagnostic. The same case passed after tracking
  field depth at marker positions; green evidence has the corresponding suffix.
- `/tmp/docx-bookmarks-hidden-red.log`: the new hidden-name creation case failed
  before aligning the bookmark authoring grammar with existing internal targets.
- `/tmp/docx-bookmarks-diagnostics-red.log`: malformed human listing was empty
  despite JSON issues. The CLI now prints escaped issues; its four tests passed
  in `/tmp/docx-bookmarks-diagnostics-green.log` before final maintained checks.
- Test setup corrections: real comments require a comments part; scalar ranges
  through unsupported field content already fail at range construction; cell
  coordinates belong to explicit cell selection, not all descendant positions.
  These new test expectations were corrected to the original contracts. Existing
  tests were retained. Supplemental lifecycle cases were green on first execution
  and are not claimed as pre-code failures.

## QA procedure and results

Execute the actual DOCX command engine for bookmark remove help, list, removal dry-run
and missing reference policy, then render the captured terminal output with the
maintained terminal-png renderer. Inspect `/tmp/docx-bookmarks-cli.png`: the
agent and root inspections found clear policy help, inventory, dry-run and
exit-2 diagnostic with no clipped text. The optional docx plugin is not a root
poe-code route; no product root CLI command is invented for screenshots.

Also inspect `/tmp/docx-bookmarks-malformed-cli.png`: both worker and root
verified readable missing-end/missing-start diagnostics and inspection exit 0.

Run the original DOCX workspace suite/lint, selected workspace build closure,
portable export tests, every existing safe-bash docx test plus the new memfs .sh
binary-stdin/pipe case, and exact active-file discovery gate. Keep disposable
logs/screenshots outside the commit. Do not use Word/native reference execution,
network downloads or ambient product I/O for verification.

## Final verification

Verified on 2026-09-14 after the final product changes:

- `npm test --workspace=docx`: 67 files, 1,730 tests passed, including 22 core,
  26 reference and four CLI regressions. Log: `/tmp/docx-bookmarks-verified-test.log`.
- `npm run lint --workspace=docx`: ESLint plus source/test TypeScript passed.
  Log: `/tmp/docx-bookmarks-verified-lint.log`.
- `npm run build:workspaces -- --workspace=docx`: maintained five-workspace build
  closure and native postbuild routes passed. Log: `/tmp/docx-bookmarks-verified-build.log`.
- `node --import tsx --test packages/safe-bash/tests/commands/docx/*.test.ts`:
  all 41 passed, no skipped cases. Log: `/tmp/docx-bookmarks-shell-final.log`.
- Portable root export checks plus CLI/discovery checks: all 14 passed (including
  both scripts/docx-exports.test.ts cases). Log: `/tmp/docx-bookmarks-cli-exports-final.log`.
- Maintained exact active-test discovery gate passed; this proves registration,
  not execution of every safe-bash test. Log: `/tmp/docx-bookmarks-discovery-final.log`.
- Explicit ESLint of the new safe-bash test and its discovery registration passed.
- Both disposable screenshots were inspected; `git diff --check` passed.

Two intermediate package runs overlapped addition of red regressions and are
retained as failure evidence, not reported as passing baselines. The final run
above used the completed product files and passed all original and new tests.

All owned files and this plan form one atomic bookmark implementation commit.
The unrelated pipeline plan remains unstaged. Later tasks remain pending. No
remote delivery, release, full-root suite, document-renderer or whole-public-API
pass is claimed.
