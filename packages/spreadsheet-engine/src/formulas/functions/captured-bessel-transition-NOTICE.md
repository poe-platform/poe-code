The bounded transition quadrature derives from Gnumeric 1.12.61 `src/sf-bessel.c`, under GPL-2.0-or-later, the license of this package.

Private hyperbolic primitives derive from GNU C Library tag `glibc-2.41`, `sysdeps/ieee754/dbl-64/{e_sinh.c,e_acosh.c,s_expm1.c}`. Copyright (C) 1993 Sun Microsystems, Inc. All rights reserved. Permission to use, copy, modify, and distribute this software is freely granted, provided that this notice is preserved.

The private cube-root primitive derives from `s_cbrt.c` in that directory, Copyright (C) 1997–2025 Free Software Foundation, Inc., under LGPL-2.1-or-later. Its license is included at `src/encoding/LGPL-2.1.txt`. Sources are available at https://github.com/bminor/glibc/tree/glibc-2.41/sysdeps/ieee754/dbl-64 .

The TypeScript port retains the native binary64 coefficients, contraction order, finite quadrature and range shrinking. Primitive qualification covers the quadrature domain, not arbitrary public math inputs. The cube-root reduction is used only for positive normal endpoint inputs.
