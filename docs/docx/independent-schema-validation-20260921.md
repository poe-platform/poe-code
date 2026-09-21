# Independent DOCX schema qualification, 2026-09-21

Bounded task: `independent-ooxml-interoperability`, baseline `10975e636`.
The [execution plan](../plans/docx-independent-ooxml-interoperability.md) restores
the missing historical plan link. The [earlier receipt](independent-schema-validation.md)
and its exact per-part diagnostics remain historical evidence, without replacement.
This campaign exercises existing original infrastructure; no product or test code
change was justified by a reproduced defect.

## Pinned independent profile

`/usr/bin/xmllint`, libxml2 **2.9.13** (`20913`), matched the recorded version.
Reacquired ECMA-376 fifth-edition parts 1, 2 and 4 matched all three archive hashes
in `standards-sources.json`. All **54** extracted schema/import/entrypoint hashes
matched `packages/docx/tests/schema-pins.json`, including the separate XML namespace
schema. This is test infrastructure only, with no runtime dependency or shipped
schema assets. Validation receives original bytes on stdin with `--nonet` and an
empty XML catalog environment; downloaded data never enters unit tests.

The maintained schema route passed **10/10** original cases: DOCX/DOTX creation,
styles, nested tables, preserving replacement, malformed/lexical negative controls,
dangling references, extensions and Strict schema compilation classification.
Required structural assertions remain authoritative: the schema-valid missing
hyperlink relationship still fails package assertions and semantic validation.
There was no assertion relaxation or source markup stripping.

Strict WML compilation remains **schema-unavailable**, because publisher defaults
`beforeAutospacing`, `afterAutospacing` and `nlCheck` conflict with their Strict
types. Offline core-properties imports, raw MCE/vendor extensions and unselected
part grammars remain outside the profile. Schema success is not visual correctness;
no renderer, repair-warning or visual CLI qualification is claimed.

## Selected disposable corpus edits

Both source hashes matched the unchanged corpus manifest. The public async
`replaceDocumentText` engine performed a first body literal replacement, inserting
original `Verified ` wording. Explicit limits/cancellation and memfs byte sinks
provided publication authority; source hashes remained unchanged after editing.
Each operation used a fresh context: 32 MiB compressed/entry/expanded limits,
4,096 members, 512 MiB retained capacity and 64 KiB chunks. These selected small
inputs do not establish large-document support.

| Input                           | Source SHA-256                                                     | Output SHA-256                                                     | Output bytes / parts |
| ------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------- |
| `gst-reforms-interim-appendixb` | `a31019aed3f706fdbfa8a51469456f3e26e2b5e98a6a9d0623e0e2cc268912cb` | `1fa2087901f5467c2778e0f9244acc6ba30cc344fd0e42205005ef4682105c34` | 620,472 / 41         |
| `hk-values-story-teacher`       | `a96c37ee8b824ae0f2bc8cab0ffddfd40c37f1b3a642d18a24a827db1e0121b3` | `17bc8ad1c4e843509659d6e50be66294b3ba331809eba93aaea7b6b0d1989a7f` | 208,949 / 17         |

Independent Python ZIP/ElementTree checks passed CRCs, XML well-formedness, member
uniqueness, content-type coverage, internal relationship targets and owner-local
relationship ID uniqueness for both complete packages. Member sets were identical;
only `word/document.xml` changed, and every other payload remained byte-identical.
Reloaded product text confirmed the intended replacement independently of change
metadata. Baseline and edited outcomes matched for all eight selected parts per input:

| Selected part                  | First input diagnostic count | Second input diagnostic count | Outcome before and after              |
| ------------------------------ | ---------------------------- | ----------------------------- | ------------------------------------- |
| `[Content_Types].xml`          | 0                            | 0                             | Valid                                 |
| `_rels/.rels`                  | 0                            | 0                             | Valid                                 |
| `word/_rels/document.xml.rels` | 0                            | 0                             | Valid                                 |
| `word/document.xml`            | 463                          | 213                           | Invalid in raw extension-free profile |
| `word/styles.xml`              | 1                            | 1                             | Invalid in raw extension-free profile |
| `word/settings.xml`            | 2                            | 2                             | Invalid in raw extension-free profile |
| `word/numbering.xml`           | 46                           | 5                             | Invalid in raw extension-free profile |
| `word/fontTable.xml`           | 1                            | 1                             | Invalid in raw extension-free profile |

Every diagnostic **signature and occurrence count**, rather than only totals, was
compared before/after and remained identical. The exact classified members are
MCE `Ignorable`; Word 2010 `paraId`, `textId` and the **element** `docId`; Word 2012
`restartNumberingAfterBreak`; and Word 2016 `durableId`. The initial disposable
classification probe incorrectly assumed every extension diagnostic concerned an
attribute and failed on `docId`. It was corrected to the exact element diagnostic;
all structural requirements and baseline/output equality checks stayed intact.
No new product finding required a downloaded-data-independent regression; existing
original controls cover grammar, MCE, reference and validator failure distinctions.

## Contracts and evidence authority

The [exact JS/security mappings](../plans/docx-independent-ooxml-interoperability.md#exact-jssecurity-mappings-and-documentation-drift)
retain neutral model spellings, plural resources, common `text.replace` options,
schema/capabilities and public exit semantics. Native validator statuses are
test-only classifications. Inherited members, enums, collections, helpers,
untested public APIs and documented underscore-prefixed owners remain in scope.
The complete 920-row historical inventory was parsed; no API disposition is promoted
by this qualification and no whole-API claim follows. Later tasks remain pending.

## Maintained checks and delivery

The selected `npm run build:workspaces -- --workspace=docx` closure passed.
`npm run lint --workspace=docx` passed ESLint and source/test TypeScript checks,
with one existing unused-type-binding warning.
`DOCX_SCHEMA_ROOT=<absolute pinned root> npm run test:schemas --workspace=docx`
passed one file / 10 checks.
`npm test --workspace=docx -- --maxWorkers=1` passed **252 files / 5,191 tests**
in 444.89 seconds, including the original memfs validator-consumer tests.
Temporary evidence is confined to invocation-owned repository `/out`; downloaded
schemas/corpus files, outputs and temporary logs were removed after extracting
this receipt; none are committed. Scoped formatting and whitespace checks passed.
Delivery is an owned local Conventional Commit on main only; no push or release.
