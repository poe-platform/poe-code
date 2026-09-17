# Current PDF serialization validation

Executed the explicit procedure in docs/plans/pandoc-pdf-serialization-qa.md
on 2026-09-16. The requested TypeScript serializer and SDK/command wiring already
exist; the new code change rejects malformed identity counts before enumeration.
Original failing regression and maintained red/green logs accompany that fix.

Independent pins: pypdf 6.0.0 strict parser, PyMuPDF 1.26.4 / MuPDF 1.26.7.
Installed only into a disposable QA virtual environment, subsequently removed.
Runtime and unit tests do not invoke these tools or create host scratch files.

Reused original serialization-input-ast.json, serialization-reader-inputs.json
and adjacent original PNG/JPEG inputs. Generated EPUB and PPTX inputs with the
SDK writer from the original prose document. Asserted exact reader registry
membership: commonmark, csv, epub, gfm, html, json, latex, pptx, rst, rtf, tsv.
Both parsers independently extracted Owned PDF text from all eleven conversions;
all have one page and MuPDF reports no repairs. Pair hashes and extracted text
are in serialization-current-oracle-results.json. Temporary pair PDFs removed.

serialization-current.pdf was published through awaited SDK sink writes/close,
with page geometry supplied through SDK options. Independent checks traverse all
xref objects, resolve page-tree Kids/Parent identities and counts, inspect four
300×400 point pages, exact non-ASCII title/author, absent clock metadata, two
page-resolving outlines, and the exact escaped URI annotation. Type0 Identity-H
fonts have Identity CIDToGIDMap, ToUnicode streams and FontFile2 bytes matching
the supplied font SHA-256. Images include DeviceRGB, DeviceGray and DeviceCMYK;
PNG alpha uses a DeviceGray soft mask and CMYK has inverted Decode entries.
Both engines extract the original Latin/Greek/Cyrillic body phrase. No MuPDF
repair or warning reported. Detailed observations and hashes are recorded in
serialization-current-oracle-results.json.

Viewed serialization-current-page-1.png through serialization-current-page-4.png
at 2× resolution. Readable headings, body and link; aligned table cells/rules;
gray, blue and orange image colors and PNG transparency; consistent margins and
wrapping, without clipping or overlap. The RGB filename and its image occupy
separate pages, as in historical QA; no caption keep-with-next claim is made.

Maintained PDF tests (49), Pandoc tests (1,063), both package lint/typechecks and
selected Pandoc build closure pass. Logs are adjacent. This focused serializer
change does not modify shared infrastructure; no fresh repository-wide test
or lint result is claimed. Historical global unit limitation is not a current
pass or a newly reproduced failure.

Output remains untagged. No PDF/A, PDF/UA, universal searchability, correct
extraction or reading-order guarantee. Inspected fixtures establish only the
recorded results; native Pandoc was not used as an oracle and different engines
need not produce identical bytes. Local commits only; no push or release.
