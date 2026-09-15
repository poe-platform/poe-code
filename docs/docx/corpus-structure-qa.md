# Downloaded DOCX structure qualification

Executed 2026-09-15 against all **23 SHA-256/size-pinned downloaded documents**
in [the disposable corpus manifest](corpus-manifest.json). Source/landing URLs,
publishers, retrieval dates, licensing restrictions, asset exclusions and the
independent acquisition census remain in that manifest. No downloaded text,
branding, images or binary fixtures were added to canonical tests or shipped.
The [agent-executed plan](../plans/docx-corpus-structure-qa.md) and
[compact per-action receipt](corpus-structure-qa.json) retain profiles, hashes,
exact actions, independent checks and rejection errors. Historical acquisition
reports' “product QA not run” statements describe their earlier dated snapshots;
this campaign supplies execution evidence only for the subset below.

| Profile | Files/runs | Admission | Inspect/text | Unchanged round trip | Real title edit |
| --- | ---: | --- | --- | --- | --- |
| Default | 23 | 10 pass, 13 reject | 9 pass, 14 reject each | 10 pass, 13 unrun | 9 pass, 1 reject, 13 unrun |
| Large (2 GiB work) | 2 | 2 pass | 2 pass each | 2 pass | 1 pass, 1 reject |
| Large (8 GiB work) | 1 rerun | admitted by passing inspect | 1 pass each | 1 pass | 1 pass |

**Zero unexpected failures.** Reject means explicit `limit-exceeded` or
`invalid-package`, not editing success. Unrun means package admission refused,
so no edit or serialization was attempted. Default admission was independently
attempted even where inspect/text refused; successful reads are not inferred
from the reader alone. Every admitted file received round-trip and edit attempts.

The two qualifying large/dense downloaded cases are:

- `housing-supply-interim`: 6,360,759 compressed bytes; 9,201,080 expanded bytes
  in the acquisition census; >2,000 paragraphs, 96 tables and 24 section-property
  nodes. All four public utility actions pass under the 2 GiB work profile.
- `circular-economy`: 8,320,866 compressed bytes; 13,664,151 expanded bytes;
  2,655 inspected paragraphs, 56 tables, 920 cells, 30 sections, 108 inventoried
  fields, 41 controls and 99 drawing occurrences. Inspect, text and unchanged
  serialization pass at 2 GiB work; the edit rejects there. The separately named
  8 GiB work profile passes inspect, text, serialization and edit. Both outcomes
  remain recorded. These work capacities are conservative ledger ceilings, not
  measured RSS, and do not change defaults or establish general large support.

## Preservation and selected edit

Every successful unchanged round trip retains every uncompressed member byte,
including XML, media and opaque parts. ZIP serialization may change compressed
package hashes; whole-file equality is not required. Every successful real edit
sets the measured owned core title to original QA wording, “Structure
qualification”. Only `docProps/core.xml` changes. The member set, all other
member bytes/hashes and every non-title core subtree, attributes and whitespace
remain equal. Final title values are checked independently, not only through a
successful product result. Receipt hashes cover both package outputs and the
sorted untouched-part manifest. All 23 source sizes/hashes were rechecked after
the campaign, including rejected operations.

Independent Python standard-library ZIP CRC, XML parsing, content-type and
internal relationship assertions validate final packages without the product
reader/editor. No external relationship is followed, field instruction executed,
object activated or document body treated as instructions. These checks establish
bounded structural/package preservation, not full schema validity or rendered
fidelity. Renderer/page screenshots and repair-warning checks remain **unrun**.
No visual CLI behavior changed in this task.

Metadata edits exercise preservation of measured tables, fields, notes, sections,
controls, equations and image payloads in admitted sources. They do not qualify
semantic table/field/note/image edits or whole-model behavior. Acquisition census
counts include auxiliary/fallback content; utility counts follow their supported
scope. Cached pages remain metadata, not rendered measurements. Missing Strict,
substantive endnotes and other acquisition gaps remain separately pending in
[the existing gap record](corpus-feature-gaps.md).

## Findings reduced to original regressions

[The original memfs regressions](../../packages/docx/src/corpus-structure-regression.test.ts)
retain four small deterministic invariants:

1. Work refusal leaves source/destination bytes unchanged and publishes nothing.
2. Mixed split-run text, a table, cached field and section round-trip exactly;
   a real core-title edit retains every unrelated part and metadata byte.
3. Bracketed auxiliary part paths reject before metadata output. The downloaded
   template's bracketed auxiliary paths explain its concrete package refusal;
   the regression authors a different path and two original bytes.
4. Admission can succeed while a later inspection exceeds the same work ceiling.
   The image-heavy easy-read file exhibits this distinction: default admission
   and round trip pass, while inspect/text/edit reject on work capacity.

All four tests pass against current code without product changes. No product fix
was authorized, so no failing test was followed by implementation and no synthetic
red run was created. Any future fix still requires a failing regression first.
The full downloaded reports are not permanent tests. Tests use original wording,
XML and memfs, with no network or copied binary/text/image fixtures.

## Shared contracts and remaining scope

Executed `schema properties set`, `schema text replace` and `capabilities`
discovery return exit 0 with the version-1 JSON envelope. Corpus SDK actions use
`inspect`, `text.get`, `properties.set`, explicit async byte admission/sinks,
owned `Uint8Array`, limits and cancellation. The exact language/security/drift
record is in the plan: plural resources, camelCase operation options versus
neutral snake_case live model members, common selectors/envelopes/statuses,
UTC date precision, enum/helper/collection/inherited obligations and bounded
XML/package views remain governed by the shared contracts. Public underscore
names and APIs absent from reference tests are not excluded. No historical
inventory row or unsupported live owner is promoted by this utility campaign.

Maintained DOCX tests and lint, final regression checks and cleanup settlement
are recorded in the receipt and plan. Existing unrelated source/doc changes were
preserved; the receipt identifies the local source-tree state rather than claiming
qualification of a clean released revision. No README or product source changes,
push or release belong to this task. Later tasks remain pending.
