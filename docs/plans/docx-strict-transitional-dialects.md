# Strict and Transitional dialect task

Status: Implemented and verified; owned local commit prepared. Later tasks pending.

Scope: only `strict-transitional-dialects`. Later pipeline tasks remain pending.
The already modified aggregate pipeline plan is unrelated work and is not owned
by this change. No push or release is authorized.

## Evidence and implementation

Baseline inspected: `b7b9633852c857c3b7be73db9dc90ea45322f7ac`.
Read root policy, DOCX and shared Office contracts, the API audit and parsed
inventory. The baseline exposes archive/OPC/XML/MCE codecs, not a document model
or safe-bash command. Root exports and safe-bash are unchanged.

Admission previously selected a dialect solely from the main root namespace;
it did not compare the main relationship or related Word parts. New original
paired fixtures reproduced those gaps before product edits. The new vocabulary
and checks remain in `packages/docx`; existing tests and names are retained.
No reference runtime/build, downloads, copied assets or product host I/O/network
access were used. Unit publication uses memfs.

Reviewed the pinned schema namespace table in `docs/docx/standards-coverage.md`
and the local P1/P4 `wml.xsd` declarations for document/body and legacy elements.
Standards references remain research evidence; neither full-schema conformance
nor a semantic formatting-value mapper is claimed. The implemented support and
limitations are listed in [the codec documentation](../docx/dialects.md).

The new tests cover both dialects for detection, misleading filenames/unused
declarations, related roots/types/relationships, active elements/attributes,
selected and unselected MCE, text/CDATA/comments/instructions, qualified and
expanded attribute names, unchanged payloads, legacy VML, failed staging and
minimal DOCX/DOTX creation. Creation uses the requested dialect and defaults to
Transitional with original deterministic metadata. No full-document conversion
or VML normalization exists.

## Exact JS/security and documentation mapping

- `DocumentDialect`: closed string union, no coercion. Frozen namespace tables
  are lookup data, not a new enum or promise of semantic support.
- `createDocumentArchive(options, context)`: always async, required typed options
  and explicit archive limits/signal, owned `Uint8Array` package members. Optional
  undefined uses defaults; null and unknown fields/values fail `usage`. Deterministic
  1980 ZIP timestamps replace ambient time. No template/content/model API is added.
- Existing `setAttribute` retains its name and positional order, adding an
  expanded-name object in the existing name position. No camelCase alias layer
  for the model is introduced. `setText`, source identity and rollback semantics
  remain synchronous and owner-bound.
- Invalid package/dialect structures use `InvalidPackageError`, code
  `invalid-package` (future ordinary CLI exit 1). Malformed XML/MCE and unsupported
  profile/edit failures keep their existing typed codes (exit 1). Usage is exit 2,
  limits exit 4, cancellation exit 130. Raw writer publication still requires
  candidate document readmission; no claim of transactional CLI publication.
- The create row had omitted an explicit dialect option despite F02 and the
  planned creation task requiring it. The spec and documentary command register
  now agree on `--dialect` / SDK `dialect`, Transitional default, template retention
  and conflicting-template refusal. Their runtime statuses stay planned.
- The complete parsed inventory remains 920 records: 410 planned, 378
  security-mapped, 124 language-mapped, eight documentation-error records and
  23 recorded documentation resolutions. None is promoted to model implementation.
  The audit's historical "SDK implementation not started" is a model-surface
  statement; low-level codec work does not establish those model APIs. Inherited
  members, enums, collections, helpers, APIs lacking source tests and documented
  underscore-prefixed public types remain in the inventory and pending.

## Red/green evidence

- `/tmp/docx-dialects-red.log`: 16 new failures; all 286 pre-existing tests passed.
- `/tmp/docx-dialects-green-first.log`: new tests passed; an existing
  case-insensitive content-type test caught the new owner-filter comparison.
  Corrected the comparison, preserving the original test.
- `/tmp/docx-dialects-target-type-red.log`: two original regressions demonstrated
  admission of Word relationship targets mislabeled as generic XML before fixing.
- `/tmp/docx-dialects-edge-red.log`: a new original relationship with an opaque
  matching suffix exposed a validator lookup mistake before correction. Validation
  now uses the exact main edge already selected by admission.
- `/tmp/docx-dialects-diagnostics-red.log`: four failing original cases showed
  imprecise main-edge cardinality/mode diagnostics before their correction.
- `/tmp/docx-dialects-green.log`: intermediate 312-test pass before the final
  four diagnostic regressions; final results are recorded below.

## Final verification

- `npm run test --workspace=docx`: 316 passed across ten files, including all
  286 original tests; `/tmp/docx-dialects-tests-final.log`.
- `npm run build:workspaces -- --workspace=docx`: passed the declared three-package
  dependency closure; `/tmp/docx-dialects-build-final.log`.
- `npm run lint --workspace=docx`: ESLint plus production/test TypeScript passed;
  `/tmp/docx-dialects-lint-final.log`.
- Built `docx` ESM public consumer: created each dialect, used expanded-name
  lookup to change an existing page-width attribute, wrote into memfs, reopened,
  and independently verified namespace retention, five parts and width value.
- Parsed command JSON: `--dialect` and SDK `dialect` definitions agree, feature
  and command runtime statuses remain pending. Spec checker passed with zero
  warnings. `Implemented Through` stays Not applicable for the full proposed spec.
- `git diff --check`: passed.

No CLI visual behavior changes, so no CLI screenshot is applicable. No document
renderer or large downloaded-corpus qualification is claimed. Historical logs,
unrelated changes, ignored fixtures and all subsequent task statuses are retained.

Stage only the owned implementation/test/documentation paths and create one
atomic Conventional Commit on main, without bypassing hooks or adding co-authors.
Report the local hash separately from delivery: no push and no release.
