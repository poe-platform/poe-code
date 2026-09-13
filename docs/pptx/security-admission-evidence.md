# Shared mutation security admission

This receipt covers the bounded shared mutation loader change, not complete F55
support. Implementation and executed checks are recorded in
[the domain plan](../plans/pptx-security-admission.md) and
[the CLI plan](../plans/pptx-security-cli.md).

## Research accounting

The pinned [test inventory](upstream-test-inventory.json) contains 2,700 expanded
unit variants and 973 expanded BDD cases. Searching every complete record for
signature, macro, encrypt, protect and sensitivity yields no direct security
case. The [test audit](upstream-test-audit.md) likewise does not establish this
adversarial security boundary. These original regressions are supplemental F55
cases; they do not close or merge any upstream parametrized or BDD obligation.
General OPC loading and metadata obligations remain in the existing individual
[case ledger](test-case-map.json).

The [API inventory](upstream-api-inventory.json) contains 2,407 records. Its only
member identity matching those security terms is
`pptx.enum.action.PP_ACTION_TYPE.RUN_MACRO`. That inert action enum is distinct
from admitting a macro-bearing package for mutation; this change makes no enum
coverage claim. Inherited members, public underscore-prefixed types, helpers,
collections and APIs without tests retain their existing obligations.

## Exact language and security mapping

The implemented operation surface uses asynchronous byte admission with explicit
limits and context. Metadata mutations return a promise and reject with
`OfficeError`, code `unsupported-edit`, phase `validate-intent`, when the shared
loader encounters the supported security indicators. The CLI invokes the same
domain operation, reports the version-1 error envelope and exits with status 1.
Output flags, force and dry-run do not grant permission to bypass admission.
Read-only metadata queries preserve their nonmutating path.

Macro/signature content-type markers and known part names supplement relationship detection;
absence of a relationship is not evidence that a package is safe to edit. This
does not execute macros, inspect arbitrary binary payload internals, validate a
cryptographic signature, remove rights or supply decryption credentials.

The bounded label subset rejects classification-label content types, the known
`/docMetadata/LabelInfo.xml` part, and custom properties named with the
`MSIP_Label_` prefix in the supported custom-property namespaces. Custom-property
inspection has cumulative byte/node limits. An ordinary custom property named
`label` does not grant or revoke access and remains editable. This is conservative
admission, not interpretation of effective rights or a label-removal feature.

The neutral model spellings and J01–J10 mappings in
[the language register](api-language-mappings.md) remain authoritative proposals
where their live model is unimplemented. This receipt does not present the
operation API as a completed `Presentation` object model.

## Boundaries

Complete explicit signature-graph removal and effect reporting remain
unimplemented. Guards outside the shared mutation loader require separate audit;
this change does not establish universal mutation admission or whole-API parity.
Existing encrypted-archive rejection is not newly implemented by this work.
Historical audit statements that adaptation had not started describe their
checkpoint, not the current package; this supplemental receipt supplies only
the bounded evidence linked above.

Tests use original in-memory assets and memfs. No upstream implementation or
fixture is copied, and no new derived-material notice is needed. Existing
standalone notices remain untouched. Disposable corpus QA uses the
[manifest](corpus-manifest.json); it is separate from unit evidence and never
ships with the package.
