# Legacy comments: evidence and accounting

This bounded receipt concerns F50 legacy annotations and their F07/F08 slide
lifecycle interactions. It does not claim complete presentation or public-model
coverage. The [case ledger](comments-case-map.json) records the pinned inventory
scope and distinguishes source cases from new format regressions. The historical
blanket “adaptation not started” test audit is a baseline, not current package
status; this receipt describes only the comment work evidenced here.

## Source-case and public-API reconciliation

The inventories contain 2,700 expanded unit variants, 973 expanded BDD scenarios
and 2,407 public type/member/protocol/enum records. There are no direct legacy
annotation test scenarios or public comment collection/editor records in the
pinned baseline. The two comment-named unit variants test core metadata description,
not slide annotations. Five public keyword matches comprise two identities for
the metadata description property and three shape-enum records. Their exact IDs
and dispositions remain in the research ledger; none count as implemented F50.

The documented CoreProperties module path is stale: the returned implementation
is CorePropertiesPart. Both inventory identities are retained, with the documented
neutral `comments` property spelling; this is a metadata obligation, not a reason
to give legacy annotations a competing model property. `COMMENT` and `INK_COMMENT`
remain shape enum values (4 and 23). No enum behavior is inferred from comment
editing. The ledger also retains all 121 expanded unit/BDD rows in the complete
slide, slide-part and slide-collection source families as adjacent obligations.
They contain no legacy author-table CRUD assertions, so no fresh adaptation or
pass is claimed for those existing independently owned families.

The global inventory remains authoritative for inherited members, helpers,
collections, enum aliases, returned interfaces and members without source tests.
Names beginning with underscores are not a privacy rule. Operation records do
not establish live-object-model parity. No source implementation, wording or
binary fixture was copied for this receipt; existing standalone MIT notices
remain required and unchanged.

## Language and security mapping

Legacy comment identity is scoped to an owning slide/comment part, author ID and
author-local index; display names cannot establish identity. Fingerprinted tokens
bind selection to acquired input. Simple CLI slide ordinals are one-based;
structured locations state their coordinate system. Numeric author IDs/indices
must retain their integer identity without JS coercion or unsafe-number rounding.
Returned records describe values, not a live comment collection; no negative
indexing, arbitrary property execution or undocumented model alias is implied.

Authors and timestamps are caller-supplied. UTC serialization must use valid
explicit time, never the host clock/timezone. CLI geometry accepts explicit typed lengths; the byte SDK accepts finite safe
integer EMUs. Storage rounds to signed eighth-point coordinates, nearest with
halfway values away from zero, and reads return EMUs (which can include `.5`).
Creation alone defaults to origin. Supplied UTC strings permit fractional seconds;
authored timestamps serialize at whole-second precision by dropping the fraction.
These are operation values, not a claim that the proposed live model UTC `Date`
API is implemented. Omitted update fields preserve existing values;
null and invalid types are not silently treated as omissions. XML parsing and
package graph operations preserve unrelated annotation parts and modern threads.
Host paths, identity discovery, environment, native conversion and network access
are absent from product behavior; bytes and VFS publication are explicit
capabilities. SDK and command routes share the same domain editor and common
stable result/error/publication contracts.

## Disposable fixture evidence

All 14 manifest-listed cache paths existed at review. SHA-256 was independently
verified for IXPE-Presentation-Template.pptx and WWL-template-1slide.pptx.
Neither archive contains a comment/person-named member. Their absence makes these
valid creation/roundtrip QA candidates, but not evidence for preservation of
preexisting annotations. No downloads, cache modifications or binary publication
were performed by this census. Procedures and worker ownership are recorded in
[the plan](../plans/pptx-legacy-comments.md), not in a QA script.

## Executed bounded QA

SDK add/read/set/remove passed on both hash-verified templates entirely in memory.
Creation changed exactly `[Content_Types].xml`, presentation relationships, the
new author list, the new comment part and selected slide relationships. The
original slide XML and every other uncompressed member were unchanged. Updating
text changed only the selected comment XML; final removal read back no comments.
The initial CRUD pass checked package byte preservation, but did not independently
verify the comment content type. Subsequent cross-API review reproduced SDK-created
comments failing import: creation registered singular `comment+xml` instead of
`comments+xml`. An original regression now asserts the exact MIME registration
and SDK add/import/delete workflow. The corpus CRUD was rerun after the fix on
both templates with an independent parsed content-type assertion. These checks
do not establish renderer placement or modern-thread editing.

A second original regression makes add/set/remove on a comment part shared by
multiple slides reject safely, avoiding mutation of another owner through an
ordinary slide-local operation. Independent review also identified missing
duplicate `(authorId, index)` validation in the import helper. A new original
lifecycle regression now verifies rejection before import; imported parts are
scanned together so duplicate author-local identity cannot be emitted.

The maintained `npm run screenshot` runner captured real safe-bash `Shell` output
for `pptx comments add --help` and missing-timestamp rejection. The image was
opened and inspected: plural resource/options fit, text is readable, the error
names the missing required values and reports exit 2. The disposable image is
`.cache/pptx-comments-cli.png`. The root CLI does not expose this injected utility,
so the generic maintained runner is the applicable route. No screenshot test was
added. Final maintained package and CLI check results belong to the coordinator's
completion receipt; this research worker did not run the whole pipeline.

## Position evidence boundary

[Microsoft's comment guidance](https://learn.microsoft.com/en-us/office/open-xml/presentation/working-with-comments)
establishes slide comment parts, presentation author registration and positional
anchors. [Its position implementation note](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oe376/1c8a4e6a-16d6-4e94-b303-a12aeb02ced3)
corrects the coordinate-axis prose. Those pages do not establish the eighth-point
storage convention; the implementation's convention still needs independent
renderer or primary normative confirmation. The in-memory corpus check cannot
supply that confirmation, and this receipt makes no visual placement claim.

## Maintained verification receipt

Coordinator-reported maintained results, kept separate from this worker's QA:

- Whole `pptx` unit route: 161 files, 4,152 tests passed.
- A later test-only addition verifies unfiltered `comments get` counts comments
  across slides rather than slide owners. The focused command suite passed all
  13 tests afterward; no product code changed for that addition. It was not part
  of the preceding 4,152-test checkpoint.
- Full safe-bash `pptx` command suite: 156 tests passed.
- Final maintained selected workspace build passed after duplicate import
  hardening. `npm run lint --workspace=pptx` and scoped command/test ESLint passed.

The focused ledger now contains 30 expanded original cases: 10 domain, five
lifecycle, 13 command and two safe-bash cases. These are included in relevant
suite totals and must not be added to them as separate passes. The worker did
not run a whole pipeline, publish, push or create a commit.
