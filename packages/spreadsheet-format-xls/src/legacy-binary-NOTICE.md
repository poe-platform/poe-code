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

- BIFF column-width font metrics: Copyright (C) 1999-2005 Jon K Hellan,
  Gnumeric 1.12.61 `plugins/excel/ms-excel-util.c`, GPL-2.0-or-later.
  SHA-256: `64b2c7bb115e9eda9385c29ea9ccb64d11f69413653a371f077426a483155d66`.
  Width conversion follows `ms-excel-read.c` Normal-XF font selection and
  COLINFO/DEFCOLWIDTH arithmetic. These are portable captured measurements;
  native fonts and Gnumeric are not runtime dependencies.

BIFF fill-pattern indexes and solid-fill color roles follow Gnumeric 1.12.61
`plugins/excel/ms-excel-read.c` (`excel_map_pattern_index_from_excel`,
`excel_get_style_from_xf`) and `ms-excel-write.c` (`map_pattern_to_xl`),
under GPL-2.0-or-later. The pinned source hashes and native qualification are
recorded in `docs/ssconvert/gap-resolution.json`.
