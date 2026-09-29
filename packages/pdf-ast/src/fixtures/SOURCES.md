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
