The glossary timestamp follows Gnumeric 1.12.61's
`plugins/gnome-glossary/gnome_glossary.py` expression
`strftime('%Y-%m-%d %H:%M%Z', localtime(time()))`, using the injected clock and
explicit timezone rather than the ambient process TZ.

`glossary-timezones.ts` contains public-domain IANA timezone facts extracted from
macOS `/usr/share/zoneinfo` TZif files, tzdb release `2026b` (`+VERSION`).
The source SHA256 hashes and deterministic TZif extractor are in
`scripts/generate-glossary-timezones.py`. Run that script with the source zoneinfo
directory to reproduce the table. No source archive or native binary is shipped.
TZif transition instants are UTC seconds; offsets are seconds east of UTC, and
abbreviations come directly from the TZif character table. The same transition
supplies the local civil time and `%Z` spelling, avoiding ICU/tzdb version mixing.
The generator reads the 32-bit TZif block; no POSIX footer extrapolation is used.

The admitted source profile is exactly `UTC`, `America/Los_Angeles`,
`Asia/Kolkata`, and `Europe/Warsaw`, for injected instants in
`[1970-01-01T00:00:00Z, 2038-01-01T00:00:00Z)`. Other zone names (including
aliases), historical dates and later dates fail with `capability-denied` rather
than fabricate a libc abbreviation from a locale-dependent display name.
Future civil-time rules reflect the pinned release, not subsequent legislation.

Memory fixtures compare the eight reported winter/summer headers and exact DST
boundaries with independently observed libc `strftime` output. Historical tests
cover Los Angeles's January 1974 emergency DST and Warsaw's July 1974 standard
time, preventing an approximation based only on today's seasonal rules.
This qualifies timestamp headers within the supported profile, not successful
activation or qualification of the full native Python glossary plugin.
Remaining timezone/native plugin profiles belong to parent issue #1748.

Source receipts (SHA256):

- Gnumeric 1.12.61 archive: `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`
- `gnome_glossary.py`: `81f5e170bb384f60d492b6e7923cddb050a791f9d21ebfc403778b62fd532618`
- TZif `UTC`: `8b85846791ab2c8a5463c83a5be3c043e2570d7448434d41398969ed47e3e6f2`
- TZif `America/Los_Angeles`: `68977bb9ad6d186fefc6c7abd36010a66e30008dcb2d376087a41c49861e7268`
- TZif `Asia/Kolkata`: `e90c341036cb7203200e293cb3b513267e104a39a594f35e195254e6bc0a17cf`
- TZif `Europe/Warsaw`: `4e22c33db79517472480b54491a49e0da299f3072d7490ce97f1c4fd6779acab`
