# Legacy binary codec source notices

The TypeScript readers and source-derived function/charset tables for Lotus,
Quattro Pro and PlanPerfect follow Gnumeric 1.12.61, distributed under
GPL-2.0-or-later. See the package LICENSE. The source archive identity and
separate native QA profile are recorded in
`docs/ssconvert/legacy-binary-reference-profile.json` in the repository.

- Lotus source authors include Michael Meeks, Stephen Wood, Morten Welinder
  and Jody Goldberg (`plugins/lotus-123/lotus.c`, `lotus-formula.c`, including
  the Works V3 reader, metadata/style tables and RLDB handling).
- Lotus external-variable syntax, op7/op8 fallback semantics and bounded
  STYLE sheet-name records were checked
  against libwps 0.4.14-2 `src/lib/LotusSpreadsheet.cpp`, available under
  LGPL-2.1-or-later (alternatively MPL-2.0); major contributors include Andrew
  Ziem, Marc Maurer and Fridrich Strba. SHA-256:
  `fcfe58ee8430ce43222e76c01aa4f436731722c5b171d801698a9a0a2496a6e5`.
  The implementation uses the shared A1 parser for correct multi-letter columns.
- Windows Works and DOS Symphony reference layouts follow libwps 0.4.14-2
  `src/lib/WKS4.cpp` and `src/lib/WKS4Spreadsheet.cpp`, under LGPL-2.1-or-later
  (alternatively MPL-2.0), by the same libwps contributors above. Source hashes
  and the separately scoped application qualification are recorded in
  `docs/ssconvert/gap-resolution.json`. The LGPL text is included at
  `src/encoding/LGPL-2.1.txt`.
- Quattro Pro: Copyright (C) 2002 Jody Goldberg
  (`plugins/qpro/qpro-read.c`).
- PlanPerfect reader: Kevin Handy (`plugins/plan-perfect/pln.c`).
- WordPerfect charset tables: Copyright (C) 2001 Ariya Hidayat
  (`plugins/plan-perfect/charset.c`), LGPL-2.0-or-later. The LGPL 2.1 text is
  included at `src/encoding/LGPL-2.1.txt`.
- Psion Gnumeric reader: Copyright (C) 2001 Frodo Looijaard,
  GPL-2.0-or-later (`plugins/psiconv/psiconv-read.c`).
- Psiconv 0.9.9 parser semantics: Copyright (c) 2001-2014 Frodo Looijaard,
  GPL-2.0-or-later (`lib/psiconv/parse_sheet.c`, `parse_simple.c`,
  `parse_page.c`, `parse_formula.c`, `parse_layout.c`, `parse_common.c`,
  `parse_texted.c`, `parse_driver.c`, `parse_word.c`, `parse_image.c` and
  associated definitions).

No native Gnumeric or psiconv implementation is loaded, linked, executed or
required by these product readers. Codepage 950 uses the package's existing
captured libgsf byte-mapping facts, whose provenance is recorded separately.

- Paradox DB password checksum, block cipher tables and byte permutation: pxlib 0.6.8
  (`src/px_crypt.c`), Folke Behrens, LGPL-2.0-or-later. Source identity and
  independent compiled cipher vectors are recorded in
  `docs/ssconvert/paradox-encryption-gap-proof.json`. The LGPL text is included
  at `src/encoding/LGPL-2.1.txt`. No native pxlib code is loaded by the product.


## LMBCS national and exception mappings

The national-group additions and assigned fi/fl ligature mappings in
`lotus-charset.ts` follow ICU revision
`049e0d6a420629ac7db77256987d083a563287b5`,
`icu4c/source/data/mappings/{lmb-excp,ibm-9447_P100-2002,ibm-9448_X100-2005,ibm-5347_P100-1998,ibm-5350_P100-1998,windows-874-2000}.ucm`.
These corrections were independently checked with native ICU 76.1. They extend
Gnumeric's historical mappings; they do not claim identical Gnumeric decoding.
No native ICU library is required by the product.

UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 2016-2025 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.

SPDX-License-Identifier: Unicode-3.0
