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

## Original implementation regressions

Root committed the approved reconciliation locally as
6247e6bd9fdea03708191dcc4380d2a11f4d3c1c before authorizing disjoint product
work. The original portable browser-bundle public insertion regression failed
at the existing PNG/JPEG-only refusal: one passing and one failing test.
/tmp/docx72-root-public-red.log retains the raw first outcome (6458140 bytes,
SHA256 c1a2502ee3ba087ddfcc250d1e6375d1e5164c77a39034ffd3be2df4890d2a0b).
Its data-URL stack is large; summaries do not reproduce bundled source text.
The original exact literal Shell-registration assertion failed before the new
file existed: 107 passing and one failing test out of 108, specifically the new
svg-fallback.test.ts membership, in /tmp/docx72-root-registration-initial.log.
All prior registration content remains byte-exact after removing that one
literal assertion.

The adapter owner established two failing and two passing original bounded
acquisition tests before source changes, followed by four passing tests after
the focused fix. Paths now require explicit streaming capability and normalize
against command cwd. Only explicit CLI binary-source reservation consumes stdin;
literal SDK/VFS '-' reads the named virtual file. These focused outcomes do not
qualify the new SVG operation. Domain reds separately establish omitted SVG
insertion and lost Strict alternate association. The domain baseline invocation
overlapped test collection changes and is not a clean predecessor pass; preserve
its original outcome alongside the subsequent explicit red receipt.

## Maintained integration checkpoint

The selected maintained build passed five derived dependency stages; portable
safe-fs native targets were empty. The maintained DOCX package command passed
2603 tests across 116 files. Maintained DOCX lint/source/test types passed, and
guarded safe-bash typecheck passed one build and 26 current consumer groups with
expected negative compile results. Type checks are not runtime acceptance.
Final public browser/workerd-bundle tests passed two tests, including actual
SVG/fallback insertion, inventory and extraction with exact original bytes and
fallback-based dimensions. The portable bundle had no external imports. Exact
literal registration passed 108 tests after the original 107/1 red.

Root authenticated the 17 changed product/integration paths and found no
reference identities; manifests and lockfiles are unchanged. Independent source
review approved the final admission, graph, acquisition, dialect and association
behavior without a concrete blocker. Both eight/18-path ownership seals match;
the independent append-aware before-cohort contains exactly 275 actual paths.
Independent runtime checks, corpus outcomes, final guarded lint and verified
local product/status delivery remain pending.

Seven interim authored-fixture CLI screenshots were inspected by root. The
workflow, two stdin variants, replacement refusal, help, schema and F35
capabilities were readable and complete; the existing metadata-null warning was
retained. Their exact output inventory is in
/tmp/docx72-schema-evidence-identity-v1.json. The worker selected that temporary
capture prefix without a prior explicit prefix entry and informed root afterward;
record this limitation rather than infer retroactive ownership. These captures
are not the independently owned future eight-case campaign or rendering parity.

## Independent bounded product outcomes

Independent frozen focused/public checks passed 252 tests across 10 files;
actual current DOCX Shell checks passed 123 tests across 18 derived files.
The real-input campaign used two authenticated manifest documents and fresh
fixed budgets, with separate external 120-second supervision per operation.
Default circular-report inventory refused the work budget; fixed-profile SDK
inventory succeeded. Product-selected active images numbered 92 and nine in the
two inputs. The report's 54 active SVG associations matched the 54 independently
observed native extension elements. Stored WDP resources had no selected active
occurrence: exact preservation is proven, extraction is unqualified.

Both public SDK title edits read back the requested title and changed only
docProps/core.xml. All other members, every media/relationship/alternate byte
and the exact 193/50 member orders remained unchanged. The smaller actual Shell
inventory/extraction/title-edit commands succeeded; its 2070999-byte edited DOCX
was byte-identical to the SDK output and its 39608-byte extracted EMF was exact.
The larger Shell default inventory refused the work limit with exit 4; no
larger-report Shell output parity is claimed. Three selected active extraction
cases succeeded: circular EMF, circular SVG plus fallback and appendix EMF.

An original technical SVG XML probe plus original tiny PNG inserted successfully
into the circular report under the same fixed profile. Exactly two new media
parts, two owner-local image edges and associated content types were added;
only document.xml, its relationships and content types changed. Removing the
new drawing run from the raw document restored the exact original bytes, including
inactive alternates. No rendering or full-format parity claim follows.

Initial QA property-call shape, wrong memory-route screenshot redirection and
reopened stale-generation token attempts are preserved as harness failures;
they did not establish a product issue or authorize source changes. Corrected
public call shapes and memory route succeeded. Eight wrapped/projected screenshot
displays were independently inspected, with raw wide/tall attempts and exact
diagnostics retained; projections remain explicitly distinguished from full raw
schema output. Root independently inspected all eight final displays and found
them readable and complete. Final QA receipt is frozen at 262752 bytes, SHA256
480391e270e1299e46b7445864a4654ca059f46c380569d4b7cc24a11447d0c1.
The exclusive ignored cache contains 86 regular files, no subdirectories and
44815338 bytes; its root identity is dev 16777234 / ino 366709943. The retained
campaign artifacts are a sparse owned output inventory, not a census of other
caches or mounted tools. No cleanup or native mount change was performed.
Product operations and initial Shell/render operations had external 120-second
supervision; display-only wrapped/projection rendering completed without a
separate external per-display timer, as explicitly qualified in the receipt.
The 275-path append-aware after-cohort matches membership/content/hashes.
Final guarded root lint passed 12640/12640 configured inputs, all 25 receipts,
zero gaps/unprocessed descendants and zero blocking errors. Twelve warnings
belong only to the unrelated cached PPTX draft. Supervision from original launch
settled at 478.99 seconds within the total 600-second/64-MiB ceilings. Raw log
SHA256 is 5faa1cb98c02316a440777a03c215e3b08f593cf1908f169aa84aedd351cfb7e.
Historical policies and seals remain unchanged. Local product/status delivery
is the remaining task 72 step; no push or publication is authorized.

The bounded task 72 product implementation is verified locally on main at
f6a117e79229d9c0582dd0c8e292d99a0faf2ea5, an atomic 18-path product/plan commit.
This qualifies the documented utility subset and measured corpus outcomes only;
SVG rendering, WDP extraction, floating insertion, alternate replacement, batch
execution and live drawing models remain unqualified or unsupported as recorded.
The broader sole specification remains Proposed / Implemented Through Not
applicable. Final task 72 implement/test scalars are isolated from the preserved
unrelated task 48–59 working diff for local documentation delivery. No remote
main delivery, release, README edit or cache cleanup occurred.
