# Live text object surface evidence

This receipt extends the existing format models; it does not establish whole
public API coverage. The authoritative inventory remains visible and unchanged.
No publisher deck, cloned binary, reference runtime or network was used.

## Implemented mappings

| Source obligation       | JavaScript behavior                                                                                                                                | Original evidence                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| TextFrame.paragraphs    | Frozen readonly membership snapshot containing live Paragraph instances; getter creates no XML                                                     | text-frame-public-surface.test.ts |
| TextFrame.add_paragraph | Synchronous appended empty Paragraph, owned by the same frame; previous membership snapshots remain unchanged                                      | text-frame-public-surface.test.ts |
| TextFrame.clear         | Void; clears first paragraph content while retaining its paragraph properties and handle, removes later paragraphs and invalidates their handles   | text-frame-public-surface.test.ts |
| TextFrame.text setter   | Existing destructive formatting primitive replaces paragraph content and formatting; old paragraph and descendant handles fail with invalid-handle | text-frame-public-surface.test.ts |
| Paragraph.parent        | Actual owning TextFrame identity, not a detached copy                                                                                              | text-frame-public-surface.test.ts |
| XML child views         | Explicit subtree extraction retains namespaces and original admission ceilings; foreign XML nodes rejected                                         | xml-subtree.test.ts               |

Paragraph and Shape receipts describe their independently implemented members.
All callbacks use the existing XML splice/merge primitives, so outer owner
publication preserves limits and failures cannot publish partial inner edits.
Snapshot iteration uses native JS readonly arrays. Raw-XML constructors remain
existing low-level APIs; this receipt does not claim Presentation factory,
slides/layouts/masters or complete package ownership has been implemented.

## Destructive versus preserving edits

Frame clear preserves the first paragraph's paragraph properties. Whole frame
text assignment discards paragraph/run formatting. Neither calls literal
replacement. Existing text-replacement.test.ts independently covers cross-run
replacement preserving style, hyperlink and unaffected package members.
Read-only command inspection continues to call noncreating record readers;
Shape.text and Shape.text_frame retain documented creating behavior.

## Security and remaining gaps

No implicit host I/O, clock, identity, fonts or network capability was added.
Subtree limits come from the admitted owner, not ambient defaults. Invalidated
handles are typed InvalidHandleError instances with code invalid-handle.
Existing equation-preservation guards remain in destructive operations.

The full inherited part/element graph and root factory are not completed by this
change. New model methods do not yet all have corresponding closed typed batch
schemas; existing command formatting/replacement routes continue to use shared
domain primitives. Missing operations remain gaps, not private exclusions or
unsupported APIs counted as parity. The 2,407-source-record inventory is not a
passing-test count, and this receipt does not change its historical baseline.

## Maintained validation

The package unit route passed 4,499 tests across 194 files. The final additional
bounded-XML root export test passed with the other two public export assertions.
Package lint and the selected maintained build closure passed. A compiled-export
workflow created a bounded text frame, edited live paragraph/run/font objects,
and checked InvalidHandleError after clear. This is not a packed consumer or
complete Presentation graph conformance claim.
