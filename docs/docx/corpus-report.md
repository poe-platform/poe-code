# Disposable DOCX QA fixtures

Acquired 19 DOCX files from 4 public-sector publishers: 142,217,570 bytes (135.63 MiB). The files contain 655 embedded media parts in total. No generated documents are counted as downloads.

**These files are temporary QA fixtures only.** They are stored in `.cache/docx-corpus`, excluded by that directory’s `.gitignore`, and currently read-only. They may be deleted after QA. Meaningful findings must become small original memfs unit tests that work without these downloads. Keep the manifest, checksums and concise findings after deleting the binary files.

The product does not exist yet. Acquisition, ZIP CRC checks and bounded XML inspection are complete; product read/create/edit tests, full OOXML semantic/schema validation and visual rendering have **not** run.

## What is available

| Fixture ID | MiB | Paragraphs | Tables | Media files | Floating drawings | Charts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `circular-economy` | 7.94 | 2,657 | 56 | 43 | 9 | 0 |
| `housing-supply-interim` | 6.07 | 2,217 | 96 | 26 | 8 | 0 |
| `gst-reforms-interim` | 5.73 | 1,877 | 43 | 51 | 6 | 0 |
| `gst-reforms-interim-appendixb` | 0.10 | 228 | 6 | 0 | 0 | 0 |
| `gst-reforms-interim-appendixc` | 0.18 | 1,061 | 41 | 0 | 0 | 0 |
| `gst-reforms-interim-appendixd` | 0.26 | 312 | 4 | 9 | 0 | 0 |
| `gst-reforms-interim-appendixe` | 0.15 | 212 | 4 | 6 | 3 | 0 |
| `gst-reforms-interim-sp1` | 0.25 | 231 | 3 | 10 | 0 | 0 |
| `ministry-for-the-environment-annual-report-2024-2025` | 9.75 | 6,334 | 133 | 42 | 7 | 0 |
| `our-atmosphere-and-climate-2023` | 5.17 | 907 | 3 | 19 | 2 | 0 |
| `scotland-annual-progress-report-2026-template-v1` | 0.15 | 1,406 | 57 | 0 | 0 | 0 |
| `our-future-rm-system-developing-the-npf` | 20.15 | 709 | 26 | 5 | 4 | 0 |
| `new-zealands-second-emissions-reduction-plan-discussion-document` | 12.95 | 2,225 | 68 | 45 | 20 | 0 |
| `national-climate-change-risk-assessment-main-report` | 6.94 | 3,227 | 40 | 15 | 5 | 0 |
| `mental-health-review` | 8.86 | 5,432 | 138 | 62 | 11 | 0 |
| `nz-ghg-inventory-2025-vol-1` | 19.59 | 15,172 | 208 | 86 | 5 | 0 |
| `nz-ghg-inventory-2025-vol-2` | 7.58 | 46,916 | 189 | 41 | 4 | 9 |
| `wales-race-equality-response-images` | 19.62 | 586 | 48 | 71 | 6 | 0 |
| `wales-citizen-voice-easy-read` | 4.21 | 400 | 0 | 124 | 29 | 0 |

Counts include all XML stories/auxiliary parts. Media files are stored resources, not unique visible images. The manifest also records media hashes, format extensions, unique media payload count, languages, XML namespaces, fields, notes, sections, cells and content controls. Cached page metadata is retained but is not a rendered page count.

## Particularly useful cases

- **Greenhouse Gas Inventory Volume 2:** 46,916 paragraphs, 189 tables, 44,985 cells, 9 chart parts and 698 vertical-merge markers. Its main XML part is 40,415,536 bytes (38.54 MiB). The default inspection profile rejected it at the 32 MiB XML limit. A separate explicit 128 MiB XML/512 MiB expanded/5-million-node profile inspected it successfully; this is a useful future default-rejection and large-profile success case.
- **Greenhouse Gas Inventory Volume 1:** 15,172 paragraphs, 208 tables, 86 media parts, 45 OMML expressions and 5 embedded objects. Useful for references, tables, equations, notes and long-document changes.
- **Citizen Voice Body accessible questions:** 124 media parts, 29 floating drawings and 30 text-box content containers. Useful for graphic fallback, image extraction, text-box reading and floating-image preservation.
- **Race equality response form:** 71 media parts, 48 tables and 29 content controls; 19.62 MiB compressed. Useful for image/form interactions.
- **Illustrated economic/environment reports:** actual SVG, EMF and WDP parts alongside PNG/JPEG. These require preservation/fallback tests; raster-only assumptions would miss them.

## Sources and reuse evidence

- Australian Productivity Commission: [circular economy report](https://www.pc.gov.au/inquiries-and-research/circular-economy/report/), [housing report](https://www.pc.gov.au/inquiries-and-research/housing-supply/interim/), [GST reports and appendices](https://www.pc.gov.au/inquiries-and-research/gst-reforms/interim/), [mental-health agreement review](https://www.pc.gov.au/inquiries-and-research/mental-health-review/report/). [Agency copyright terms](https://www.pc.gov.au/copyright/) apply CC BY 4.0 to agency material with exclusions for logos/coat of arms/third-party content.
- NZ Ministry for the Environment: [annual report](https://environment.govt.nz/publications/ministry-for-the-environment-annual-report-202425/), [inventory source page](https://environment.govt.nz/facts-and-science/climate-change/new-zealands-greenhouse-gas-inventory/previous-greenhouse-gas-inventories/) and additional landing pages recorded per file. [Copyright terms](https://environment.govt.nz/about-this-site/copyright/) distinguish reusable Crown material from excluded imagery/third-party material.
- Welsh Government: [race-equality response form](https://www.gov.wales/node/38053/respond-online) and [Citizen Voice Body questions](https://www.gov.wales/citizen-voice-body-guidance-access-representations-and-nhs-service-change). [Copyright terms](https://www.gov.wales/copyright-statement) refer to the Open Government Licence and exclude logos.
- Defra LAQM: [Scotland annual progress template](https://laqm.defra.gov.uk/air-quality/annual-reporting/annual-progress-report-templates-scotland/). A specific reuse grant was not confirmed; it remains a read-only QA candidate pending review, not a cleared redistribution/mutation fixture.

A download does not clear every image or logo for redistribution. This corpus is not shipped or committed. Retain original text and graphics only in the disposable QA cache; authored small regressions must use original content and media. Per-file permissions and notices still govern any derived output.

## Acquisition and inspection

Downloads used public HTTPS, at most two concurrent transfers, finite redirects/timeouts and a 256 MiB/file cap. Actual total is below 1 GiB. No macros, external relationships or embedded objects were activated. All files have SHA-256 hashes and provenance in [the manifest](corpus-manifest.json). All 19 completed bounded CRC/XML inspection, with the annex requiring the separately recorded larger profile. No whole-file extraction or office application execution was needed.

The inventory source page currently exposes broken CMS shortcodes. The two inventory asset paths were inferred from adjacent official naming, verified on the same publisher host and downloaded; the manifest records this rather than pretending the links worked. A health-publisher candidate returned HTTP 403 and was not bypassed. See [acquisition notes](corpus-acquisition-notes.json).

## Remaining coverage and QA tasks

- No inspected file contains tracked-change or comment nodes. Strict dialect and robust RTL/CJK coverage are not yet demonstrated. Author small original fixtures and optionally find additional disposable public QA examples.
- One downloaded file exceeds 20 MiB compressed; two further files are about 19.6 MiB. None exceeds 100 MiB expanded. Do not claim two files meet the earlier 20-MiB/100-MiB size target; larger regimes need additional real inputs or explicitly labeled original stress fixtures. Structural complexity goals are already represented by the inventory volumes and reports.
- Create/edit/round-trip, cancellation, public SDK/Shell execution and page rendering remain future product QA. All manifest product outcomes are `not_run_product_not_implemented`.

## Reduction and cleanup

For each meaningful finding: record fixture ID/hash and a concise invariant; author a minimal original package reproducing that structure; demonstrate a failing unit test; fix and verify; record the permanent test path. Do not retain report passages or publisher images inside the regression. Tests must work offline with memfs and without `.cache/docx-corpus`.

After QA and reduction, remove only manifest-listed DOCX files and explicitly owned outputs that no active campaign needs. Retain the manifest and small tests. The files are intentionally still available now because implementation and product QA have not started.
