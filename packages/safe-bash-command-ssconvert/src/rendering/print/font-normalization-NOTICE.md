Font-supported canonical diacritics follow the default normalizer in
HarfBuzz 10.2.0, commit `7b27c8edd46c674e01dd226fa9e1aa7549f5c436`.
The implementation currently selects Latin, Greek and Cyrillic starters with
combining marks from those scripts, Common or Inherited. Other script-specific
normalizers remain with the existing font shaper. Workbook strings are preserved;
the normalized string is used only for positioned cell glyphs.

The three stages are font-supported recursive canonical decomposition, stable
modified-combining-class ordering, and font-supported canonical recomposition.
Supported singleton characters stay intact. Variation selectors bypass the
decomposition stage, zero combining classes block reordering/composition, and
mark sequences longer than 32 characters retain their ordering. Every stage
shares the caller's work and cancellation checks.

Primary HarfBuzz sources are available under
https://github.com/harfbuzz/harfbuzz/tree/7b27c8edd46c674e01dd226fa9e1aa7549f5c436/src:

| File | SHA-256 |
| --- | --- |
| `hb-ot-shape-normalize.cc` | `0eae6600f98fee3db3691fdf01d0ad17ce39519e51eb79d1fab430eead78ee57` |
| `hb-unicode.hh` | `70f0164885ac89256bfae1336a6ad1bc8ff774ca053498f721e1ed9de68291bc` |
| `hb-unicode.cc` | `bb710579e8221b0983c5b341351f3a9c1bda738c9c00940f8eb8478bb40e26eb` |
| `hb-ot-shaper.hh` | `cee53ee08f5958a9c42e91386a1939fdfaf4c930fe7c41e51eba35e5d53df484` |

Unicode 16 data is available at https://www.unicode.org/Public/16.0.0/ucd/:

| File | SHA-256 |
| --- | --- |
| `UnicodeData.txt` | `ff58e5823bd095166564a006e47d111130813dcf8bf234ef79fa51a870edb48f` |
| `DerivedNormalizationProps.txt` | `4d4c03892dea9146d674b686e495df2d55a28d071ac474041d73518f887abddc` |
| `Scripts.txt` | `9e88f0a677df47311106340be8ede2ecdacd9c1c931831218d2be6d5508e0039` |

The data module retains 701 contiguous property ranges and 808 canonical
decompositions reachable from the selected starters/marks, including their
recursive components. Compatibility decompositions are excluded. Canonical
composition excludes `Full_Composition_Exclusion` entries. No host runtime
Unicode normalization, casing or property tables are used. Unicode's permission
notice is retained in the data module.

HarfBuzz permission notice follows:

Copyright © 2011,2012 Google, Inc.

This is part of HarfBuzz, a text shaping library.

Permission is hereby granted, without written agreement and without
license or royalty fees, to use, copy, modify, and distribute this
software and its documentation for any purpose, provided that the
above copyright notice and the following two paragraphs appear in
all copies of this software.

IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE TO ANY PARTY FOR
DIRECT, INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES
ARISING OUT OF THE USE OF THIS SOFTWARE AND ITS DOCUMENTATION, EVEN
IF THE COPYRIGHT HOLDER HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH
DAMAGE.

THE COPYRIGHT HOLDER SPECIFICALLY DISCLAIMS ANY WARRANTIES, INCLUDING,
BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS FOR A PARTICULAR PURPOSE. THE SOFTWARE PROVIDED HEREUNDER IS
ON AN "AS IS" BASIS, AND THE COPYRIGHT HOLDER HAS NO OBLIGATION TO
PROVIDE MAINTENANCE, SUPPORT, UPDATES, ENHANCEMENTS, OR MODIFICATIONS.

Google Author(s): Behdad Esfahbod
