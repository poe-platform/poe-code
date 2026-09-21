# Bounded hyperlink utility

Scope: `links.list`, `links.add`, `links.set` and `links.remove` in the original
TypeScript DOCX engine. Later tasks remain pending. This record restores the
missing destination already linked by the format specification and API audit;
it does not replace historical research or claim whole-public-API conformance.

## Behavior and ownership

- Add appends explicit label text to a selected paragraph, including table cells.
- Set changes only the destination, preserving existing styled label runs and
  history, and clearing separate anchor/document-location attributes.
- Remove unwraps visible label XML by default; `deleteContent: true` explicitly
  deletes the complete label content.
- Relationships belong to the containing story part. Reused relationships remain
  until their last stored reference disappears, including dormant compatibility
  branches. Unselected owners remain unchanged. Ambiguous shared stories reject.
- New targets accept absolute HTTP/HTTPS and nonempty mailto paths, or explicit
  internal bookmark names. Whitespace, controls, backslashes, malformed percent
  escapes and credentials reject. Empty HTTP user information also rejects:
  the URL parser normalizes `https://@coast.invalid` and `http://:@coast.invalid`,
  so validation must inspect the original authority before accepting the target.
- Existing unsafe targets remain inspectable/removable as inert stored data.
  Targets, percent escapes and fragments are never fetched or normalized.

## Exact JavaScript and security mappings

Utility SDK calls are async `inspectDocumentLinks(bytes, options, context)` and
`editDocumentLinks(bytes, request, context)`. Inputs are admitted byte arrays;
publication uses explicitly supplied sinks/VFS capabilities. CLI plural resource
paths call that engine, camelCase options map to kebab-case flags, and JSON uses
the shared version-1 envelope. Invalid destinations fail with SDK code `usage`
and CLI status 2 before input reads. No ambient host access, clock, identity,
network, reference runtime or downloaded fixtures are needed.

Read snapshots retain `text`, `address`, `fragment`, `url`, `history` and
`contains_page_break`. Internal-only links have an empty `url`. An external URL
appends the separate anchor with `#` even when its stored address already has a
fragment. Model spellings remain neutral snake_case; this utility does not add
aliases or model setters. The existing `Hyperlink` live read view and
`Paragraph.hyperlinks`/`iter_inner_content` are separate implementations, not
new work in this task. The pinned API inventory remains historical: inherited
`part`, run sequences, helper/enum/collection obligations, prose-only members and
public underscore-prefixed owners are neither excluded nor promoted by these
utility regressions. Whole-model mutation and whole-public-API coverage remain
pending.

## Validation

Original memfs regressions in `links.test.ts` and `links-command.test.ts` cover
body/header ownership in both dialects, table cells, styled labels, shared and
last-use relationships, escaped targets, separate fragments, explicit deletion,
nonexecution and common discovery/error contracts. New empty-user-information
cases failed before code changes: CLI attempted input reads (status 3 instead
of 2), and SDK add accepted the targets. The shared validator now rejects them
for add/set; all 50 focused hyperlink cases pass, including an accepted target
with `@` in its path/query/fragment rather than its authority.

The selected DOCX workspace build closure and maintained workspace lint pass
(lint has one warning in an unchanged type-only test). The human usage diagnostic
was captured and visually inspected; the temporary screenshot is disposable.
The maintained DOCX workspace test passes: 245 files and 5,115 tests. The final
focused hyperlink rerun passes all 50 cases after preserving original test names.
Commit only the validator, owned regressions and this record on main, without
pushing or releasing.
