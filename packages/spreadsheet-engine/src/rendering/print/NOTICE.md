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
