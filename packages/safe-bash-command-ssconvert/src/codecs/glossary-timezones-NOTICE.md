The glossary timestamp follows Gnumeric 1.12.61's
`plugins/gnome-glossary/gnome_glossary.py` expression
`strftime('%Y-%m-%d %H:%M%Z', localtime(time()))`, using the injected clock and
explicit timezone rather than the ambient process TZ.

Offsets and abbreviations share the spreadsheet engine's pinned Debian tzdb
2026c profile. See `packages/spreadsheet-engine/src/formulas/functions/timezones-NOTICE.md`
for authenticated input hashes and regeneration instructions. TZif character
tables and POSIX footer names supply `%Z`; locale-dependent ICU display names
are never substituted. All 485 captured zone names and aliases are admitted
throughout the JavaScript Date range, including local civil dates just beyond
its boundaries. Unknown names fail with `capability-denied`. Future civil-time
rules reflect the pinned release, not subsequent legislation.

Independent libc comparisons qualify timestamp headers, not activation or
qualification of the full native Python glossary plugin.

Source receipts (SHA256):

- Gnumeric 1.12.61 archive: `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`
- `gnome_glossary.py`: `81f5e170bb384f60d492b6e7923cddb050a791f9d21ebfc403778b62fd532618`
