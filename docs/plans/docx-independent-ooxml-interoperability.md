# Independent DOCX schema interoperability

Task: `independent-ooxml-interoperability` only. Later pipeline tasks remain pending.

## Ownership and boundary

Own `packages/docx/tests/schema-consumer.ts`, its unit tests, the separate schema
suite, schema pins and original schema entrypoints, the package schema-test script,
its Vitest configuration, this plan and the independent schema research receipt.
Preserve the preexisting packing/discovery/product/spec/audit changes and all
historical evidence. Do not stage the already modified pipeline. One atomic test
infrastructure improvement is committed locally on main; no push or release.

No product dependency, command, SDK member, host capability or branding changes.
No native reference build, downloaded unit fixtures, renderer or product networking.
The external validator consumer is test infrastructure; the corpus procedure below
is manual QA executed by an agent, not a checked-in QA script.

## Red/green and maintained checks

1. Add original schema acceptance cases before implementing the consumer. Run the
   dedicated config and observe failure resolving the missing consumer. The initial
   merged config accidentally included root tests; terminate that owned invocation
   and replace the include list explicitly. The focused red log is
   `/tmp/docx-independent-20260915/red-focused.log`.
2. Implement the test-only consumer with exact version and complete schema-byte
   pins, explicit absolute `DOCX_SCHEMA_ROOT`, offline schema imports, stdin bytes,
   bounded execution and diagnostics, and separate invalid/schema-unavailable
   results. Missing prerequisites, timeouts and unexpected exits fail rather than
   skip. Unit consumer tests mock the external process and mutate only memfs.
3. Run `npm run test:schemas --workspace=docx` with the explicitly populated pinned
   directory. Assert original DOCX/DOTX creation, title/style/formatting/nested tables,
   preserving text replacement, malformed and lexical negatives, a schema-valid
   dangling relationship, compatibility extension refusal and the Strict compiler
   discrepancy. Structural assertions remain authoritative and unchanged.
4. Run maintained `npm test --workspace=docx`, `npm run lint --workspace=docx`,
   scoped Prettier and whitespace checks. Tests-only changes do not affect visual
   CLI output, so CLI screenshots and renderer QA do not apply to this improvement.
5. Review and explicitly stage only owned paths. Commit with Conventional Commits
   and enabled hooks on main. Verify the commit/path set and preservation of other
   authors' edits. Keep downloaded schemas, corpus documents, edited packages and
   temporary logs out of the commit. No empty read-only commit.

## Reproducible independent tooling setup

Use `/usr/bin/xmllint`, libxml2 **2.9.13** (reported as `20913`). It is independent
standards tooling, not another document CLI. Do not silently substitute versions.
The dedicated schema suite is separate from the fast canonical unit suite; native
processes and downloads are never unit-test dependencies.

1. Retrieve ECMA-P1/P2/P4 publisher archives using the URLs and SHA-256 values in
   `docs/docx/standards-sources.json`. Verify each outer archive before extracting
   only `OfficeOpenXML-XMLSchema-Strict.zip`,
   `OfficeOpenXML-XMLSchema-Transitional.zip` and
   `OpenPackagingConventions-XMLSchema.zip`. Place their XSD members in `strict`,
   `transitional` and `opc` respectively under a disposable absolute directory.
2. Retrieve `https://www.w3.org/2001/xml.xsd` as `xml.xsd`. Require SHA-256
   `61960fb3131e38022caad5360e2f33a3382578ab3c80cd58bd74320ede61b20c`
   and 8836 bytes. This completes the standard XML namespace import without
   changing publisher schemas. Copy the two original entrypoints from
   `packages/docx/tests/schema-entrypoints` to the directory root.
3. Set `DOCX_SCHEMA_ROOT` only for the schema-test invocation:
   `DOCX_SCHEMA_ROOT=/absolute/disposable/directory npm run test:schemas --workspace=docx`.
   The consumer verifies every XSD/entrypoint against `schema-pins.json` before
   cases run. It sets `XML_CATALOG_FILES` empty and uses `--nonet`; no global XML
   catalog changes, runtime dependencies or validation-time downloads.
4. Raw WML imports omit a location for the XML namespace; entrypoints import the
   pinned XML namespace schema first. Do not rewrite the publisher XSD or remove
   extension attributes/content from documents to manufacture success.

## Manual disposable corpus procedure

Verify the immutable source SHA-256 against `corpus-manifest.json`. Apply a single
body-only first literal replacement through `replaceDocumentText`, writing to a
memfs sink. Use the existing declared utility options (`find`, `with`, `first`,
`output`) and an explicit signal/archive profile. Reopen the edited ZIP with an
independent ZIP/XML consumer; check CRC, identical membership, exact untouched
payloads, internal targets and owner relationship IDs without fetching externals.

Run the same pinned XSD profile on selected original and edited content types,
relationships, main story, styles, numbering, settings and font table parts.
Compare actual diagnostics as well as exit statuses. Record original versus new
schema failures, unsupported extensions, and semantic checks separately. Never
reinterpret an unchanged baseline diagnostic as schema success.

Selected successful inputs are `gst-reforms-interim-appendixb` and
`hk-values-story-teacher`. An exploratory `gst-reforms-interim-appendixc` edit
reached the cumulative retained-byte ceiling; record its refusal separately,
without raising product limits or claiming success. The small independent unit
helpers also reject larger corpus profiles by design; keep their ceilings intact.

Source files and other campaigns' caches remain untouched. Only invocation-owned
disposable outputs may be cleaned up; preserve the manifest and concise evidence.
Do not commit source passages, images, document bytes or copied schema libraries.

## Exact JS/security mappings and drift

| Surface          | Mapping and evidence boundary                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema consumer  | Synchronous test-only process over owned Uint8Array via stdin; readonly diagnostic/status result; explicit absolute test schema directory; no runtime export                                                |
| Utility creation | Always-async `createDocumentArchive(options, context)`; neutral names; DOCX/DOTX typed kind and explicit dialect; original content; no implicit host identity/time                                          |
| Text replacement | Always-async `replaceDocumentText(bytes, options, context)`; shared `text.replace` semantics and camelCase options; first/all selection and supplied memfs sink; retained formatting and unrelated payloads |
| Validation       | Synchronous `validateDocumentArchive`; schema success cannot override relationship/reference invariants; external native exit statuses are test-only and do not change shared CLI exits                     |
| Model API        | No new live owner/member. Preserve neutral snake_case methods/properties, inherited interfaces, enums/aliases, collections, helpers and public underscore-prefixed obligations                              |

The historical inventory retains 920 records (410 planned, 378 security-mapped,
124 language-mapped, 8 documentation-error), including 417 inherited records and
12 underscore-prefixed public owner types. No inventory row is promoted or hidden.
Whole-public-API conformance remains pending.

The applied-style fallback was confirmed against the existing original regression
and product implementation; it is deliberate. Do not change it to satisfy a generic
dangling-style expectation. The schema-valid structural negative uses an absent
hyperlink relationship instead. Strict publisher default inconsistencies, missing
Dublin Core schema imports and raw MCE extension rejection are tooling/profile
discrepancies, not new API promises. Existing comment/date/name drift decisions
remain historical and unchanged.

## Completion

Completed locally: maintained DOCX package unit route passed 169 files / 3367
existing tests; the new mocked consumer file passed 7 tests separately. The final
dedicated native schema route passed 10 declared checks. Maintained package ESLint,
source typecheck and test typecheck passed (one warning in the untouched
`operation-types.test.ts`). Scoped Prettier and whitespace checks passed.

The final checks and per-input results are recorded in
`docs/docx/independent-schema-validation.md`. Schema success establishes only the
selected grammar profile, not rendering, repair-warning absence, extension
semantics, full package invariants or complete model/API coverage. No push or
release is authorized; subsequent tasks remain pending.
