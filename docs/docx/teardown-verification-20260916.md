# DOCX teardown reconciliation — 2026-09-16

Audit complete; full product acceptance remains pending. The specification stays
**Proposed**, with **Implemented Through: Not applicable**. Download, parsing,
discovery, source-suite passes and native subset schema checks do not establish
passing product QA or full OOXML conformance.

The [complete register](teardown-verification-20260916.json) records 107 task
states and local candidate commit/path inventories, every F01–F50 family,
all 2,259 source-case identities and their exact current overlay pointers,
register differences, checks, cleanup and remaining obligations. The
[owned audit plan](../plans/docx-teardown-verification-20260916.md) governs this
bounded review. No inherited working changes are staged or reverted.

## Task states and atomic delivery

All 107 working task declarations say done. This conflicts with explicit current
whole-API and integration acceptance blockers. The audit register records those
working declarations alongside committed states and **pending acceptance/atomic
ownership review**; it does not endorse or commit the inherited declarations.
62 distinct latest candidate owning-plan commits have local path/subject evidence.
Historical done-transition commits are retained separately. Conventional subjects
and a plan path alone do not prove every task's atomic owned implementation,
exact acceptance or original per-hunk ownership. Full task delivery is not certified.
Where an owning plan has no commit, that missing delivery is explicitly recorded.
No completed-task commit is invented and no empty commit is created.

The retained integration plans report focused verified runner profile isolation
and export-test corrections, but a required broad gate failed. Fresh focused tests
pass; this does not satisfy their whole integration acceptance requirements.
Those paths remain uncommitted and reviewable. OMML drafts, OPC follow-up receipts,
other plans, inherited pipeline edits and output directories remain outside this
audit's staging ownership. This audit delivers only its report/register/plan.

## Maintained checks actually executed

| Command                                                                                                       | Result                                          | Qualification                                       |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------- |
| `npm test --workspace=docx`                                                                                   | 225 files, 4,967 passed, zero skipped; 170.63 s | Maintained DOCX unit route                          |
| `npm run lint --workspace=docx`                                                                               | exit 0, one warning                             | ESLint plus source/test TypeScript                  |
| `npx vitest run --config vitest.root.config.ts scripts/build-workspaces.test.ts scripts/docx-exports.test.ts` | 2 files, 194 passed                             | Focused root checks, not full repository unit gate  |
| `npx tsc -p packages/docx/tests/tsconfig.public-consumer.json --noEmit`                                       | exit 0                                          | Existing bounded strict public declaration consumer |

`npm run build:workspaces -- --workspace=docx` also passed the maintained five-build
selected closure, including native postbuild stages. Raw invocation-owned logs
and SHA-256 bindings are in the register.
No build overlapped active units. Full root `npm test`, full virtual-bash tests,
repository lint, schema witnesses, real browser/worker, native rendering and PPTX
counterpart QA were not freshly run in this audit.

Retained integration evidence separately records normal root build/lint and
packed Node/runtime/type/browser-resolution consumers. Its root and virtual-bash
unit gates failed one PPTX extraction assertion: 38,315 passed, one failed,
823 skipped. The original assertion expects affected=2, actual affected=0; later
publication assertions were not reached. Root posttest lint-stress did not run.
No failed or unrun check is renamed passing. The previously contaminated and
interrupted runs remain separate. Retired release/launcher routes are not gates.

## Complete case accounting and original reductions

Fresh exact identity joins account for **1,609 unit variants + 650 expanded BDD
identities = 2,259 unique rows**, zero missing, duplicates or orphans, zero blanket
exclusions. Every row retains its original owner, crosswalk/semantic obligations,
historical accounting pointer and current exact overlay links. All four reviewed
overlays join without missing identities. They cover **1,239 distinct rows**:
369 OPC/XML/image rows plus 870 table/all-BDD rows. The workflow overlay's 650
and style workflow overlay's 116 overlap the BDD set and are counted once.
The other **1,020 rows** retain historical accounting and unclosed exact obligations;
absence from these overlays is not an exclusion or a claim they have no supplement.

The historical receipt distinguishes 31 dedicated observable adaptations,
1,053 bounded rows with exact/public workflow gaps, 698 supplements lacking named
execution links, and 477 without recorded adaptation. Those historical counts are
not current complete parity counts. Current overlay statuses include explicit
language/security mappings and retain their qualification limits. Named passing
links and fresh passing files do not automatically close every bound variant.

Four small original structure regressions remain in
`packages/docx/src/corpus-structure-regression.test.ts`; nine original image
regressions remain in the campaign's linked files. Thirteen paired small public
model/SDK/CLI workflows and five raster cases remain in
`packages/docx/src/guide-whole-api-workflows.test.ts`. Original memfs guide,
terminal-cell, removal rollback and diagnostic regressions are included in the
fresh maintained unit pass. This audit writes no new product test or product fix;
characterization passes are not fabricated red/fix cycles. Required notices apply
also to substantial derived test material.

## Feature, command and whole-public-API registers

All **50 feature IDs**, **920 inventoried public IDs**, and **1,337 public map
rows** have documentary accounting, with no missing feature/public-ID command
join. The denominator includes inherited/returned/public underscore types,
helpers, enum metadata/aliases, collections and APIs without source tests.
Documentary operations number **1,508**; actual built schemas and discovery number
**1,517**. The nine undocumented operation rows remain explicit gaps:
`styles.defaults.get/set`, `styles.latent.add/get/list/remove/set`, and
`styles.latent.defaults.get/set`. Register acceptance remains pending.

All 33 formerly missing exports are present in current retained evidence;
fresh built import confirms Document is a function. The current whole-API register
remains `partial-acceptance-blocked`: zero complete behavior rows accepted.
Thirteen finite paired workflows do not qualify all guide headings or all public
rows. NumberingPart.new rejects unsupported editing; required save ByteSink/VfsPath
forms, nullable paragraph alignment transport, Paragraph.element getter discovery,
and capability-object/fonts/template/vfs context reconciliation remain gaps.
No public SDK capability is silently omitted or accepted without CLI parity.

Paired Office evidence and the fresh DOCX Q01–Q49 campaigns remain bounded.
No PPTX counterpart was run in this audit; cancellation/transport injection,
publication failures/collisions, advanced templates and every-command SDK matching
remain pending. The earlier focused 48-pass/four-skip receipt is historical;
skips are not passes. Later DOCX observations supplement specific cases only.

## Specification-family outcomes

Levels below describe bounded advertised support, not completed full families.
**No whole proposed F01–F50 family is newly certified complete.** Exact subsets,
limitations and original scenario files are retained per family in the JSON.
Several built capability descriptions retain utility-era model-pending prose even
where newer bounded owners exist; this visible documentary drift stays pending.

| Family | Name                          | Bounded advertised level | Full proposed acceptance |
| ------ | ----------------------------- | ------------------------ | ------------------------ |
| F01    | ZIP/OPC                       | edit                     | pending                  |
| F02    | Strict and Transitional       | edit                     | pending                  |
| F03    | Macro-free templates          | edit                     | pending                  |
| F04    | XML fidelity                  | preserve                 | pending                  |
| F05    | Markup compatibility          | read                     | pending                  |
| F06    | Package inspection            | read                     | pending                  |
| F07    | XML access                    | edit                     | pending                  |
| F08    | Text extraction               | read                     | pending                  |
| F09    | Unicode and language          | read                     | pending                  |
| F10    | Literal replacement           | edit                     | pending                  |
| F11    | New documents                 | edit                     | pending                  |
| F12    | Run formatting                | edit                     | pending                  |
| F13    | Paragraph formatting          | edit                     | pending                  |
| F14    | Styles and themes             | edit                     | pending                  |
| F15    | Headings                      | edit                     | pending                  |
| F16    | Sections and pages            | edit                     | pending                  |
| F17    | Headers and footers           | edit                     | pending                  |
| F18    | Lists                         | edit                     | pending                  |
| F19    | Tables                        | edit                     | pending                  |
| F20    | Merged tables                 | edit                     | pending                  |
| F21    | Links and bookmarks           | edit                     | pending                  |
| F22    | Fields and references         | edit                     | pending                  |
| F23    | TOC and captions              | edit                     | pending                  |
| F24    | Footnotes and endnotes        | edit                     | pending                  |
| F25    | Comments                      | edit                     | pending                  |
| F26    | Tracked changes               | edit                     | pending                  |
| F27    | Complex review structures     | read                     | pending                  |
| F28    | Content controls              | edit                     | pending                  |
| F29    | Repeating/data-bound controls | edit                     | pending                  |
| F30    | Document properties           | edit                     | pending                  |
| F31    | Image inventory               | read                     | pending                  |
| F32    | Raster insertion/replacement  | edit                     | pending                  |
| F33    | Floating image layout         | edit                     | pending                  |
| F34    | Other media formats           | read                     | pending                  |
| F35    | SVG and alternate graphics    | edit                     | pending                  |
| F36    | Shapes and text boxes         | edit                     | pending                  |
| F37    | Charts                        | read                     | pending                  |
| F38    | SmartArt and diagrams         | read                     | pending                  |
| F39    | Equations                     | edit                     | pending                  |
| F40    | Embedded OLE/packages         | preserve                 | pending                  |
| F41    | Custom XML and glossary       | preserve                 | pending                  |
| F42    | Settings/fonts/protection     | read                     | pending                  |
| F43    | Signatures                    | edit                     | pending                  |
| F44    | Removal                       | edit                     | pending                  |
| F45    | Dummy text                    | edit                     | pending                  |
| F46    | Sanitization                  | edit                     | pending                  |
| F47    | Batch and templates           | edit                     | pending                  |
| F48    | Comparison                    | read                     | pending                  |
| F49    | Validation                    | read                     | pending                  |
| F50    | Extract/pack                  | edit                     | pending                  |

## Corpus QA, visual evidence and disposable cleanup

The retained structural campaign authenticated 23 real inputs and made 26 profile
runs: inspection/text 12 pass, 14 reject; round-trip 13 pass, 13 unrun; targeted
edit 11 pass, two reject, 13 unrun; admission 13 pass, 13 reject. Repeated profiles
are not new inputs. Two distinct dense/large inputs completed separately admitted
round-trip/edit profiles. Downloaded or parsed inputs, refusals and unrun edits
are not passing mutation QA. Missing profile regimes remain explicit.

The image campaign authenticated four inputs/280 stored media, observed 276
logical images and extracted 331 resources. Two original baselines block edits
under semantic validation. Derivative and unsupported-carrier observations are
not original-input editing passes. No new corpus campaign ran here.

Historical document visual evidence reviewed 88 pages across four baseline/edit
pairs with eight headless exports; the image campaign reviewed 29 representative
pages, not all pages. Desktop Word repair-free opening and font-complete RTL/CJK
remain unverified; subset grammar/MCE/extension limitations prevent full OOXML
claims. Freshly reopened Q33-after terminal screenshot has legible flag/help
recovery. Q12-human has a legible effect count and a visibly missing wave-emoji
glyph; UTF-8/reopened-value evidence does not establish font fidelity. No new
terminal capture or document rendering is claimed by this audit.

Fresh filesystem checks confirm all **23 campaign source paths absent**, and all
**36 retained unlisted cache hashes unchanged**. Historical cleanup deleted 19
sources (99,581,993 bytes); four were already absent. Audit deletions: zero.
Unowned `output/docx-*`, retained research, authored examples and visual follow-up
temporary artifacts are preserved. No guessed recursive fixture cleanup occurs.

## Identity isolation, legal notices and README

Fresh literal searches over existing DOCX product source/comments/tests/fixtures,
shared office-package source, DOCX adapter tests/source, root source and the
DOCX export test have zero named reference-identity matches. Actual built
help/schema/capabilities/version output likewise has zero matches. Terms and exact
roots are in the register. An initial discovery probe omitted its required closed
invocation argument and failed setup; corrected explicit invocations supplied all
required fields. Setup failures are not QA passes or product defects.

Standalone `packages/docx/THIRD_PARTY_NOTICES.txt` is preserved, and root packed
files include it. This scoped identity/notice check does not certify all authorship
or legal compliance. There is no implicit exemption for substantial copied or
derived test material; research provenance remains outside product paths.

**README permission remains pending.** No README is edited. The complete usage
draft remains `docs/docx/package-readme-draft.md`; the missing required package
README obligation is not waived or reported passing.

## Local delivery versus remote delivery and publication

Historical local hashes/path inventories remain in the 107-row register; recent
bounded delivery includes `05229ab6c`, `294f0fb86`, `aa214c560`, `e540206fe`,
`63c1b36cf`, `976cd35e4`, `468efe7bc`, `f140f50cd`, and `700dcd463`.
The new atomic audit commit is reported after creation, without self-referential
invented hashes. No unrelated/ignored files, blanket staging, co-author, empty
commit or hook bypass is used.

**Remote-main delivery: not attempted or verified. Release publication: not
attempted or published. No push or publication.**
