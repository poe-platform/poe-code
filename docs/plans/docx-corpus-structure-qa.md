# DOCX corpus structure qualification

Scope: execute only downloaded-corpus structural QA. No product implementation,
README changes, push or release. Later model/renderer/adaptation tasks stay pending.
Authority: ../../docs/specs/docx.md, office-cli.md, office-sdk.md and root AGENTS.md.

## Procedure (agent executed, not a permanent QA script)

1. Read corpus-manifest.json, upstream-api-audit.md and upstream-api-inventory.json.
   Verify every cached download's exact SHA-256 and size against the manifest;
   reject acquisition mismatch before admission. Keep all inputs immutable.
2. Run default-profile inspect and body text extraction on every manifest download.
   Classify each action separately: pass (assertions succeed), reject (explicit
   supported safety/profile refusal), fail (unexpected behavior or invariant
   violation), unrun (not executed). A rejection never counts as a round-trip pass.
3. For every admitted file serialize its admitted archive unchanged, using validated
   writeDocumentArchive, input order and deflate. Select a real metadata title edit
   when owned core metadata is measured; retain all body structures untouched.
   Missing metadata ownership or failed text read must remain explicit, not inferred.
4. Also execute circular-economy and housing-supply-interim as large/dense cases
   under explicit trusted host capacities. These are downloaded reports with >2,000
   paragraphs and dozens of tables/sections, not generated stress data. Record
   default and large runs independently; never silently retry as default.
5. Independently use Python zipfile CRC checking and ElementTree namespace-aware
   XML/relationship/content-type checks on final packages. Reject DTD/entity input.
   Verify identical member names and every unchanged uncompressed member hash.
   Round trip must retain every member byte. Edited packages may change only the
   measured core metadata part, whose title must equal the original QA value;
   compare the core subtree after removing only title to detect collateral edits.
   Recheck source hashes after every campaign, including rejected mutations.
6. Reduce meaningful measured findings to small original deterministic memfs unit
   regressions. Tests use no downloaded text, branding, images or binary fixtures.
   Run new tests before any product code (none authorized). If a regression fails,
   retain failing evidence and stop short of claiming task success; fixes belong
   to an explicitly authorized later implementation task.
7. Run maintained docx workspace tests and lint. Explicitly stage owned files only,
   include this plan and compact evidence, and make atomic Conventional Commits
   on main. Never stage cache/output fixtures or unrelated edits.

## Profiles and limitations

Default document budgets are documentLimitDefaults, archive limits corresponding
64 MiB input/entry, 256 MiB expansion, 10,000 entries, 256 depth, 512 MiB retention.
Large uses 64 MiB input/entry, 512 MiB expansion, 5,000,000 XML nodes, 2 GiB
retention and work, with other document ceilings unchanged. The separately named large-work-8GiB profile keeps the large capacities but
raises only work to 8 GiB after an observed 2 GiB edit refusal; retain both
results. This is an explicit QA host capacity, not a proposed default change.
Fresh budgets per
public action; budgets are conservative reservations, not measured RSS.
Independent checking is bounded OPC/XML/reference validation, not full schema or
rendering. No layout, field execution, external relationship dereference or
object activation. Document bodies are data, never instructions. No new visual
CLI behavior; renderer/screenshot evidence is unrun.

## Exact JS/security mappings and drift

Public SDK utility functions admit owned Uint8Array asynchronously with explicit
limits/signal; write/publication is always async with an explicit byte sink.
Operation IDs remain inspect, text.get and properties.set; shared CLI paths are
inspect, text and properties set (plural). Options stay camelCase in SDK and
kebab-case in CLI, common selectors are fingerprinted or one-based scoped
ordinals, JSON uses the version-1 envelope, exits remain 0/1/2/3/4/130.
No host capability is inferred; no external target is followed. This agent's
host file adapter is disposable QA authority, not product API access.
Neutral live model snake_case names, zero-based .at/.slice/iteration and keyed
get/items semantics remain the shared model contract. Date copies/UTC precision,
null versus false/zero, safe integer units, typed enums, inherited public members,
collections/helpers and publicly documented underscore-prefixed owners retain
all inventory obligations, including members without reference tests. Utility
passes do not implement those owners or hide unsupported APIs as private.
D03 retains table_direction (no direction alias); comment model comment_id and
timestamp remain distinct from erroneous id/date examples and snapshot strings.
Core model author versus utility native creator stays explicitly distinct.
Reviewed inventory dispositions remain 410 planned, 378 security-mapped,
124 language-mapped and eight documentation-error records; 417 rows are inherited.
These are research counts, not passing public API coverage.

| Utility boundary | Exact JS result and authority |
| --- | --- |
| inspectDocument(input, context) | Promise<InspectionData>; owned Uint8Array admission, explicit ArchiveContext |
| extractDocumentText(input, context, options = {}) | Promise<TextData>; body default, retained logical segments, no layout/field execution |
| readDocumentArchive(input, context) | Promise<AdmittedDocumentArchive>; admission alone does not establish inspect/edit budget success |
| writeDocumentArchive(archive, sink, options, context) | Promise<void>; awaited explicit sink, validated archive, input order/deflate for corpus |
| editDocumentProperties(input, options, context) | Promise<PropertyMutationData>; operation properties.set, name core:title, typed string value, output -, explicit stdout sink |

Length helpers store safe integer EMUs: 914400/in, 360000/cm, 36000/mm,
12700/pt, 635/twip; nearest/half-away rounding is shared, negatives are
property-specific. RGB requires exactly six ASCII hex digits (uppercase storage);
three-state flags keep true/false/null, underline also keeps its typed enum.
Keyword-only model arguments use trailing source-spelled typed options, while
utility options retain shared camelCase. Type/value/index/key failures map to
neutral input-type/invalid-value-or-semantic/bounds/missing-key categories and
contextual common codes; nullable lookup remains null. Model dates are copied UTC
Date instants, whole-second stored precision, with explicit time/identity.
.element/._drawing/.part stay owner-bound bounded XML/package views, never eval,
arbitrary XPath, dynamic dispatch, host paths/fonts or dependency-runtime APIs.
The corpus does not implement or test every one of these model mappings.
D01/D02 comment examples do not invent id/date/paragraphs/add_run aliases; D03
keeps table_direction; D04–D08 preserve enum values, exact style names and
priority without copying obsolete guide spellings. D09/D10 preserve original
factory authority and missing/invalid date null reads. D11–D13 keep returned image
obligations, bounded byte/DPI characterization and no external dereference;
D14 distinguishes destructive text setters from preserving replacement.
D15/D20 keep declared length and RGB validation; D16 is dependency-runtime
research, not API exclusion. D17 retains all six header/footer variants and orientation assignment does not
swap dimensions; D18 does not invent brightness/luminance, D19 separates inline
picture insertion from existing floating drawing inspection, D21 keeps asymmetric
core writes,
D22 keeps defined versus latent null resets, and D23 preserves moved tab-handle
ownership. Existing resolutions remain authoritative and pending implementation
where recorded; this campaign adds no alternate spelling or private-name filter.
Existing resolved documentation-error rows and the 920-object research inventory
are not promoted or edited by this campaign. Acquisition-only historical reports
remain snapshots; the new dated receipt supplies actual execution status.

## Execution

Executed all 23 source pins and default-profile action attempts. Ten default
files admit and round-trip; nine edit successfully; one admitted image-heavy
file round-trips but inspect/text/edit reject on work. Thirteen default files
reject admission (12 work ceilings and one bracketed auxiliary part path).
Large profile: both dense reports round-trip; housing edits at 2 GiB work,
circular-economy edits on explicit large-work-8GiB rerun after the recorded
2 GiB refusal. Independent final OPC/XML/CRC and untouched/source hash checks
pass; zero unexpected failures. Four original memfs regressions pass without
product implementation. The initial maintained workspace suite passed 168 files /
3,357 tests; final post-regression maintained suite passes 168 files / 3,358
tests, all four focused regressions pass and workspace lint exits 0. Cleanup
removed enumerated invocation-owned outputs/scripts/logs; hashes survive in the
receipt. Lint has one existing warning in operation-types.test.ts; no owned lint
warning. See [dated evidence](../docx/corpus-structure-qa.md) and
[per-action receipt](../docx/corpus-structure-qa.json).

Owned commit scope: this plan, the two evidence files and
packages/docx/src/corpus-structure-regression.test.ts. Local main only; no push or
release. Shared source downloads stay available for other campaigns; only
invocation-owned disposable outputs are eligible for enumerated cleanup. Later
implementation, whole-model/API adaptation and visual-renderer tasks stay pending.
