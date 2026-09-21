# Independent DOCX interoperability qualification

Scope: only `independent-ooxml-interoperability`. Later tasks remain pending.
Preserve the historical schema receipt and all unrelated work. No push or release.

## Procedure

1. Read the DOCX and shared office specifications, root/scoped instructions,
   public API audit and complete API inventory. Inspect the existing original
   schema harness before proposing changes. Code changes require a failing
   original regression first; unit mutations use memfs.
2. Reacquire publisher ECMA-376 parts 1, 2 and 4; verify archive hashes against
   `docs/docx/standards-sources.json`. Extract only the XSD import closure into
   invocation-owned repository `/out/docx-independent-20260921`. Add the XML
   namespace schema and original entrypoints; verify all 54 schema file pins.
3. Require `/usr/bin/xmllint` with libxml2 2.9.13 (20913). Run the maintained
   `test:schemas` route with explicit absolute `DOCX_SCHEMA_ROOT`. Original
   representative outputs, malformed controls, schema-valid dangling references,
   raw extensions and Strict compilation discrepancies retain distinct outcomes.
4. Reacquire and hash-check the two selected historical corpus sources. Perform
   preserving first body text replacements with original inserted wording through
   the public SDK, explicit limits/cancellation and a memfs byte sink. Independently
   reopen packages, check ZIP CRCs, XML, relationship IDs/targets, membership,
   exact untouched payloads and changed text. Compare baseline/output schema
   diagnostics for the same selected parts. Rehash sources after editing.
5. Classify discrepancies individually: raw MCE/Word extensions are outside this
   profile; Strict publisher schema compilation failure is schema-unavailable;
   schema success cannot override required structural assertions. New meaningful
   defects require small original regressions independent of downloaded data.
6. Run maintained DOCX unit, lint/type, schema and selected workspace build closure
   checks. Record compact current evidence separately from historical evidence.
   Delete only invocation-owned downloads, schemas, outputs and temporary logs
   after evidence extraction. Commit explicit owned documents on main, without
   hook bypass, ignored fixtures or co-authors.

## Exact JS/security mappings and documentation drift

`replaceDocumentText(Uint8Array, { find, with, first: true, output: "-" }, context)`
is always async and backs common `text.replace`; operation options remain camelCase.
Publication uses an explicit async byte sink, cancellation and archive/work budgets.
The test validator receives bytes on stdin with `--nonet` and an empty catalog;
it is neither a product runtime dependency nor product filesystem/network authority.
Native statuses 0/1/3/5 map to valid/invalid/invalid/schema-unavailable only inside
the test harness; common CLI statuses and versioned envelopes remain unchanged.

Neutral model spellings, synchronous live properties, async admission/save,
UTC context timestamps, null inheritance, zero-based model sequences versus
one-based CLI selectors, keyed lookup, explicit bounds/errors and bounded
`.element`/`.part` authority remain governed by the shared SDK contract.
The parsed 920-row historical inventory has 410 planned, 378 security-mapped,
124 language-mapped and eight documentation-error entries. These are historical
research dispositions, not current whole-API implementation counts. Inherited
members, enums/aliases, collections, helpers, untested public APIs and documented
underscore-prefixed returns remain obligations; this task promotes none of them.

The existing research receipt linked to this missing plan. Restoring that link and
adding a dated rerun resolves evidence drift without replacing historical results.
Strict grammar, offline core-properties imports, raw MCE/vendor extensions and
rendering remain explicitly unvalidated. Schema success is not visual correctness.

## Execution

Current outcomes are recorded separately in
[the dated receipt](../docx/independent-schema-validation-20260921.md).
Existing test infrastructure is retained unless a concrete failing case establishes
a needed correction. Documentation-only qualification does not require an empty
code commit or fabricated red/green evidence.
