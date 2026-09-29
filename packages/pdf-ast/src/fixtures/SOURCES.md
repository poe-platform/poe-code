# qpdf regression fixtures

Unmodified files from https://github.com/qpdf/qpdf, revision
`4eba95899886e851cc41d76886483b347612f2a8`, directory `qpdf/qtest/qpdf/`:

| Local file | Upstream file | SHA-256 |
| --- | --- | --- |
| qpdf-shared-images.pdf | shared-images.pdf | 0626ae028f41391b85b6d2e938e5409d28c99c88a597c1daf50fed40377a9edb |
| qpdf-form-xobjects-no-resources.pdf | form-xobjects-no-resources.pdf | b82d2a47971d4ef38291be643571c1dd44038db0829ee475069959e975f24df1 |

Copyright (c) 2005-2021 Jay Berkenbilt, 2022-2026 Jay Berkenbilt and Manfred Holger.
Licensed under Apache-2.0. The license text is in
`../../licenses/PDFJS-APACHE-2.0.txt`.

The shared-page selection case follows `qpdf/qtest/merge-and-split.test`.
The redaction case extends the fixture to ensure an unused shared resource
cannot preserve a removed image. PyMuPDF independently reports six image
placements in the nested-Form fixture; Poppler renders identical pixels before
and after resource cleanup.


# Image codec fixtures

`pdfjs-jbig2-symbol-offset.pdf` and `pdfjs-jp2-resetprob.pdf` are unmodified
`test/pdfs/jbig2_symbol_offset.pdf` and `test/pdfs/jp2k-resetprob.pdf` from
Mozilla PDF.js tag `v4.1.392`. They exercise JBIG2 symbol offsets and JPEG 2000
arithmetic probability resets. Source: https://github.com/mozilla/pdf.js/tree/v4.1.392/test/pdfs
Mozilla Foundation, Apache-2.0; see `../../licenses/PDFJS-APACHE-2.0.txt`.
Expected RGBA hashes in `../extract/pdfjs-codecs.test.ts` and
`../extract/image-extraction-codecs.test.ts` were independently
obtained with PyMuPDF 1.28.2; no PyMuPDF source or tests are included.

The other fixtures were created for this repository (MIT) with Pillow 12.3.0,
OpenJPEG through Pillow, libtiff through Pillow, and jbig2enc 0.32:

- RGB: an 8x6 image, pixel `(x,y) = (31*x,47*y,19*(x+y))`, losslessly saved
  as JP2 and raw J2K with two resolution levels. The tiled JP2 uses one
  resolution level and 4x3 tiles. Gray is Pillow's RGB-to-L conversion.
- `jbig2-source.png`: 64x32 bi-level source, white background; black inclusive
  rectangles `(4,3,21,13)` and `(40,16,60,29)` and Pillow default text `PDF`
  at `(24,1)`. The PNG preserves exact source pixels independently of fonts.
- `jbig2-generic.jb2`: `jbig2 jbig2-source.png` output. The stream uses `-p`.
- Symbol fixture pair: `jbig2 -s -p -b jbig2-symbols jbig2-source.png`.
  This mode is lossy, so its expected hash is the independent PyMuPDF decode,
  not the original source hash.
- MMR stream: libtiff Group 4 strips of the source with TIFF pixel polarity
  normalized to JBIG2; wrapped in a page-information segment (64x32), an
  immediate generic region with the MMR flag, and an end-page segment.

| File | SHA-256 |
| --- | --- |
| rgb-lossless.jp2 | 8007ed51b33d34850f1b75033d7810e0889b85258c32ece0962a331cb59f881c |
| rgb-lossless.j2k | 7b5ed2d0b120684e11c5667c355ba06214229cc13a32daca88747c2792d8e9a7 |
| rgb-tiled.jp2 | 09717244041f758f671fbdceebc9d1f6246f1ea53b92ad22c468b1a5b37eb1f8 |
| gray-lossless.jp2 | 5c609a301dc32df2dfef10fe73f074bf36ee0b25e87baf60a5d8aa4baa8485bb |
| jbig2-source.png | 986e8ee53675e9297b5f97459712dc1a85235dd3d4a7c137c4fad63901741d05 |
| jbig2-generic.jb2 | be33156b1fce7034cfa4ac9db0b5bc12600d4b2179e4f3fa8a973af03dc0e402 |
| jbig2-generic-stream.bin | 048e906fd209816b4484e7c1d22a60d92045ac7183b77efe835b38f1e4770ba5 |
| jbig2-mmr-stream.bin | 63eb03f835aa33c0c560935ccc68eaac9be5b2c84f07cb614ad7f7b5937799ae |
| jbig2-symbols.0000 | 156d05fb5e2cfaf934da61ad3828c0daa91cae0d06c83ad9947b3ced607d713a |
| jbig2-symbols.sym | c5a44d1bfee9701803a9b3dfeb8cd2a9d2c4ca474c7da4c99ffb55a7d587d1d4 |
| pdfjs-jbig2-symbol-offset.pdf | 305b71c67829ef0bb8bddab9fa3ee763dcecd173f5fd996740d17212888fa97d |
| pdfjs-jp2-resetprob.pdf | 582da92f1cad4fa47639e5df5c29ebba6e4ae432ba5e9283297ee6e5e88d7efa |
