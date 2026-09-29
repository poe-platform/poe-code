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

# JPEG qualification fixtures

`pdfjs-cmykjpeg.pdf` is the unmodified Mozilla PDF.js `test/pdfs/cmykjpeg.pdf`
from revision `91041fb94d6744bc2a5bccd9aad28d617faa8195` (Apache-2.0).
The test ports `api_spec.js` issue 4888's 90,000 RGB-sample expectation.
`pdfjs-cmykjpeg.rgb` is the independent MuPDF RGB decode of its image.
PDF.js and MuPDF use different CMYK profiles, so the comparison uses a bounded
mean channel error rather than asserting identical RGB values.

The `jpeg-{RGB,L,CMYK}-{0,1}-0-17.jpg` files are original MIT fixtures made with
Pillow 12.3.0/libjpeg: 17x13 RGB pixels `(11*x,17*y,9*(x+y))`, converted to the
named mode, quality 91, subsampling 0; the second field enables progressive
encoding. `.rgba` files are independently decoded Pillow RGBA bytes.
`jpeg-rgb-direct.jpg` uses the same RGB image and `keep_rgb=True`;
`jpeg-ycbcr-direct.rgba` contains libjpeg's native YCbCr output of the RGB
baseline fixture (`draft("YCbCr", size)`), packed as three channels plus alpha
255, to test PDF `/ColorTransform 0` without deriving the oracle from our decoder.

| File | SHA-256 |
| --- | --- |
| jpeg-CMYK-0-0-17.jpg | 48fce7b4d5696cac8fe32841ad7611d6243accc55ca33ccac84385c817960245 |
| jpeg-CMYK-0-0-17.rgba | 0381a7e592ed339b2c9915365982675a816eace3d96c83d69cd3e71bbf9f5d33 |
| jpeg-CMYK-1-0-17.jpg | 559cd8be845379dba644ee6cd0d209c777d1b619fac6ea36fddd648f7a8fb49a |
| jpeg-CMYK-1-0-17.rgba | 0381a7e592ed339b2c9915365982675a816eace3d96c83d69cd3e71bbf9f5d33 |
| jpeg-L-0-0-17.jpg | d678196aba584d6a07f20c2050148f553ecea8639c0e960cc92bdc636424a195 |
| jpeg-L-0-0-17.rgba | 6a979bf661172135d994a0236651b9c80d66bdb580fbb5bbcf4efec0454dc1c5 |
| jpeg-L-1-0-17.jpg | 5318bca3865d1bb5cefd545173d93aa19734c5ab9f9e8c102d1b98949b09cf0b |
| jpeg-L-1-0-17.rgba | 6a979bf661172135d994a0236651b9c80d66bdb580fbb5bbcf4efec0454dc1c5 |
| jpeg-RGB-0-0-17.jpg | 364c3059bcfd64fde00333b17e131817880158141ef1c30a44e2203bb7090177 |
| jpeg-RGB-0-0-17.rgba | bb9c0e78a0bc5efcc91b38178c64abf7e34900f1aac1aece0fb9aa79c1a50c2c |
| jpeg-RGB-1-0-17.jpg | 9320779c756a3db133d8f083509d0be275e6602b9288d230b9b88750a128edd0 |
| jpeg-RGB-1-0-17.rgba | bb9c0e78a0bc5efcc91b38178c64abf7e34900f1aac1aece0fb9aa79c1a50c2c |
| jpeg-rgb-direct.jpg | 7663d8c5399f153ed631f8ebd6de254e0d4ec5f0e27349ffa3d07a0139a68fdd |
| jpeg-rgb-direct.rgba | 0381a7e592ed339b2c9915365982675a816eace3d96c83d69cd3e71bbf9f5d33 |
| jpeg-ycbcr-direct.rgba | a843d72d532c0b1cf02650918bcd28caf28c18193462f3cf06fbcc6bfa1430b0 |
| pdfjs-cmykjpeg.pdf | 659d6b19912f63db988b0b26b9bde0e6d8100667ef162051a4a84ea8e5b90272 |
| pdfjs-cmykjpeg.rgb | 9fe691d42ce6eb4fd1bacbe6145392ce53daa73eed44f86be04e50901eb6740c |

# Embedded CFF font regressions

The following files are unmodified Mozilla PDF.js `test/pdfs` fixtures at revision
`91041fb94d6744bc2a5bccd9aad28d617faa8195` (Apache-2.0):
`cid_cff.pdf`, `cff_bluescale_small_zones.pdf`, and `text_clip_cff_cid.pdf`,
prefixed locally with `pdfjs-`. They exercise CID CFF programs, FD dictionaries,
fonts without usable ToUnicode mappings, and glyph clipping. The CFF tests
validate font decoding/geometry; text clipping is qualified separately (#4134).

| File | SHA-256 |
| --- | --- |
| pdfjs-cid_cff.pdf | d894d356411217414fd9040d3d038612e1f4a1598936b2385a76458dd6d64d38 |
| pdfjs-cff_bluescale_small_zones.pdf | 82eb3d45411342f622e5a785280821abdadefaade3a3789f2906bda2b22a5d8f |
| pdfjs-text_clip_cff_cid.pdf | 81aaf48f55c659d29d7a533cd913bd9d028ffad183b46580a2122eebe5187506 |

# FlateDecode recovery streams

`pdfjs-flate-*.bin` contains the original compressed bytes extracted with pypdf
from the indicated PDF.js `test/pdfs` file and indirect object, at revision
`91041fb94d6744bc2a5bccd9aad28d617faa8195` (Apache-2.0). No font or stream bytes
were repaired. Expected decoded lengths and SHA-256 values in the test were
computed independently using that checkout's `FlateStream`, not pdf-ast.
`issue11651.pdf` objects 8/10 exercise bad checksums and invalid backreferences;
`issue3885.pdf` object 12 is truncated; `bug1050040.pdf` object 2 has a bad checksum.

| File | Compressed SHA-256 |
| --- | --- |
| pdfjs-flate-issue11651.pdf-8.bin | f6d5affeefe60debabb9c08b127fb6b2639a8a3b3c613097895826146e2de36c |
| pdfjs-flate-issue11651.pdf-10.bin | c62db31061a61e6b273989413e2b1a932f527e5d38a5e66cbee7d75e7a16da80 |
| pdfjs-flate-issue3885.pdf-12.bin | 90a50754c0c2216bf3a2b2d3e69691cdd777203b5611e35fc6a9da701da40382 |
| pdfjs-flate-bug1050040.pdf-2.bin | 8720aad581e3839f8edee2fe970d377a24081898114b85e1c9849f3bf78bccc0 |

## PDF.js standard security fixtures

Pinned upstream revision: `91041fb94d6744bc2a5bccd9aad28d617faa8195`.
The following unchanged files come from `test/pdfs/` (Mozilla Foundation,
Apache-2.0). Each also passed the upstream test manifest MD5 check during the
corpus audit.

| Local file | Upstream file | SHA-256 |
| --- | --- | --- |
| `pdfjs-empty_protected.pdf` | `empty_protected.pdf` | `69556af04215faec7da3e93e823c64f1b74679e52fd10379176f0e0462dd4b6c` |
| `pdfjs-issue6010_1.pdf` | `issue6010_1.pdf` | `d7fd95e016b7d43bc9eed1041b0cdd6ee00e3dd902e50d0307b0a428782c543c` |
| `pdfjs-issue6010_2.pdf` | `issue6010_2.pdf` | `53008dd89a45e313112ad6c6f17ade3e5c8f33f3106028a4e5b61f570b270ce9` |
| `pdfjs-saslprep-r6.pdf` | `saslprep-r6.pdf` | `e570bea23d5e1b8a796ffc3701920f04fc114543b4b25e8f03bd913ca47f1da9` |
| `pdfjs-issue19484_1.pdf` | `issue19484_1.pdf` | `0f020604762fe289eaed602bfb5f4e3d921fb04ffc0fd61ec5423933a03f1948` |
| `pdfjs-issue19484_2.pdf` | `issue19484_2.pdf` | `247215f0ca711ec552289c3076cc7ee38f117c3e0d9c83bfc136ff99f2627216` |

`pdfjs-security-vectors.json` adapts nine dictionaries and two file identifiers
from `test/unit/crypto_spec.js` at that revision. Binary strings are represented
as hexadecimal, names as `{name: ...}`, and numbers are unchanged. The 23
authentication cases in `cos/pdfjs-security.test.ts` are ported from that suite.
The remaining tests exercise the local COS/parser integration.

`pypdf-r5-saslprep.pdf` was generated with pypdf 6.19.0 `PdfWriter.encrypt`
using `algorithm="AES-256-R5"`, user password `SªSL\u00adprep`, and owner password
`owner`. Its one-page text/rectangle source was generated with ReportLab. It
reproduces pypdf's R5 SASLprep password encoding, which PDF.js's raw R5 candidate
alone does not authenticate. SHA-256: `3947c5fe9ef65513fc507f1f9aeab885e6972693f0bf8fbdbbfac8a7afb376d4`.

`pdfjs-bug1782186.pdf` is the unchanged `test/pdfs/bug1782186.pdf` from the
same pinned PDF.js revision (Apache-2.0). Its password is `Hello`; unused empty
indirect objects exercise eager COS recovery. SHA-256:
`4c021f37d739c8231cecab5ddd1a93db692f7ba81026315ae1ca39b9b710e86e`.

`pdfjs-issue15893_reduced.pdf` is unchanged from `test/pdfs/issue15893_reduced.pdf`
at the same PDF.js revision (Apache-2.0). Its password is `test`. The plaintext
revision followed by an encrypted revision and broken xref offsets exercises
trailer discovery before decryption. SHA-256:
`3c2815853e6fe5c34feb76bb14402cbc46bbd484ecd57b672fc03577d0458ee8`.
