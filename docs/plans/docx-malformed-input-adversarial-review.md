# Bounded hostile-input review

Owned task: `malformed-input-adversarial-review`, from
`docx-typescript-safe-bash.md`. Only this task is authorized. Lifecycle,
large-document, corpus, interoperability, whole-API and later tasks remain pending.
Main branch, owned local commits only; no push, release or README edits.
Unrelated source, evidence and concurrent master-plan edits are preserved.

## Authority and ownership

Read root AGENTS.md, the DOCX specification, shared Office CLI/SDK contracts,
API audit, reconciliation and parsed schema-version-2 API inventory. There are
no scoped AGENTS.md files under packages/docx. Product changes are confined to
packages/docx; there are no shared codec, root-export or safe-bash adapter edits.
No scoped instruction requires a separate agent verifier for these owned paths.
Independent wire/CRC fixtures and the existing independent package assertions
provide separate structural checks, without claiming full OOXML certification.

## Preserved red/green evidence

`packages/docx/src/adversarial-fields.test.ts` initially ran 8 cases: 7 failed
with expected `valid:false` versus actual `valid:true`; the valid nested and
cross-paragraph case passed. The failures establish missing native simple-field
instructions, foreign attributes impersonating instructions, orphan instruction
text, instructions after the separator, child markup in instruction text and
complex delimiters entering/escaping a simple-field container.

Validation now has a separate field-container scope, preserving bookmark,
comment and review story scopes. It requires the native simple instruction
attribute and an open pre-separator complex instruction region without child
elements. Invalid snapshots and document writes fail before any memfs sink call.
Nested independent complex fields inside simple fields and split instructions
across paragraphs remain valid. Instruction languages are not executed or fully
grammar-validated.

The first green run exposed one failure in the unchanged 32-case historical
field suite: missing simple instructions changed the utility error from
`unsupported-edit` to `invalid-package` because baseline validation now happens
earlier. The field utility preserves its original `unsupported-edit` mapping
only when every semantic diagnostic is `field-instruction`; mixed semantic
failures and malformed delimiter errors retain `invalid-package`. All 94 cases
in the new field suite plus original validation/field suites then passed.
No historical test was removed, renamed or weakened.

## Exact JS and security mappings

| Boundary | Mapping and evidence |
| --- | --- |
| Decoded validation | Synchronous `validateDocumentArchive(archive, options?, budget?)`, admitted Uint8Array members, readonly snapshots, located string diagnostics; invalid semantic input returns `valid:false` |
| Byte validation | Always-async `validateDocument(input, context, options?)`; byte admission establishes container integrity, then shares decoded semantic validation |
| Document publication | Always-async explicit sink/context; SemanticValidationError uses `invalid-package` and diagnostics; failed validation makes zero sink calls and leaves memfs prior bytes intact |
| Field utility | Existing fields.list/set spelling and asynchronous engine remain; instruction-only semantic failures preserve historical UnsupportedEditError/`unsupported-edit`; no implicit instruction execution |
| XML | Exact namespace URI/local-name identity, strict encoding, no DTD/custom entities or target resolution; predefined/numeric XML characters retain existing behavior |
| Authority | Explicit bytes or capability-scoped VFS only, explicit cancellation/limits, no ambient paths, credentials, author, clock or network authority added |
| Model obligations | The inventory retains 920 records: 572 documented/inherited model, 335 returned views/protocols, five explicitly internal source-support constructors and eight documentation errors; inherited members, enums, helpers, collections and public underscore-prefixed owners keep their existing dispositions |

Documentation drift is corrected in `docs/docx/validation-profile.md`: utility
validation and VFS publication are implemented, while live owners/rendering are
incomplete; `field-instruction` and independent simple-field boundaries are now
listed. The pinned inventory, API audit and their historical evidence are not
rewritten or promoted into whole-public-API coverage.

## Maintained checks

- `npm run build:workspaces -- --workspace=docx`: passes the declared selected
  build closure: office-package, frontmatter, safe-fs portable, toolcraft-design,
  docx; no native reference build or native safe-fs asset build.
- `npm test --workspace=docx`: 3,336 tests / 165 files pass, including unchanged
  historical tests and independent package assertions. Concurrent unrelated
  packing/discovery tests are checked but not owned or committed here.
- `npm run lint --workspace=docx`: ESLint, source TypeScript and test TypeScript
  pass; one warning in untouched operation-types.test.ts remains visible.
- Focused hostile-wire suite: 49 cases pass independently of downloads.
- After adding the final host-read/open probes, both owned suites pass together:
  57 cases / two files. Maintained DOCX lint/source/test type checks pass again;
  product source is unchanged since the full maintained suite/build above.
- `git diff --check`: passes.

The malformed-field human command output was rendered with the maintained
`npm run screenshot` runner against the built docx command engine and inspected
at `output/docx-malformed-input-qa/field-error-verified.png`. It shows exit 1,
the bounded public instruction diagnostic and honest partial-validation checks,
with no document passage disclosed. Root `screenshot-poe-code` targets a different
CLI. An earlier inline runner syntax error is preserved in field-error.png and
is QA setup failure, not product behavior or passing evidence. These disposable
screenshots are not staged; no screenshot test or QA script was added.

## Hostile ZIP/XML/document regression coverage

`packages/docx/src/adversarial-input.test.ts` constructs original bytes with its
own ZIP32 record builder and bitwise CRC implementation, independently of the
product writer/checksum. Stored package baselines verify exact member bytes and
pass byte validation for absent, signed and unsigned data descriptors. The
fixture-only Node deflater compresses original 2 KiB text for actual expansion
tests; it is not a product dependency or a native reference project build.

The 49 cases cover local/central signatures, versions, methods, CRCs, sizes,
name lengths and offsets; descriptor CRC/size mismatches; matching-header lies
about actual expansion/CRC; encoded dots/slashes/backslashes/control bytes;
duplicate and case-colliding parts; duplicate relationship IDs, dangling or
unsafe targets, query-bearing targets, invalid modes and spoofed namespaces;
normalized duplicate bookmark/revision IDs, mismatched review endpoints,
malformed field delimiters, huge cell spans and unmatched vertical continuations.
Located semantic diagnostics distinguish invalid graphs from unknown schemas.

Double-encoded dot sequences remain literal canonical part names. The positive
fixture has a declared XML content type, validates and retains its exact member
name; there is no second decoding or host extraction. Prefix substitutions
recognize actual native instruction markup while foreign instruction-shaped
markup remains inert. XML cases reject DTDs/external/parameter entities, unknown
entities, reserved-prefix rebinding and duplicate expanded attributes.

Host read/open and HTTP/HTTPS/fetch traps remain uncalled for inert external
relationships and executable-looking cached-field instructions through SDK and
CLI validation. The command reads only its explicitly supplied memfs input once;
input and unrelated bytes are unchanged. Separate XML rejection probes intercept
host reads and network requests. Static inspection of the archive, ZIP/runtime,
package, URI, XML and validator code finds no ambient host/network imports or
target dereference. This qualifies these bounded paths, not arbitrary injected
host JavaScript or a universal runtime sandbox.

Small resource cases exceed actual compressed-input bytes, expanded entry size,
XML element/depth/attribute/work allowances and logical table cells. Compressed
expansion is bounded before allocation and decoding also rejects actual-length
lies. XML work beyond input decoding is charged; failed table admission leaves
every ledger count within its finite ceiling. Existing archive/XML/budget and
publication tests additionally qualify aggregate, retained, diagnostic, member,
namespace and text limits. No timeout is substituted for these bounds, no
default ceiling is raised, and no RSS-isolation claim is made.

CLI cases retain version-1 JSON, zero affected objects, null failed data and
exits 1/2/4 for invalid instructions, unknown profiles and XML-node exhaustion.
Valid inert input has identical SDK/CLI validation data. Unsupported profiles
are errors, never successful edits. The earlier wire-suite syntax/setup errors
and incorrect initial validateDocument argument order were corrected before
counting behavior evidence; they caused no product change. All adversarial cases
use original content independent of downloads. No corpus was acquired, consumed
or cleaned up, and no external wording, project identity or asset was copied.

Field correction is delivered in local commit `dea8d0a53`. Hostile-input coverage
is implemented and verified for this task only; its separate owned test/evidence
commit completes local delivery. Later tasks remain pending; the concurrent
master plan is not staged or rewritten. No full-schema, whole-public-API,
renderer, interoperability, corpus, remote delivery or release claim is made.
