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
