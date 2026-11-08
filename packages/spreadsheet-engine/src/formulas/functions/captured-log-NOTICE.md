The captured logarithm primitive and its tables derive from the GNU C Library, Copyright (C) 2018–2025 Free Software Foundation, Inc., under LGPL-2.1-or-later. The license text is included at `src/encoding/LGPL-2.1.txt`. This package is distributed under GPL-2.0-or-later.

Sources, tag `glibc-2.41` in https://github.com/bminor/glibc:

- `sysdeps/ieee754/dbl-64/e_log.c`
- `sysdeps/ieee754/dbl-64/e_log_data.c`

The TypeScript port preserves binary64 table values and the observed aarch64 fused instruction order, including the near-one polynomial. It uses bounded software FMA and fixed-size reduction stages. Independent native comparison covers 20,505 inputs, including random positive finite binary64 values, near-one values and domain boundaries; this is not a claim of universal correct rounding.
