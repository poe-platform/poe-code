# Print geometry source notice

The pagination and fit algorithms follow released Gnumeric 1.12.61
`src/print.c` (compute_group, adjust_repetition, paginate,
compute_scale_fit_to, compute_sheet_pages and print_page), with source
authors Miguel de Icaza, Morten Welinder and Andreas J. Guelzow; copyright
2007 Andreas J. Guelzow and 2007–2009 Morten Welinder. Gnumeric is
GPL-2.0-or-later; these TypeScript
implementations are distributed under this package's GPL-2.0-or-later license.
See the package LICENSE for license terms.

The official source archive SHA-256 is
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Authenticated `src/print.c` SHA-256 is
`fee11181a89822062f3dac39fde3734e554338fae5237e0ce9e96114882da71b`.
Source acquisition/extraction stays under out. No native executable, font data,
source archive or discovery capability is part of these geometry helpers.

The helpers require explicit geometry and invocation budgets/cancellation.
They do not supply workbook selection, font shaping, painting or PDF rendering.

Header/footer opcode parsing follows `src/print-info.c`
(`gnm_print_hf_format_render`, `render_opcode` and the render callbacks),
authors Andreas J. Guelzow, Jody Goldberg and Miguel de Icaza; copyright
2007–2009 Morten Welinder, under GPL-2.0-or-later. Authenticated source SHA-256 is
`ff970d578a151d5e7a76ed962cb3e9159383c6a992cd9ce85d2c0d998a349e11`.
The helper takes explicit filename/path/sheet/title/page metadata; date formatting
and cell resolution are injected. It does not discover ambient time, locale or
filesystem state, and its English opcode support is not a translated opcode
catalog or native collation implementation.

Leftward, rightward and centered text span eligibility and clipping follow Gnumeric 1.12.61
`src/cellspan.c` and `src/print-cell.c`, by Miguel de Icaza, Jody Goldberg
and Andreas J. Guelzow; copyright 2007–2009 Morten Welinder, under
GPL-2.0-or-later. Their SHA-256 values are respectively
`410195ebf5f523e486ed9111a1e1b81ce1fcded4a35ee570e91a40d585ece62b` and
`6a057396fc6c920ca5cf239b24150e1e5e9e38f888096a4e7540775b4b98c8b4`.
The implementation uses a bounded occupied-column index and preserves formula
blockers and hidden-column behavior; the PDF adapter paints backgrounds first.

Centered spanning placement also follows `src/cell-draw.c` (`cell_calc_layout`),
SHA-256 `7e0e222ff559e3e90ef037a41c221cd5520c94b894582a64c97dede8c97841f6`,
under the same GPL-2.0-or-later source attribution. Display advances select
whole-column spans independently on each side; print advances position glyphs.

Cell colors follow the 16-bit to 8-bit channel conversion in
Gnumeric `src/style-color.c` (`gnm_color_new_rgba16`), author Miguel de Icaza,
and the `src/xml-sax-read.c` color fields, copyright 2000–2007 Jody Goldberg
and 2007–2024 Morten Welinder (GPL version 2 or 3). Source SHA-256 values:
`c1abfd266978b313af7e1efb011880a39cccf8c24f53e8364b8913fc5aa10367`
and `05e313c36412e6572203fd2f4194487ac939cf63f984d21d8c30bdecfe1713f3`,
respectively. Alpha channels use the same high-byte conversion, and the PDF
painter scopes text opacity to each cell.

Width-aware General numeric formatting follows GOffice 0.10.61
`goffice/utils/go-format.c` (`go_render_general`), copyright 2003–2005
Jody Goldberg and 2005–2023 Morten Welinder, licensed under GPL version 2
or, at your option, version 3. The official archive SHA-256 is
`558597fd9ca59b93ff562750218d1e7ea8ec3c8d0ed6a5cc096aa715ef909a15`;
the source file SHA-256 is
`6da5b2923db95cf4c35fa493e26c35f88075cdf7520ae3f0d39b0c50233edc97`.
The helper uses caller-supplied font measurement, locale and work accounting.

Automatic wrapping follows Gnumeric 1.12.61 `src/cell-draw.c`
(`cell_calc_layout`) and its Pango WORD_CHAR layout policy. Unicode break
opportunities come from the MIT-licensed `linebreak` dependency; grapheme and
word segmentation use the host Intl implementation. Qualification includes
explicit and vertical-alignment wrapping, indentation, discretionary hyphens
and caller-budgeted candidate measurements.

Automatic hyphen eligibility follows Pango 1.56.3 `pango/break.c`,
copyright 1999 Red Hat Software, under LGPL-2.0-or-later.
Official archive SHA-256:
`2606252bc25cd8d24e1b7f7e92c3a272b37acd6734347b73b47a482834ba2491`;
`break.c` SHA-256:
`3b08d6764e18b63860e94d1cb0194eabfac3a9cfaa4e3da668bec38bffa5679c`.
The compact script ranges derive from Unicode16 `Scripts.txt` at
https://www.unicode.org/Public/16.0.0/ucd/Scripts.txt (SHA-256
`9e88f0a677df47311106340be8ede2ecdacd9c1c931831218d2be6d5508e0039`),
under Unicode License V3 retained in `hyphen-scripts.ts`.

Fill LF translation follows Gnumeric 1.12.61 `src/gnm-format.c`,
copyright 1998 Chris Lahey and Miguel de Icaza, 2006–2007 Morten Welinder,
under GPL-2.0-or-later. The file matches the authenticated archive above;
SHA-256 `8e574a8f199474f4e3c42756d74479bac08d720b6657deb7aca35bd60f563318`.

Horizontal justification follows Pango 1.56.3 `pango/pango-layout.c`
(`justify_words`, `justify_clusters`, `distribute_letter_spacing`), copyright
2000, 2001, 2006 Red Hat Software, under LGPL-2.0-or-later. The file from the
authenticated Pango archive above has SHA-256
`273709ebcc6b1333b5e7126ffc4d510e95daaa0f42c7b3fe3007c1019a5c2836`.
The helper expands explicit shaped advances with invocation work accounting;
fontkit mappings that cannot establish logical clusters are refused.

Merged-cell painting follows Gnumeric 1.12.61 `src/print-cell.c`
(`print_merged_range_gtk`, `print_cell_gtk` and `gnm_print_sheet`), under the
Gnumeric license above. The authenticated source SHA-256 is
`6a057396fc6c920ca5cf239b24150e1e5e9e38f888096a4e7540775b4b98c8b4`.
Corner values and styles use full merged geometry, with page clipping and
native visibility rules; range indexing does not expand merged cells.

Diagonal border geometry, widths and dash patterns follow Gnumeric 1.12.61
`src/style-border.c` (`gnm_style_border_set_dash` and
`gnm_style_border_print_diag_gtk`), copyright 1999–2001 Jody Goldberg,
under GPL-2.0-or-later. Authenticated source SHA-256:
`6dd6bd5c851510561511f2b2407cb8719b522059656b9f234c488c446abdc1bd`.
