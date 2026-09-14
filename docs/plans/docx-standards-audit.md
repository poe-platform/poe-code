# DOCX standards audit task and original acceptance plan

Task: `pin-ooxml-standards` only, from `docx-typescript-safe-bash.md`.

Status: Standards documentation complete and checked. Product implementation and all later tasks pending.

## Scope and ownership

Owned paths are `docs/docx/standards-coverage.md`, `docs/docx/standards-sources.json`,
`docs/docx/standards-audit-evidence.md`, `docs/specs/docx.md` and this plan.
No product code, tests, README, fixtures, dependencies or workflow files are changed.
The already modified main pipeline and unrelated moved plan are not owned; preserve
those bytes and their index state. This standalone task receipt records completion
without staging another author's pipeline edits. Do not push or release.

The task's atomic improvement is the standards register, reproducible source manifest,
corresponding specification pins/drift corrections and this validation plan/receipt.
Commit these five explicit paths together after checks. Keep the format status Proposed
and Implemented Through Not applicable. A local documentation commit is not product,
remote-main, release or corpus acceptance.

## Documentation validation procedure

1. Confirm the missing register, unpinned extension revision and ambiguous image-DPI
   sentence against current files before editing. Read the root instructions, all
   three applicable specs, API audit and full candidate inventory. Do not infer API
   completeness from its 331 records or from external tests.
2. Download the four specified fifth-edition archives from the ECMA publisher. Read
   the actual relevant clauses and XSD declarations. Download and separately pin
   MS-DOCX/MS-ODRAWXML; verify release markers and schema fragments. Record SHA-256,
   exact sizes and archive members in `docs/docx`. Keep downloads outside the repo.
3. Crosscheck F01–F50 IDs/names against the spec; require all read/edit/preserve/reject
   cells and an original test obligation. Resolve every cited ECMA named type against
   the declared namespace/schema. Verify Microsoft types in their actual §5 schemas.
   Review MCE processing separately from preservation and cross-part semantics
   separately from XSD validity. Check all relative links and test anchors.
4. Run the write-spec skill's maintained `scripts/check_spec.py` for `docs/specs/docx.md`.
   Run the repository's maintained Prettier engine on exactly the five owned Markdown/
   JSON files (`npx prettier --check <owned paths>`), and `git diff --check` on them.
   No package/unit/type/workflow tests apply to documentation-only changes. No CLI/UI
   behavior changes, so screenshots are not relevant to this task.
5. Review the exact owned diff. Stage the five files explicitly, inspect the staged
   path list and diff, commit on main with Conventional Commits and enabled hooks,
   then verify the local commit/path set and preservation of unrelated edits. Keep
   subsequent pipeline tasks pending; do not run their implementations or tests.

## Future test execution rules

The cases below are **original acceptance designs, not written or passing tests**.
This task contains no product code, so no fabricated failing product test or code fix
is needed. Before later implementation, write the assigned smallest meaningful test,
observe failure through the public behavior under test, implement, then run the
narrowest maintained package checks. Use original in-memory XML/ZIP/image data with
memfs and injected capabilities; no disk fixtures, external model calls or copied
binary inputs. SDK/CLI integration should exercise the same engine.

Every mutation case also needs an unrelated payload/relationship preservation assertion
and a failure-before-publication assertion where relevant. Pair Strict/Transitional
cases only where the feature exists in both profiles. Assert semantic postconditions,
not only serialized strings or implementation-private wrapper identity. No drawing
artwork is required here: future authored media tests can use non-artistic pixel/header
samples; any artistic assets remain subject to the user's image-reference rule.

## Original F01–F50 cases

### T01

F01. Pending. Round-trip stored/deflated entries and bounded ZIP64; corrupt CRC, duplicate normalized name, traversal and expansion over limit each fail before publication.

### T02

F02. Pending. Author equivalent Strict and Transitional packages, edit one run, assert original namespace and relationship dialect; reject an incoherent mixed package.

### T03

F03. Pending. Create document and template with distinct main content types; reject a macro-enabled main type even with a .docx filename.

### T04

F04. Pending. Edit text beside an original unknown namespace, PI, comment and xml:space text; assert untouched nodes and namespace bindings survive; reject DTD input.

### T05

F05. Pending. Vary Requires and inherited prefix bindings, nested choices, missing fallback, wildcard ProcessContent and MustUnderstand; assert semantic view and retained source branches separately.

### T06

F06. Pending. Inspect a shared header, opaque object and signature origin; assert deterministic inventory, zero affected count and identical package state.

### T07

F07. Pending. Read raw and pretty views without mutation; replace a valid XML part, then attempt malformed and dangling-reference replacements and assert rollback.

### T08

F08. Pending. Extract original text containing tabs, line breaks, table cells and cached fields; assert body default, explicit note/header scopes and shared-story deduplication.

### T09

F09. Pending. Use original Arabic, CJK, supplementary characters and combining marks across runs; assert exact logical code points and no normalization after unrelated edits.

### T10

F10. Pending. Split a literal over bold/plain runs; compare first/all/occurrence results, reject stale token and forbidden boundary, and preserve adjacent formatting.

### T11

F11. Pending. Create an original minimal package, validate main relationship/content type, then populate a supplied template without touching an opaque part.

### T12

F12. Pending. Toggle true/false/null bold, hidden and RTL; round-trip size/theme color/underline and verify null removes direct formatting rather than writing false.

### T13

F13. Pending. Add/replace/delete tab stops, test negative first-line indent, spacing and keep flags; assert inherited absence and unaffected paragraph properties.

### T14

F14. Pending. Create a character/paragraph/table style chain and latent exceptions; reject cycles/collisions, retain theme bytes and test inherited public formatting members.

### T15

F15. Pending. Add levels 0, 1 and 9 with an existing conflicting style name; verify title/outline behavior and reject -1/10.

### T16

F16. Pending. Edit landscape margins/columns in one section; verify preceding/final sectPr placement and inherited first/even/default header references.

### T17

F17. Pending. Two sections share a header; edit one locally and then explicitly shared, checking clone/rebind counts, link-to-previous and required empty paragraphs.

### T18

F18. Pending. Create nested bullet/decimal lists, restart one instance and retain another; assert scoped IDs and unchanged picture-bullet bytes/relationships.

### T19

F19. Pending. Author nested table with omitted leading/trailing cells; change widths/header repetition and verify traversal order and required final cell paragraph.

### T20

F20. Pending. Merge a 2-by-2 region and split under explicit rules; verify repeated logical references, invalid rectangles, omitted cells and stable bounds errors.

### T21

F21. Pending. Rename a bookmark referenced by REF and hyperlink under each declared reference policy; reject unsafe schemes and preserve an unrelated external edge without fetching it.

### T22

F22. Pending. Create nested fields and update only a displayed result; preserve instruction text, balance begin/separate/end and reject an unsupported executable field request.

### T23

F23. Pending. Insert original headings, TOC and figure caption; verify field/reference structures and explicitly cached page labels without claiming layout computation.

### T24

F24. Pending. Add two notes, remove one, and preserve continuation/separator entries; reject duplicate IDs and assert body/story isolation.

### T25

F25. Pending. Create a rich comment with paragraph/table, explicit UTC time and author; assert comment_id/timestamp, missing get returns null, and unrelated modern metadata survives.

### T26

F26. Pending. Create insert/delete and a format change; compare three read views, accept/reject selected revisions and assert atomic failure on mixed supported/unsupported selection.

### T27

F27. Pending. Place move markers and a section revision around original content; unrelated edit preserves them, intersecting edit fails with unchanged input/output.

### T28

F28. Pending. Fill each declared control kind, retain placeholder/lock metadata, reject invalid choice/date/locked input; keep legacy ffData inert on unrelated edit.

### T29

F29. Pending. Expand a two-record original row binding with explicit supported path; assert fresh IDs and synchronized XML; reject unsupported path/checksum and over-limit expansion atomically.

### T30

F30. Pending. Set title, boolean, integer and UTC custom date; remove one property, preserve an opaque variant and reject explicit type conflict.

### T31

F31. Pending. Inventory shared inline/floating occurrences with crop/rotation; compare occurrence counts to hash-grouped resources and verify owned bytes.

### T32

F32. Pending. Use original minimal in-memory headers for every admitted format; test embedded DPI, 72-DPI missing-metadata fallback, one/both dimensions, shared/local replacement and invalid dimensions.

### T33

F33. Pending. Edit anchor offset/wrap/crop/flip with valid EMUs, preserve unknown relative-size data, reject invalid ranges and verify decorative is distinct from alt text.

### T34

F34. Pending. Extract original small authored opaque media payloads, compare hashes and retain relationships after a text edit; keep preservation separate from raster admission.

### T35

F35. Pending. Insert a simple original inert SVG plus supplied original fallback; reject script/external URL/missing fallback and verify both media hashes and relationship scope.

### T36

F36. Pending. Edit original textbox text in Strict, extension DrawingML and VML shapes; retain paths/group transforms; reject unsupported linked-story mutation.

### T37

F37. Pending. Inventory a chart with cache and inert embedded workbook; change body text and assert exact chart/workbook hashes and no external fetch.

### T38

F38. Pending. Author a minimal diagram part graph with layout/style/color resources; unrelated body edit retains payloads and every relationship.

### T39

F39. Pending. Insert original fraction and matrix OMML, validate schemas/context, replace one formula and reject invalid child/depth without altering another equation.

### T40

F40. Pending. Inventory/extract an original inert opaque object with preview; assert bytes and no activation during unrelated edit, reject extraction beyond limits.

### T41

F41. Pending. Retain glossary numbering/styles and original custom XML/altChunk parts on a body edit; show them in inventory without importing their content.

### T42

F42. Pending. Inspect protected document/font parts without side effects; reject protected mutation, retain unknown compatSetting and exercise odd/even-header setting explicitly.

### T43

F43. Pending. Detect multiple signatures, reject text edit, explicitly strip graph retaining other shared parts, then edit; assert no residual signature edges.

### T44

F44. Pending. Remove a selected run/table/comment under reference policy; retain a shared image and required cell paragraph; reject removal that would orphan a range.

### T45

F45. Pending. Same seed and input yield same output; different explicit scope leaves headers/hidden text unchanged and reports no privacy guarantee.

### T46

F46. Pending. Remove explicitly chosen comments/properties/links and compare exact report against survivors; reject unsupported tracked-change sanitization atomically.

### T47

F47. Pending. Run replace plus table edit as one typed batch, inject final validation failure and assert no publication; verify unknown fields and operation limit failures.

### T48

F48. Pending. Change only prefix/attribute order versus actual text; verify payload and semantic results differ appropriately, exit 0/1/2/130 and SDK equality as data.

### T49

F49. Pending. Supply schema-valid but dangling IDs, invalid schema content, unknown required namespaces and unsupported opaque parts; report separate schema/semantic/preserve coverage.

### T50

F50. Pending. Extract/repack in memfs, compare payload hashes; reject traversal, alias/collision, inconsistent inventory and incapable transaction unless explicit partial-output policy permits it.

### J01

Pending. Exercise public JS mappings independently of external test coverage. Verify
always-Promise factory/save/image admission; synchronous model operations; true/false/null;
sequence `.length`, iteration, negative `.at()` and slicing; keyed lookup versus ordinal
lookup; tab-stop `.delete(index)` shifting; live merged-cell aliases and invalidated owner
handles. Test units at fractional/negative half boundaries under the shared rounding
rule, invalid/nonfinite values, RGB bounds, neutral enum values/aliases, TypeError/
RangeError/LookupError distinctions, owned Uint8Array, explicit UTC seconds and absent
comment lookup. Assert no ambient path/time/font/network authority. Keep inherited and
underscore-prefixed documented members in the future full public API denominator.

## Completion record

Completed `pin-ooxml-standards`: six primary source pins, F01–F50 coverage, explicit
unsupported boundaries, original future test designs and confirmed DPI/comment-name
drift corrections. Spec checker passed with zero warnings; maintained scoped Prettier
and whitespace checks passed. Schema/type/hash/census/link checks passed.

Full API reconciliation, complete API mapping,
product tests/code, corpus QA, screenshots, package checks, push and release are unrun
and remain assigned to later tasks. The 50 feature test designs plus J01 are not passes.
