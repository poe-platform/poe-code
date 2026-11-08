# Timezone offset and abbreviation data

`timezone-data.ts` contains public-domain timezone facts from IANA tzdb 2026c,
compiled in Debian `tzdata` version `2026c-0+deb13u1`. No native code executes
in the JavaScript implementation. The offset lookup and generator are original
project code.

Authenticated archive: `tzdata_2026c-0+deb13u1_all.deb` (264156 bytes), SHA-256
`813b9bbbe14ccda2b24617b8bade0ade4d745957e75921766c153d249886bd4c`.
The installed `tzdata.zi` SHA-256 is
`af5c1d3bebe136d372c131bb1a45725f955a8cc2a5ae2fc5a31d3b372e145f49`.
Sources: <https://www.iana.org/time-zones> and
<https://deb.debian.org/debian/pool/main/t/tzdata/>.

Regenerate using `scripts/generate-timezones.py` with the authenticated
`/usr/share/zoneinfo` directory and the output `src/formulas/functions/timezone-data.ts`.
The generator decodes TZif with `struct`, preserves initial offsets, TZif abbreviations and all
64-bit transitions, and parses the trailing POSIX rules into numeric descriptors.
It excludes leap-second (`right`) files, duplicate `posix` trees and host-specific
`localtime`/`posixrules` entries. All 485 available named zones and aliases are
retained in 436 distinct profiles. Source names are matched case-insensitively,
consistent with the existing Intl-based interface. Names outside this captured
profile retain the host Intl behavior for date formulas; glossary export requires
a captured abbreviation and refuses other names.

The sorted name-to-TZif-SHA256 JSON inventory hash is
`c5d2b3e05c4a76362ebd3c5e8884680d0a696fe872277303acb268f5c4e99b3e`.
Future month/week/weekday rules include signed and extended transition times,
non-hour offsets, southern-hemisphere seasons and negative daylight offsets.
