# DOCX grammar refinement and acceptance review

Task: refine the format-specific grammar only, 2026-09-14, on main.
No implementation, README changes, push, release or later task execution.

## Ownership and inputs

Owned files are docs/specs/docx.md, docs/docx/command-coverage.json, this plan,
and docs/docx/grammar-refinement-verification.json. Root AGENTS.md applies;
there are no scoped instructions under docs. Preserve the preexisting pipeline
plan edits and archive move without staging them. The spec remains Proposed,
Implemented Through: Not applicable. Inspected HEAD is
`a7d25f42fc7b14ea8b24370117acd19bed43faf5`; it is not a verified engine version.

Read office-cli.md and office-sdk.md as authority, the existing DOCX spec,
API audit/inventory/reconciliation, public API map, command register, prior
contract evidence and standards namespace register. The evidence inventory's
920 records and 262 nested enum values remain research denominators. All 1,337
API-map rows and 1,506 operation IDs must survive. No source binaries or branding
are copied; no new external acquisition or source baseline rerun is needed.

## Before-edit evidence

Inline documentary assertions ran before the first change and returned exit 1:
all six checks failed. They required an authoritative lexical/direct grammar,
closed OriginalDocumentContentV1, a specified docx-loc-v1 fingerprint, typed
inspect resultData, a concrete validate profile default and positional pack
input arity. The starting spec/register lacked those declarations. These are
reproduced documentation gaps, not claims of failing product tests. This task
adds no code; implementation owners must still write failing original tests
before implementation. QA remains this Markdown procedure, not a shipped script.

## Procedure for this task

1. Expand the existing section 6, preserving shared names/options/statuses. Keep
   standards assertions tied to their existing pinned evidence, and identify
   format grammar, namespace profile, defaults and deterministic output policy
   as product choices. Do not create contract.md or another authoritative spec.
2. Parse and refine the existing command JSON, retaining identities and historical
   input hashes. Resolve source alternatives into one semantic SDK input, exact
   defaults and typed resultData. Include public inherited members, collections,
   enum helpers, bounded views and no-source-test members. Apply the prior
   reconciliation's 18 supplemental feature associations instead of hiding gaps.
3. Check every operation's F-ID, test ID and schema/help request; every API row's
   operations and model-contract pointers; all 50 feature rows; all 23 existing
   documentation resolutions; all 16 language/security mappings. Compare input
   hashes to the original unchanged files; hashes are provenance, not coverage.
4. Read the full grammar against the shared contract. Check the cases below
   as documentary traces now; each is a later executable acceptance obligation.
   Every direct path has command.<dotted-path> evidence and every model operation
   retains its independent API acceptance IDs and associated feature cases.
5. Run the write-spec checker, repository-installed Prettier on exactly the four
   owned files, JSON/reference/link checks and git diff --check. Review every
   checker warning. Product build/unit/workflow/CLI screenshot gates do not
   apply to this prose/register-only change; do not claim they ran.
6. Review and stage only the four owned files. Commit this one atomic grammar
   improvement with a Conventional Commit on main. Verify commit contents and
   record its hash at delivery. Keep all later pipeline tasks pending; no push.

## Independent original acceptance obligations

These scenarios are original requirements, not executed product tests. The
register supplies per-operation/model/feature variants in addition to this matrix.
Use memfs and original bytes; expected XML/OPC values must be independently read
or asserted, never produced by the editor under test as its own oracle.

| ID  | Scenario and independent expected evidence                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G01 | Invoke every registered path with minimal declared arguments; inspect exact help/schema fields and actual support. Unknown singular names, top-level replacement and obsolete flags return usage with no reads.                      |
| G02 | A filename with spaces/Unicode or beginning with minus survives quoting/`--`; omitted input with piped bytes fails, explicit minus reads once. Count source calls.                                                                   |
| G03 | Document stdin plus ops-file stdin fails before either read. Test both/neither ops sources and duplicate scalar flags, including equivalent aliases.                                                                                 |
| G04 | Create empty original content with and without explicit time; independently inspect kind, geometry, empty paragraph and absence/presence of dated properties. Template append retains unrelated bytes.                               |
| G05 | Test output/in-place/force/dry-run/stdout/JSON cross-product, input path aliases and stale destination identities with injected VFS capabilities; old hashes must remain unchanged on failure.                                       |
| G06 | Inspect an input with linked sections and no local header; report owners/counts without creating parts. Dedicated header/comment lists do not disappear behind body scope.                                                           |
| G07 | Original text split across differently formatted runs includes astral/combining text; assert first/all/occurrence, no recursive matching, view/barrier behavior and retained prefix/suffix formatting.                               |
| G08 | Make a token, change one source byte or staged generation, attempt mutation; stale-selection must precede publication. Test malformed token, path/range bounds, foreign owner and token/simple-selector conflicts.                   |
| G09 | XML default/raw returns original bytes; pretty changes only display; JSON contains base64 or pretty UTF-8 with original hashes. raw+JSON/pretty fails; replacement cannot introduce invalid relationships or DTD.                    |
| G10 | Whole paragraph/run setters and preserving replacement have independently different formatting effects; null/empty/absent are tested separately. Explicit false and zero do not inherit.                                             |
| G11 | Section orientation does not swap dimensions. Linked-header text requires explicit local materialization or shared intent; compare every owner and untouched part.                                                                   |
| G12 | A table with omitted slots and merged spans preserves logical anchors; test rectangular merge, partial overlap refusal, exact span split and terminal empty paragraphs.                                                              |
| G13 | Restart one list while another shares its definition; the other list's IDs/start remain unchanged. Exercise all five advanced format schemas and unknown/empty/null fields.                                                          |
| G14 | Bookmark rename/remove follows explicit reference policy. Fields retain instructions and never execute targets. Fragment-only links remain inert and retain separate URL fields.                                                     |
| G15 | Comments require admitted ranges/time; nullable lookup remains null, rich blocks stay ordered. Review list defaults all; complex revisions fail affected edits without dropping opaque metadata.                                     |
| G16 | Every control kind accepts its sole typed value. Locked/unknown/duplicate/missing bindings fail; empty repeat array preserves prototype/container; template data is never evaluated as code.                                         |
| G17 | Core/custom property type collisions, empty text, positive revision, 255-scalar bound and UTC-second serialization have independent expected values. Read-only cached extended keys refuse writes.                                   |
| G18 | Characterize original tiny raster bytes, including unequal/missing-axis DPI; assert no/one/two dimensions, explicit fit, shared resource versus occurrence changes, crop/rotation bounds and byte hashes.                            |
| G19 | SVG/fallback, chart, diagram, text-box, OMML and embedded-object inputs preserve unrelated parts; unsupported affected edits reject and no external acquisition/activation occurs.                                                   |
| G20 | Exact sanitization categories/reference policy and signature stripping report all effects. Seeded dummy words repeat byte-for-byte with no clock/random dependency.                                                                  |
| G21 | Batch operation two fails after a successful staged edit; old input/output remain byte-identical, affected is zero, error index is two's zero-based position. Closed handle/type/owner/forward-reference rules reject invalid input. |
| G22 | Read/value-only batch needs no destination; creating getter needs one; model save cannot publish mid-batch or redirect to a second output. Every inherited member/enum/helper gets its own declared API evidence.                    |
| G23 | Diff equal/different/error/cancelled yields 0/1/2/130. Compare ZIP-metadata-only, XML-prefix-only, text and binary differences against independent expectations in each mode.                                                        |
| G24 | Extract/repack original payloads through manifest hashes; reject unsafe/colliding paths, undeclared content and mismatched hash. Simulated partial output lists exactly the published files without deleting old files.              |
| G25 | At/over each named budget, invalid limits, unvalidated extension and MCE branch requirements are distinguishable; capability/schema reports match actual support and host permissions.                                               |

Each future test must first fail for the absent/incorrect product behavior, then
pass after its owning implementation. Adapt behavioral cases into original words
and assets; retain required legal notices separately for substantial derived
material. Downloaded files remain disposable offline QA inputs only. Runtime
screenshots, renderer qualification, packed consumers, source-case adaptation
and corpus cleanup remain pending and are not substitutes for these tests.

## Results

The verification receipt records documentary before/after results, exact counts,
unchanged input hashes, applicable maintained checks and delivery limitations.
No product tests, source-case adaptations or implementation passes are claimed.
