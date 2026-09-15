# Bounded signature inventory and explicit removal

This task implements F43 only. Later tasks, cryptographic verification and
regeneration, general batches and whole public model coverage remain pending.
No downloads, reference builds or derived source/test assets were used.

## Contract and implementation

`docx signatures list INPUT` inventories exact OPC signature content-type roles
and exact standard origin/signature/certificate relationship URIs, including
orphan declared parts, unusual well-formed target roots and inert external
relationships. Folder names and similar MIME/URI spellings establish no role.
`verified` is always null. Invalid XML still fails normal admission.

`docx signatures remove INPUT` is the shared-contract spelling of explicit
signature stripping; `strip-signatures` remains rejected as usage. It is a
separate operation, never an implicit mutation flag or a regeneration step.
It removes all declared signature targets, their owned relationship parts,
all signature relationships, every removed-part content-type override, and
signature content-type defaults. Retained relationship XML is edited through
the namespace-aware preserving editor. Ordinary document members remain byte
identical. Admitted normalized OPC identity governs encoded archive names.

Unsupported outgoing relationships and ordinary incoming references to the
signature graph reject before publication, rather than delete shared content.
Signature graphs overlapping native Word parts reject. Existing protection and
locked controls remain guarded. Ordinary publication rejects a signed admitted
baseline even if a caller has already removed signatures from its candidate.
The explicit strip operation validates isolated graph removal before publishing
its unsigned, otherwise unchanged baseline through existing atomic staging.

Removal receipts enumerate `removedParts`, `removedRelationships` (owner, ID,
exact type, internal target or null for redacted external targets), and
`removedContentTypes` (default/override, exact stored name and content type).
`affected` counts removed package parts, including owned relationship parts;
relationship and declaration counts are separately explicit. External-only
removal can change metadata with zero removed parts. Dry runs report the same
effects with null output and no publication. Empty mutation fails unless
`allowEmpty` is explicit. A VFS script verifies removal receipt completion before
a subsequent independent text edit; a refused removal prevents the edit.

## Exact JS language/security mappings and drift

| Surface | JS mapping, authority and status |
| --- | --- |
| Utility inspection | `inspectDocumentSignatures(bytes, options, context): Promise<SignatureListData>`; owned Uint8Array input, async bounded admission, immutable snapshot types, source SHA-256 locations, null validity. CLI `signatures.list` uses this domain API. |
| Explicit utility stripping | `stripDocumentSignatures(bytes, options, context): Promise<SignatureMutationData>`; camelCase `output/inPlace/force/dryRun/allowEmpty/json/limit`, optional admitted `input` identity. Explicit VFS/stdout and cancellation authority; neutral usage/missing-selection/unsupported-edit/limit/publication errors. CLI `signatures.remove` uses this same API. |
| Receipt admission | Optional synchronous `admitPublication(planned): undefined` reserves full human/JSON receipt budgets before publication. It cannot add a later edit. Returned promises or other values reject. |
| Package and relationship model | Pinned Package/OpcPackage `parts/rels/iter_parts/iter_rels/save`, Part/XmlPart `blob/content_type/partname/related_parts/rels/load/target_ref`, and `_Relationship` `is_external/target_part/target_ref` retain their existing security-mapped dispositions. These utility snapshots do not implement live model members or change their neutral names. |
| Inherited and wider public API | Document/Settings/story owners, inherited package/XML members, collections, enums, helpers and every public underscore-prefixed owner remain inventoried at their existing dispositions. No row is hidden or promoted by F43 tests. |
| Declaration drift | The command table previously described `signatures.list` as selectedRead despite the normative package-global inventory rule. It now uses read (json/limit only); story and resource selectors reject as usage. Additive signature-specific result schemas describe the executed snapshots instead of implying the full generic planned model. |
| Existing documentation errors | The pinned comment_id/timestamp versus id/date, inherited/public-type and enum/collection discrepancies remain as recorded in the audit/reconciliation; this task invents no aliases and rewrites no historical inventory. |

The [API audit](../docx/upstream-api-audit.md) and
[pinned inventory](../docx/upstream-api-inventory.json) were reviewed for the
package/relationship support graph. Neither identifies a dedicated live
signature owner. The original inventory remains historical evidence.

## Failing tests before code

New original regressions first failed for absent domain operations and absent
command dispatch/discovery. Subsequent failing regressions reproduced signed
baseline removal through ordinary publication, caller mutation changing the
inventory fingerprint, and percent-encoded signature names failing removal.
Each fix followed its failing regression. Unit mutation fixtures use memfs;
VFS integration uses the configured memory adapter, without ambient host I/O.

Evidence covers multiple signatures and shared certificates, unusual payload
roots, external target redaction, malformed XML, protection refusal, unsafe
incoming/outgoing ownership, exact stripped graph/content-type closure,
ordinary-content preservation, dry runs/empty consent, prepublication receipt
limits, atomic destination failure, caller-owned byte changes, encoded names,
in-place stripping, failed in-place preservation and binary stdout.

## Maintained validation

Checks and final counts are recorded after completion below. The focused scope
uses the maintained DOCX package test/lint routes and the explicitly selected
DOCX build closure, plus native safe-bash DOCX command tests and scoped ESLint.
Ad hoc screenshots use the maintained screenshot renderer; local output
fixtures and screenshots remain disposable QA artifacts and are not staged.

Verified checks:

- `npm test --workspace=docx`: 142 files / 2,934 tests passed. Final source changes
  also passed the focused rerun below.
- `npm run lint --workspace=docx`: passed ESLint and both maintained TypeScript
  projects; existing type-only unused-variable warning remains unchanged.
- `npm run build:workspaces -- --workspace=docx`: selected five-stage declared
  dependency closure passed, including portable safe-fs assets and design smoke.
- `npx vitest run scripts/docx-exports.test.ts packages/docx/src/signatures.test.ts
  packages/docx/src/signatures-command.test.ts`: 20 tests passed, including
  portable public export bundle and the final 15 domain regressions.
- Focused native safe-bash DOCX group: 136 tests passed; scoped ESLint passed.
  Subsequent expanded signature cases and human/discovery checks passed their
  focused reruns.
- Ad hoc signature help/results screenshots were rendered and visually inspected.
  Their original setup actions are complete; disposable executable setup files
  are removed, and screenshots are retained locally without staging.

Only this bounded task is complete. No remote push or release is requested.
The already modified pipeline/OMML documents and unrelated plan are preserved.
