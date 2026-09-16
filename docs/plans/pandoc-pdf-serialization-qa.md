# PDF serialization explicit QA lane

Execute manually as an agent; no QA script or unit dependency on these tools.
Evidence belongs in docs/pandoc. Generated inputs are original, not downloaded
fixtures. Only the QA lane may use host files and independent external tools.
Runtime serialization and unit tests never use them.

## Oracle pins

- pypdf 6.0.0: strict independent object parser, page tree, metadata, outlines,
  annotations, font descriptors/embedded bytes, text extraction, xref identities.
- PyMuPDF 1.26.4: independent MuPDF parser/renderer and text/link inspection;
  record its bundled MuPDF version in evidence.
- Pillow 12.0.0: generate original RGBA PNG, gray/RGB/Adobe CMYK JPEG inputs.
- Specification: Adobe PDF Reference 1.7, sixth edition, November 2006; existing
  docs/pandoc/pdf-reference-pin.md identifies its hash.

## Procedure

1. Build maintained @poe-code/pandoc workspace closure. Create a disposable QA
   virtual environment in repository out (filesystem root /out is read-only on
   this host); install the exact oracle versions above, never into unit tests.
2. Generate a 4×4 alternating two-color RGBA PNG and 4×4 solid gray/RGB/CMYK
   JPEG images with Pillow. Keep input dimensions and original pixel values in
   evidence. Create an AST with a Unicode title (including 東京), author Zoë,
   Greek/Cyrillic/LATIN body text, parentheses and backslash, external URI link,
   headings, a two-cell table and these four images. Repeat readable paragraphs
   to cross at least three 300×400 point pages with 30-point margins. Publish
   using the SDK awaited binary sink to docs/pandoc/serialization-qa.pdf.
3. Generate representable plain prose inputs for commonmark, gfm, html, json,
   latex, rst and rtf; two-column CSV/TSV; an original EPUB using the writer.
   Assert case membership equals available reader registry membership (currently
   ten). Convert each through the SDK to PDF and inspect with both oracles.
   Plain/html5/office readers are unavailable and are not counted as passes.
4. With pypdf strict=True: traverse every xref object; resolve page-tree Kids and
   Parent identities, Count and MediaBox; verify title/author Unicode, no clock
   metadata, flat outline destinations; verify URI annotation strings/rectangles;
   inspect Type0 /Identity-H fonts, descendant /CIDToGIDMap /Identity, embedded
   /FontFile2 and /ToUnicode streams. Compare embedded font bytes to supplied
   bytes. Inspect image /DeviceRGB, /DeviceGray and /DeviceCMYK, /SMask and CMYK
   /Decode. Record extracted text and check original phrases in every reader case.
5. With MuPDF: reject repair warnings; independently verify page count, heading
   bookmarks, URI links and Unicode body extraction. Render all pages at 2×
   resolution. View the PNG screenshots: check margins, wrapping, tables, no
   clipping/overlap, heading/body spacing and image colors/transparency. Check
   grayscale, RGB and CMYK against original solid colors. Record findings.
6. Run maintained PDF/Pandoc tests, lint/typechecks and selected workspace build;
   run repository gates required by root instructions. Inspect task diff and
   preserve unrelated changes. Commit evidence and plan updates with applicable
   verified code; local commits only. Purge disposable QA environment and any
   transient reader PDFs after recording oracle results and hashes.

## Guarantees

These fixtures support Unicode mapping and demonstrate extraction only for the
inspected inputs. They do not establish universal searchable-text or extraction
correctness. Output is untagged; no reading-order, PDF/A or PDF/UA guarantees.
Different PDF engines are not required to produce identical bytes; native Pandoc
alone cannot validate this engine.

Status: executed successfully with the final engine; both independent parsers,
all ten reader pairs, all four rendered screenshot inspections pass. Detailed
results and original inputs are under docs/pandoc. Repository-wide lint passes;
full unit run was stopped after an unrelated missing toolcraft-design markdown
fixture failure. Scoped PDF/Pandoc gates pass; global unit validation is incomplete.
