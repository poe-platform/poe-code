The captured power primitive and its tables derive from the GNU C Library, Copyright (C) 2018–2025 Free Software Foundation, Inc., under LGPL-2.1-or-later. The license text is included at `src/encoding/LGPL-2.1.txt`. This package is distributed under GPL-2.0-or-later.

Sources, tag `glibc-2.41` in https://github.com/bminor/glibc:

- `sysdeps/ieee754/dbl-64/e_pow.c`
- `sysdeps/ieee754/dbl-64/e_pow_log_data.c`
- `sysdeps/ieee754/dbl-64/e_exp_data.c`

The TypeScript port implements the positive finite log/exp path and the observed aarch64 fused instruction order, including ties-away integral reduction. It uses the existing bounded software binary64 FMA. Scalar constants and table words retain their exact binary64 values. Existing JavaScript powers handle other signs/nonfinite arguments, exponents outside the quadrature interval and extreme exp reductions. Qualification covers the actual bounded Hankel quadrature call sites and independent controls; this is not a universal correctly-rounded power replacement. Work/cancellation ticks separate fixed bounded stages. Source identities, binary table comparisons and executed controls are retained in `docs/ssconvert/bessel-pow-native-gap-proof.json` in the source repository.
