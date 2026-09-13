# Metadata properties and tags accounting

Status: bounded property cases linked and worker-verified; final maintained integration checks belong to root. No push or release is authorized.

## Scope and ownership

This bounded F51 change covers core/custom property values and presentation/slide tags. Domain logic belongs in `packages/pptx`; safe-bash command adaptation belongs in `packages/safe-bash/src/commands/pptx`. Root owns integration and validation. This document and the new `docs/pptx/properties-tags-*` research receipts belong to the metadata accounting worker. Shared inventories, existing dirty docs, README files and unrelated changes are excluded from this worker's edits. No pipeline, push or release is authorized.

## Research baseline and exact accounting

Read root AGENTS.md, `docs/specs/pptx.md`, `docs/specs/office-cli.md`, `docs/specs/office-sdk.md`, both upstream audit documents and inventories, and `docs/pptx/corpus-manifest.json`. No scoped AGENTS.md exists under docs. The pinned reference is python-pptx commit `278b47b1dedd5b46ee84c286e77cdfb0bf4594be`, read from `/tmp/pptx-upstream-review`. This task does not execute its runtime.

The dedicated core-property suite contains 35 collected unit variants: 11 string getters, 11 string setters, three date getters, three date setters, five revision reads, one revision setter and one default constructor. Three owner-access tests add package, presentation part and presentation model coverage. One core.xml content-type case adds an OPC integration obligation. The three expanded core-property BDD scenarios exercise all 15 fields, missing-part creation and save/reload. All 39 unit rows and three BDD rows are individually retained in [the case map](../pptx/properties-tags-case-map.json).

There is no pinned `tests/oxml/test_coreprops.py`. Source conversion/bounds requirements therefore supplement the test inventory rather than inventing additional collected cases. The source has 255 Unicode-code-point string limits; tolerant invalid imported date/revision reads; partial date and timezone-offset parsing; date serialization attributes; and positive revision writes. The TypeScript specification deliberately permits revision zero and rejects unsafe JS integers, implicit string coercion and timezone guessing. Original tests must cover these differences explicitly.

All 32 matching public API records are retained in [the API map](../pptx/properties-tags-api-map.json). D01 resolves the old documented `pptx.opc.coreprops.CoreProperties` path to `pptx.parts.coreprops.CorePropertiesPart`; both identities remain research provenance. No old module path becomes a product namespace. The 15 scalar members preserve neutral snake_case spellings. Source classes, attribution strings and fixtures are not copied into product material. Existing standalone MIT notice `docs/pptx/upstream-license-notice.txt` is retained; substantial derived material requires that standalone notice in an appropriate legal location.

## Original test design

Use small authored XML/ZIP inputs in memory and memfs for I/O. Independently inspect namespace-qualified XML values, relationship owner/target and saved/reloaded SDK results; do not assert only a write helper against its own read helper. Test every scalar field, 255/256 astral-character boundaries, invalid JS coercions, revision zero/negative/fraction/unsafe values, all three UTC date fields with caller-supplied dates and whole-second precision, missing versus empty, duplicate names, custom numeric/boolean/date/string types and unsupported typed XML preservation. Preserve foreign namespace declarations, unknown elements and custom XML associations through targeted edits and metadata sanitization.

Check presentation and slide tag ownership separately. Mutations of one scope cannot affect another. Unsupported tag forms and foreign namespaces are preserved, not silently reinterpreted. Ambiguous names fail before publication. The live model's creating getter remains distinct from noncreating `properties list/get` command inspection. Shared flags, value typing, schema/capabilities and JSON/exit behavior are verified through SDK and CLI.

## Disposable QA procedure

Root performs this procedure only after relevant unit checks pass. Select an existing small cached document from `docs/pptx/corpus-manifest.json`; verify bytes against its recorded SHA-256 before use. Do not download unit-test dependencies or include corpus bytes in product/tests. Read property metadata, edit an explicitly chosen value into a disposable output, reload it and compare untouched parts and associations. Apply a bounded metadata sanitation operation where supported and independently confirm preservation boundaries. Reduce any meaningful failure into a small original regression. Record exact file/hash, operations, checks and outcome; absence of an executed receipt means QA is not run. Root also obtains CLI screenshots where output is visually affected. No native office runtime is required or invoked.

## Delivery procedure

Run the maintained focused package checks and required integration closure. Record actual commands/results, distinguish untested obligations, and update row mappings to exact original test titles only after they exist. Root commits explicitly named owned files and this plan with relevant atomic changes after checks. Report local commit hashes separately. Do not push, release or execute the whole pipeline.

## Accounting checkpoint

The new ledgers preserve 39 unique unit rows, three BDD rows and 32 unique API source IDs. JSON parsing and identity/count checks passed. Every source metadata row now links an original TypeScript case, including missing core-part getter creation, all-15-field save/reload, all-three-date precision/type attributes and revision read variants. The domain worker reports 51 property, one creation-property and 32 existing creation cases passed. The additional OPC row links existing independently asserted content-type tests. Full `Presentation` factory integration remains visible as unsupported; the implemented metadata equivalent is an owned `openPropertySession` result. No source row is silently removed because it tests proxy wiring.

Root reported successful disposable QA on two SHA-verified corpus inputs; exact hashes and changed/unchanged member counts are retained in the evidence receipt. No corpus output was persisted or staged. Root's integration plan records maintained command execution and any screenshots. This worker did not commit, push, release, run a native reference runtime or execute the whole pipeline.
