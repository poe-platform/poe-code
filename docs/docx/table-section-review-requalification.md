# Table, section and review API requalification

Scope: `sdk-table-section-review-api` only. The current live graph already
implements the requested containers. Later tasks were not started. Root
instructions apply; no additional scoped AGENTS.md exists under packages/docx.
The parent pipeline plan and unrelated working-tree changes are preserved.
Ownership and agent QA procedure are in the
[task plan](../plans/docx-table-section-review-requalification.md).

## Validated correction

An original small memfs regression failed before implementation: calling
`Comments.add_comment` with a NUL in its text rejected the XML but left a newly
created Comment Text style in the admitted archive. Creation now wraps style
resolution and comment insertion in the existing model transaction. It restores
archive bytes and live style ownership on failure, and leaves ID zero available
for subsequent valid creation. Three original cases cover invalid text, author
and initials, successful recovery and memfs save/reload. No competing editor,
host I/O, native runtime, network, publisher input or cloned binary is used.

## Surface and language/security reconciliation

The pinned API inventory contains 920 records. Its scoped closures remain 52
table, 45 section and 33 comment/hyperlink/cached-break rows, including inherited
part interfaces, sequence protocols and documentation errors. Exact member
mappings remain in [table](table-model-api.md),
[section](section-model-api.md) and [review](review-model-api.md) evidence.
The test inventory contains 1,609 unit variants and 650 expanded BDD examples;
the relevant unit files contain 150 table, 93 section, 22 comment, 25 hyperlink
and eight cached-break records. These are research counts, not new TS passes.
APIs without source tests retain original acceptance obligations. Historical
inventory dispositions are not rewritten as execution receipts.

| Behavior | Exact JS/security mapping and original acceptance |
| --- | --- |
| Omitted/empty/merged cells | Missing logical coordinates throw BoundsError; actual empty cells return empty text; repeated span coordinates share owner/node edits. table-model.test.ts |
| Ordered nested blocks | Direct paragraph/table iter_inner_content preserves order; paragraph text excludes nested tables. table-model.test.ts and review-model.test.ts |
| Sections/linked stories | Zero-based live sequence with at, slice and iteration; six separate first/even/default slots inherit recursively; content getters may create definitions, utility reads do not. section-model.test.ts |
| Rich comments/ranges | Ordered paragraphs/tables and owned runs; whole ordered run endpoints span intervening content; forbidden stories/nesting/controlled ranges reject before creation. review-model.test.ts |
| Metadata/drift | Readonly comment_id and fresh UTC Date timestamp or null; writable author/nullable initials; absent ID lookup returns null. No id/date, Comment.add_run or Comments.paragraphs aliases. review-model.test.ts |
| Hyperlinks | Owned run traversal, separate stored address/fragment, inert external targets, no resolution/network. review-model.test.ts |
| Cached breaks | Detached fragments preserve formatting; whole split hyperlink goes before boundary; empty boundary fragments are null; later-break extraction rejects until the first is processed. review-model.test.ts |
| I/O/values/owners | Async admission/save through explicit byte capabilities; synchronous admitted access, typed Length/null/enums, bounded XML/package views, stale discarded owners and transaction rollback |
| CLI | Existing versioned closed typed batch calls the same SDK domain; camelCase operation options remain distinct from neutral snake_case model members. structure-model-command.test.ts |

The built public SDK declares 1,517 operations. Direct inspection verified
images.list, tables.list, properties.list, text.replace, schema, capabilities
and model.comments.Comments.add_comment.call, and absence of the documented typo
aliases. Discovery counts are not operation-behavior pass counts. Existing real
command cases cover versioned JSON, dry-run, binary publication, explicit
timestamp and trusted publication ceilings. Public underscore-prefixed types,
enums, helpers and inherited interfaces remain accounted for in their registers;
whole-public-API/source-case/renderer conformance is not claimed by this task.

## Verification

- Initial focused red: one test failed at archive-byte equality after rejected
  content (1.83 seconds).
- Focused green: five files, 63 cases passed; the expanded invalid-field matrix
  subsequently passed all three cases (2.94 seconds, 451 ms test execution).
- Maintained selected fresh build: `npm run build:workspaces -- --workspace=docx
  --no-cache` passed its declared five-build closure, using portable safe-fs.
- Maintained `npm run lint --workspace=docx` passed with no errors and one
  type-only unused-variable warning in operation-types.test.ts:20.

The first package invocation accidentally selected the entire package rather
than only the new regression, and was stopped with SIGINT. It is not a passing
gate. A fresh complete maintained single-worker package run qualifies final
delivery below. This correction changes archive rollback only; human help,
messages and CLI layout are unchanged, so no visual CLI change is claimed.
No ignored fixtures or disposable output are staged. Delivery is local main
only; push and release remain unauthorized.

Final maintained `npm test --workspace=docx -- --maxWorkers=1`: exit 0,
247 files and 5,147 tests passed, zero failures/skips, 399.46 seconds. The final
run included all three invalid-field cases with their typed InvalidValueError
assertion. Invalid structured XML values retain that existing neutral usage
error category; the rollback correction does not change the public error.
The seven closed registry and four SDK-backed command cases also passed in an
independent focused run. Final package lint passed after the typed assertion
change. The scoped task is qualified against the current graph; broader API
adaptation, corpus and renderer claims remain outside this result.
