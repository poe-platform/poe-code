# PPTX QA Corpus Report

Status: Acquired and structurally inspected; product not implemented.

Downloaded 12 decks totaling 557.94 MiB, with 337 stored media parts. These are disposable QA fixtures only. No product create/read/edit test, schema validation, rendering or playback has run.

The later [reverification](corpus-reverification.md) confirms cached hashes, adds
per-part measurements and separates metadata indicators from actual comment/CJK
content. No product result follows from these checks.

See [the manifest](corpus-manifest.json) for exact URLs, dates, SHA-256 hashes, media-part hashes, namespaces, limits and retention. Source binaries are in the ignored `.cache/pptx-corpus`.

| File                                        |    MiB | Slides | Masters | Tables | Media parts | Groups | Timing nodes |
| ------------------------------------------- | -----: | -----: | ------: | -----: | ----------: | -----: | -----------: |
| IXPE-Presentation-Template.pptx             |   1.15 |      5 |       1 |      0 |           2 |      0 |            0 |
| CERN-intro-2025-v2.pptx                     |  26.71 |     32 |       1 |      1 |          38 |      3 |           63 |
| CERN-job-opp-250925.pptx                    |   0.04 |      4 |       1 |      0 |           1 |      0 |            0 |
| ISOLDE-drawings.pptx                        |   4.03 |      8 |       1 |      0 |          12 |      0 |            5 |
| SEWP_Training_Slides_May 2026.pptx          |   7.76 |     18 |       2 |      2 |          48 |      5 |            0 |
| SEWP_Provider_Training_Slides_05_12_25.pptx |   6.51 |     19 |       1 |      1 |          33 |      4 |            0 |
| SEWP_CH_Training_Presentation_05_12_25.pptx |  10.00 |     30 |       1 |      4 |          25 |     12 |            0 |
| WWL-template-1slide.pptx                    |   0.20 |      1 |       1 |      0 |           1 |      0 |            0 |
| slides-public-engagement-DEC-2021.pptx      |  33.09 |     28 |       1 |      2 |         122 |    228 |         1397 |
| CluestotheCosmos.pptx                       |  18.13 |      8 |       1 |      0 |           7 |      0 |            0 |
| 20120418_Jedlovec_SuomiNPP.pptx             |  13.98 |     36 |       2 |      6 |          46 |     45 |           61 |
| earth-system-media-large.pptx               | 436.33 |      1 |       1 |      0 |           2 |      0 |           12 |

Counts are namespace-aware across all XML parts, including slides, masters, layouts and notes. A picture occurrence is not necessarily a unique media part; group/timing counts may include alternate-content branches. Slide counts here are slide-part roots, not application-rendered pages.

Every ZIP entry was streamed through CRC verification. XML was parsed with DTD/entity declarations denied, 32 MiB per XML part, depth 256 and five million nodes. Expanded package limit was 1 GiB. This proves bounded ZIP integrity and XML well-formedness only, not OOXML schema validity or semantic reference validity.

The large Earth-system deck has one slide and a large embedded video: media size and slide count stress different things. It is expected to exceed the proposed 256 MiB compressed-input/media defaults. The download used an explicit 512 MiB acquisition ceiling and the census used a 512 MiB member ceiling. No product default rejection or raised-profile success has yet been measured.

## Sources and use limits

- [Link](https://ixpe.msfc.nasa.gov/for_scientists/templates/)
- [CERN-intro-2025-v2.pptx](https://indico.cern.ch/event/1570647/contributions/6713567/)
- [ISOLDE-drawings.pptx](https://isolde.web.cern.ch/isolde-logos-layouts-and-templates)
- [SEWP Training Slides](https://sewp.nasa.gov/documents/training/sewp.shtml)
- [(Download pptx)](https://cce-signin.gsfc.nasa.gov/online_help_docs/WWL_help.html)
- [slides-public-engagement-DEC-2021](https://science.nasa.gov/resource/collection-of-interactive-powerpoint-slides-to-be-used-in-public-engagement/)
- [Download Clues to the Cosmos slide deck (.pptx)](https://nightsky.jpl.nasa.gov/news/339/)
- [SPoRT Applications of Suomi NPP Data](https://weather.ndc.nasa.gov/sport/jpsspg/)
- [Earth: A System of Systems (updated)](https://svs.gsfc.nasa.gov/31139/)

[NASA media guidance](https://www.nasa.gov/nasa-brand-center/images-and-media/) and [CERN media terms](https://copyright.web.cern.ch/) are provenance leads, not blanket clearance for every embedded image, logo or third-party slide. The official interactive-deck page credits NASA/JPL-Caltech. Retain credits in QA sources; do not ship these binaries or copy their assets into canonical tests. Document-specific review is required before distributing derived outputs.

## Remaining coverage gaps

The seeded corpus covers templates, multiple masters, notes, tables, pictures, grouped shapes, connectors, custom geometry, OLE, hyperlinks, transitions, timing trees and embedded video. It does not establish exhaustive format coverage. Chart/SmartArt/modern-comment/Strict/RTL/CJK coverage is absent or unverified; seek actual examples and author small original fixtures where unavailable. There is no hundreds-of-slides real deck in this seed set. Original generated many-slide stress fixtures must be labeled separately.

CDC pages returned HTTP 403 and were not bypassed. A CERN department page returned HTTP 404 to direct retrieval despite appearing in search results; its advertised 118 MB deck is not part of this manifest. These failures are retained in the acquisition notes.

## Lifecycle

Execute QA through the agent Markdown procedure specified by [the pipeline](../plans/pptx-typescript-safe-bash.md). Mutate owned copies, keep downloads immutable, and reduce every meaningful result into an independent small original memfs unit test. Delete only listed source files and enumerated generated outputs after QA and reduction, when no active campaign needs them. Preserve the manifest and concise evidence; unit tests must run after the downloads are deleted.
