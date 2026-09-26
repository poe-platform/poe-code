The scalar acos implementation and coefficient tables derive from the IBM Accurate Mathematical Library in glibc 2.41, Copyright (C) 2001–2025 Free Software Foundation, Inc., under LGPL-2.1-or-later. The license text is included at `src/encoding/LGPL-2.1.txt`. This package is distributed under GPL-2.0-or-later.

Sources, tag `glibc-2.41` in https://github.com/bminor/glibc:

- `sysdeps/ieee754/dbl-64/e_asin.c` (acos only)
- `sysdeps/ieee754/dbl-64/asincos.tbl`
- `sysdeps/ieee754/dbl-64/root.tbl`
- `sysdeps/ieee754/dbl-64/uasncs.h`

The TypeScript port uses the existing software binary64 fused multiply-add to reproduce the scalar instruction order observed in the authenticated Debian arm64 libm. Integer-word tables are stored as round-tripping decimal numbers. Powers of two are computed exactly. Fixed polynomial loops expose cooperative work/cancellation. This is captured native profile behavior; it does not promise all-domain mathematical correct rounding or equivalence to other platforms. Source identities and executed comparisons are retained in `docs/ssconvert/bessel-acos-native-gap-proof.json` in the source repository.
