# SVG and image fallback evidence

Task 72 preparation starts on local main
fdd9c9ecc96abe8349419275255701b6d11b9886 after verified task 71. The index is
empty; unrelated edits remain preserved. This document records research and
observations; docs/specs/docx.md is the sole format contract. Procedures and
ownership belong in ../plans/docx-svg-and-image-fallbacks.md.

## Current code and original probes

Insertion rejects any supplied fallback before selection or media acquisition,
then supports only inline PNG/JPEG. Replacement rejects fallback and native SVG
carriers before opening replacement bytes. Inventory already preserves/extracts
one direct SVG extension associated with a raster base and retains inactive MCE
branches as evidence. Generic XML admission rejects DTD/entities but does not
alone reject script elements or stylesheet processing instructions.

Read-only original memfs probes are retained in
/tmp/docx72-domain-current-probes-esm.log; an initial CJS runner admission failure
is separate. Five existing relevant tests passed in
/tmp/docx72-domain-existing-profile.log. They qualify existing behavior only.
Schema/adapter probes also reproduce unsupported SVG/fallback insertion and
replacement. The insertion adapter currently permits unbounded readFile media
acquisition and treats every VFS path '-' as stdin; task 72 needs original reds
for bounded stream admission and explicit CLI stdin reservation versus literal
JSON/SDK VFS paths. No product fix follows from preparation alone.

## Primary extension schema evidence

Pinned MS-ODRAWXML revision 34.0, v20260217, February 17, 2026 matches
docs/docx/standards-sources.json. Exact retained primary PDF:
/tmp/docx-standards-20260913/MS-ODRAWXML.pdf, 10150622 bytes, SHA256
b2ff9f11c5251acdaa4de103575932820433fb9d1bc67586323106c0bdf3a0fb.
Its extracted text is a bounded regular file at the corresponding .txt path,
1211718 bytes, SHA256
d4e25e75277960c5c901be7cf09bb6f7e7db2f3bedfd1d34196cf66325cbd7d9.

Sections 2.26.1.1 and 2.26.3.1 identify svgBlip and CT_SVGBlip; section 5.24
declares the SVG extension namespace and imports Transitional DrawingML and
officeDocument relationships through a:AG_Blob. Those SVG embed/link attribute
namespaces are independent of the surrounding owner dialect. An original Strict
memfs probe publishes this native form successfully; no core dialect/validation
guard change is justified. Current image inventory instead uses the Strict
owner's relationship-attribute namespace and loses the admitted alternate.
Concrete evidence: /tmp/docx72-domain-strict-extension-probe-v2.log. Its initial
inline syntax error is retained separately and is not a product failure.

The pinned primary text does not specify extension URI
{96DAC541-7B7A-43D3-8B79-37D633B846F1}; no XSD requirement is inferred from it.
Its section 1.3.3 describes Office writer PNG rasterization for fallback; this
utility instead requires supplied bytes and deliberately admits five bounded
raster formats. It does not claim to reproduce that writer's generation behavior.
Two authenticated corpus exemplars provide empirical writer-profile evidence:

| Research input | Source SHA256 | Direct SVG extension elements |
| --- | --- | ---: |
| circular-economy | 485a9dcb2ff3b679d4a83f48690f86159bf015efef763a12c604993c486c154a | 54 |
| ministry-for-the-environment-annual-report-2024-2025 | 38ada5fb0c2292569f77b33147934075e6e63e3c0a09d537597dc18d921331ec | 1 |

Each observed parent drawing extension uses that URI and each svgBlip uses
Transitional relationship attributes. This is stored markup evidence, not
visible-occurrence count, renderer parity or normative URI proof. The broader
census observed 278 matches across seven source documents before refusing a
40415536-byte XML part at its 32 MiB cap. Preserve that incomplete census at
/tmp/docx72-domain-corpus-svg-uri-census.log; do not claim all 23 inputs were
completely scanned. No source artwork, code or binary asset was extracted into
product fixtures. Corpus identities and publisher restrictions remain research.

## Sole-contract reconciliation

Root proposed a bounded static SVG insertion profile with five validated raster
fallback formats, fallback-based physical sizing, inline-only insertion, exact
two-resource association and unchanged alternate replacement refusal. Static
vocabularies, complete local-reference/color grammar, unique resolved IDs,
explicit acyclic containment/reference graph and executable/external-content
rejection are utility policy choices. Standard XML escapes remain permitted.
The new writer URI is an explicit observed profile; existing inert inventory
URI spellings remain accepted and preserved. Native extension attribute namespaces
do not relax core mixed-dialect guards or activate MCE Choices.

Checker passed with zero warnings. Independent semantic wording review approved
the sole contract at SHA256
9e58ed775e9cdb76c1302fb79cd01b5a8a637caedb8698c8898f0c557f4965b2.
The reviewer independently authenticated the pinned primary evidence and the
107370-byte empirical receipt at SHA256
d2faaf214772f377981d9f4e12f84b151505c1e737483698592c4ed6fca2ad1f,
covering exactly 54 plus one native extensions in the two selected exemplars.
This approves wording only. Original failing tests, implementation, maintained
gates and product QA remain pending. API/test
inventories retain all case identities and live model/inherited/collection/enum
obligations; acquisition and these probes do not promote them. No README edit,
native product dependency or implicit network has been introduced. Root will
commit this documentation reconciliation before authorizing product edits; no
push or release is authorized.
