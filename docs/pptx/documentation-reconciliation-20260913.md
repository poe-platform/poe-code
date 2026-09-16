# Presentation documentation and corpus reconciliation

Status: bounded documentation/evidence receipt; whole-format and whole-public-API
coverage remain incomplete. No product implementation, README, push, release or
whole-pipeline execution belongs to this task.

## Exact accounting

[The join receipt](documentation-accounting-20260913.json) hashes the inspected
specifications, research inputs and ledgers. Every one of the 2,700 collected unit
variants and 973 expanded BDD examples has exactly one source-pointer row, a unique
neutral case ID and a TypeScript target. No parameter/example is collapsed.
The ledger contains 1,088 non-null original designs. Its historical dispositions
are 2,585 semantic reviews required, 877 provisional designs, 167 specified but
unimplemented designs, 43 passing original cases and one deferred public behavior.
These are stored ledger dispositions, not a fresh execution of all family receipts.
Task assignment and provisional wording do not establish behavioral equivalence.
The map-every-case obligation remains open.

All 2,409 API inventory identities join exactly once into the 2,426-row public
register; 17 rows describe additional bounded views. This corrects the stale
2,407-record prose count in the historical audit as a current-count reconciliation,
without rewriting that checkpoint or promoting its statuses. The inventory retains
425 records with an underscore-prefixed path component. No public member is removed
because of its spelling, inheritance, lack of tests or returned-interface status.
The central API map still labels 2,424 rows unimplemented and two implemented;
newer family receipts are required to assess current individual members.

The reference test/API identities stay in the existing research ledgers. Derived
research retains the standalone [case notice](test-case-map-notice.txt),
[API notice](public-api-map-notice.txt) and [baseline notice](upstream-license-notice.txt).
No reference code, text, image, chart workbook or media is adapted into a product
fixture here. Preexisting untracked audits and shared specs were read and hashed,
not adopted into this task's commit.

## Language and security mappings

The exact member signatures, defaults, side effects and error dispositions remain
in [the API register](public-api-map.json) and [J01–J10](api-language-mappings.md).
The shared [SDK](../specs/office-sdk.md) and [CLI](../specs/office-cli.md) govern:

| Boundary                | Required mapping retained by this reconciliation                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Names and arguments     | Neutral model spellings and positional order; keyword-only parameters become trailing typed options retaining their names; reserved positional `default` binds as `default_value`; operation JSON uses camelCase.                                                                           |
| Admission and ownership | Factories, save and image/movie/input admission always return Promises; owned in-memory properties and methods remain synchronous. Bytes/dates are copies, returned graph objects are live, replacement invalidates old handles, cross-owner assignment requires explicit import.           |
| Collections             | Zero-based checked sequences versus sparse placeholder keys; `.length` and iteration; only registered collections have negative `.at` or `.slice(start,end,step)`. Slice step is a nonzero integer; omitted bounds follow direction, negatives normalize and bounds clamp.                  |
| Values                  | Finite safe EMUs; one nearest rounding with halves away from zero; centipoints accessor floors division by 127. Null/false/zero remain distinct. UTC dates serialize whole seconds. RGB channels are 0–255. Typed enum symbols/aliases remain available independently of editing support.   |
| Errors                  | Value/type/index/key map to `ValueError/invalid-value`, `TypeError/invalid-type`, `IndexError/index-out-of-range`, `KeyError/missing-key`; unavailable/read-only properties use `PropertyAccessError` with distinct codes; stale handles use `InvalidHandleError/invalid-handle`.           |
| Security                | Explicit byte/VFS/sink capabilities, supplied metrics/time/identity and original defaults; no host path inference, font discovery, native runtime, fetched link or activated media/OLE. Public XML/part views are bounded owner-aware interfaces, not arbitrary XPath or method evaluation. |
| CLI                     | Plural `images`, `tables`, `properties`; preserving `text replace` is distinct from destructive text assignment. One-based owner-scoped selectors, explicit cardinality, common flags, version-1 result, schema/capabilities, ordinary exits 0/1/2/3/4/130 and diff exits 0/1/2/130.        |

The updated [package draft](package-usage.md) removes stale byte-foundation-only
claims. It now identifies the exported presentation factory and command engine,
dependencies and discovery commands, while keeping raw transport limitations local
to `pptx/bytes`. This is a bounded current-surface correction, not a blanket
promotion of historical research rows. Exact untested API obligations stay open.

## Corpus execution

The [agent procedure](../plans/pptx-documentation-evidence-20260913.md) records
selection and execution. The [corpus receipt](targeted-corpus-evidence-20260913.json)
records exact operations, limits, source/output SHA-256, repeat hashes, independently
reopened part hashes and relationship checks. All binary inputs/outputs remain
owned disposable cache files, outside commits and package distribution.

| Selected family                 | Executed targeted operation                                                | Independent outcome                                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F16/F39 chart-deck preservation | Replace one slide-text match                                               | 214 untouched parts; all chart/workbook/media hashes and relationship tuples retained; 39 slides. This is preservation evidence, not chart-data editing coverage.                                                                                                                                                                          |
| F48 notes                       | Replace one original speaker-text match on the second multi-master deck    | Only notesSlide4.xml changed; 178 untouched parts, 36 slides, both registered masters and shared images retained.                                                                                                                                                                                                                          |
| F08 multi-master merge          | Append source positions 2 and 3 from an independently owned identical deck | 38 slides, three registered masters, two active masters; 176 original parts unchanged, 14 added; only content types and presentation registration changed among existing parts. Shape and relationship remappings resolve to the same inert targets. Existing notes are preserved; imported competing-notes-master support is not claimed. |
| F42 media preservation          | Set the large-media deck's title                                           | Only core properties changed; 43 untouched parts including the 453,608,531-byte video. Repeat output hashes match. No playback or media replacement coverage is inferred.                                                                                                                                                                  |

All four successful operations were repeated with identical inputs/options and
identical output SHA-256. Reopened outputs have valid CRCs and namespace-aware XML,
no missing internal relationship targets, and preserved shared-image target fan-in
for unrelated edits. Exact input/output/part hashes are in the JSON receipt.

Structural checks do not certify rendering, fonts, animation playback or visual
fidelity. No native renderer or product network was used. The large-media profile
is explicitly raised and does not establish default-size admission support.

## Open regression obligations

Original regression designs and responsible implementation obligations are retained
in the [agent plan](../plans/pptx-documentation-evidence-20260913.md#original-regression-handoffs).
The notes-field distinction, identical-notes-master import, opaque dependency
boundary and small-limit media preservation remain open. No defect is closed and
no new unit-test implementation is claimed by this documentation task.

The labeled-deck rejection is consistent with the documented security boundary;
no label stripping or bypass was attempted. Existing security-admission tests
supply bounded label admission coverage. Census findings and current unsupported
merges do not become new passing regression evidence. Nothing above closes a defect.

## Verification

The maintained Vitest route passed 185 tests in eight focused files: presentation
model/public exports, text replacement and its command, merge/split, properties,
command discovery and security admission. These original tests use no downloaded
corpus dependency. JSON joins and owned-document formatting are checked separately.
No repository-wide pipeline, push or release ran.
