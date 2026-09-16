# Accessibility metadata research receipt

This F52 receipt covers structural metadata inspection/editing, independently
stored occurrence descriptions, decorative flags and slide-title diagnostics.
Passing evidence is recorded in the [QA plan](../plans/pptx-accessibility-qa.md).
Code presence or the historical reference-suite results do not establish a pass.

## Format evidence and limits

`cNvPr` stores drawing metadata `title` and `descr`; these are distinct from a
shape's `name`, the core document title and the text of a title placeholder.
The broader shape-edit contract maps `altText` and `description` to `descr`,
rejecting their simultaneous assignment. This bounded accessibility operation
uses `altText` for updates and exposes `description` as an output alias. Its
update schema rejects `description` as an unknown key. The direct accessibility CLI
uses appendix flags `--alt-text`, `--title` and `--decorative`; its output also
exposes `description`. This does not rename the neutral live model API.

The documented decorative element has namespace
`http://schemas.microsoft.com/office/drawing/2017/decorative`. Its optional `val`
has XML Schema boolean type and no declared default. Thus `1`/`true` and
`0`/`false` are boolean lexical forms; an absent value is not documented as true.
[MS-ODRAWXML CT_Decorative](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/1c5cfa5e-0042-48e3-ba41-2cc88fcc0266),
[schema](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/6146d89f-9146-415b-99e2-39e694b5a980).

The Open XML SDK lists `decorative` among allowed `a:ext` children.
[Microsoft element documentation](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.linq.a.ext?view=openxml-3.0.1).
The interoperability extension URI `{C183D7F6-B498-43B3-948B-1728B52AA6E4}` is
separately evidenced by the primary writer implementation's decorative output.
This URI evidence is an implementation observation, not a claim that the schema
page specifies the GUID. Only the format fact is used, not copied code.
[Writer implementation, `_write_decorative`](https://github.com/jmcnamara/excel-writer-xlsx/blob/main/lib/Excel/Writer/XLSX/Drawing.pm).

Official implementation notes match a slide placeholder to its layout by `idx`,
and a notes placeholder to its notes master by type. They do not independently
prove that every `cNvPr` attribute inherits or that a screen reader will announce
layout metadata. [MS-OE376 placeholder notes](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oe376/8b5c01b6-a623-4952-a8ab-e6a5177e47ec).
The utility's absent-field layout fallback is therefore a documented structural
inspection policy with source part/shape provenance. An explicit empty string
remains local and does not fall through. This is not renderer parity evidence.

XML Schema boolean whitespace is collapsed before lexical validation; XML
spaces, tabs and line breaks around a value do not change its boolean meaning.
Independent review found rejection of valid padded values; the domain worker
reproduced this in original cases and corrected the read normalization.
[W3C boolean and whitespace facets](https://www.w3.org/TR/xmlschema-2/#boolean).

Order means presentation slide-list order and depth-first shape-tree order,
including nested objects. It is not a calculated spatial reading order. Missing
and duplicate title diagnostics inspect title/centered-title placeholder text,
not object metadata title. Nonempty title text is trimmed at its boundaries and
compared exactly and case-sensitively across the presentation; a selected slide
can be marked duplicate because an unselected slide has the same title. Title
placeholder type can use the uniquely matched layout type when omitted locally.
No accessibility certification, contrast measurement,
screen-reader result or visual-order proof follows from these checks.

## Case and API accounting

The [case ledger](accessibility-case-map.json) retains exact inventory identities
for 49 nearby unit variants and 24 expanded BDD scenarios. These exercise shape
IDs/names, placeholder metadata, title lookup and collection behavior. Every
collected parameter/example remains a separate row. They are deferred live-model
parity obligations, not passes inferred from detached structural records.
The ledger separately records 29 domain cases, six command-engine cases and two
Shell cases, expanding all five invalid-update inputs, all five shape forms and
the two XML-whitespace boolean values. Three additional regressions prove that
validated read selection and metadata are captured before a byte capability can
mutate the caller objects, while stored nonenumerable selection fields remain
effective and accessor fields are rejected without invoking getters. The domain
worker reports all 29 focused cases passing. Test identities were verified against
current files; final maintained run evidence remains in the QA plan.

Review of all 2,700 collected unit identities and 973 expanded BDD identities
found no dedicated alt-text/decorative case names. The description-name match is
core `dc:description` comments, outside F52. Nearby chart/axis titles, core title,
shape creation/naming and geometry retain their existing feature obligations.
This focused selection neither deletes their global rows nor claims whole-suite
coverage. Pinned reference source was read to distinguish five object ID/name
variants, present/absent title lookup, sequence order and sparse placeholder
lookup from this operation surface. No reference fixtures were imported.

The [API ledger](accessibility-api-map.json) retains 103 public records including
inherited identity/name/placeholder properties, shape collection protocols and
the entire inventoried `_PlaceholderFormat` interface. A leading underscore is
not a private-API exemption. All these live API obligations remain deferred;
whole public API coverage is incomplete. Broader enum, helper and transitive
graph obligations remain in the complete inventory and register.

## JavaScript/security mapping and drift

`readAccessibility` and `mutateAccessibility` are async domain operations over
admitted bytes/capabilities. Results are detached arrays/records, not live model
proxies. The future model still retains documented snake_case properties,
zero-based sequences, keyed placeholder lookup, typed enums and explicit errors.
The CLI uses one-based positions and common fingerprinted selectors. Its JSON
uses operation camelCase options and the version-1 envelope.

Metadata strings are XML text, not executable markup. Invalid keys/types/control
characters and unsupported update keys fail validation before byte I/O.
Validated own data-property values are captured before asynchronous byte admission;
a capability callback cannot replace the accepted edit or broaden the selection.
Mutation changes occurrence `cNvPr`, not shared image bytes. External targets,
macros and media are not executed or fetched. No ambient host filesystem, clock,
fonts, native runtime, product network or renderer authority is introduced.

Historical audit language describing adaptation as not started is the baseline
checkpoint. This receipt is a later bounded implementation account; it does not
rewrite baseline inventories or upgrade unsupported model members. No new
substantial copied/derived code, fixtures or prose is included; the existing
standalone MIT research notice remains in place.
