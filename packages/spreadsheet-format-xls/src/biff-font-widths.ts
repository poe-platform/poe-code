// Gnumeric 1.12.61 plugins/excel/ms-excel-util.c font measurements.
// Copyright (C) 1999-2005 Jon K Hellan. GPL-2.0-or-later.
// See legacy-binary-NOTICE.md for source provenance.
type FontWidth = readonly [unit: number, baseline: number, step: number];
const fallback: FontWidth = [8, 0x924, 36.5];
const widths = new Map<string, FontWidth>();
for (const name of ["ar pl kaitim big5", "ar pl kaitim gb", "ar pl mingti2l big5", "ar pl sungtil gb", "albany amt", "albany", "andale sans", "arial baltic", "arial ce", "arial cyr", "arial greek", "arial tur", "arial", "baekmuk batang", "baekmuk dotum", "bell mt", "bitstream vera sans", "dejavu sans", "sans", "book antiqua", "century gothic", "east syriac adiabene", "east syriac ctesiphon", "estrangelo antioch", "estrangelo edessa", "estrangelo midyat", "estrangelo nisibin outline", "estrangelo nisibin", "estrangelo quenneshrin", "estrangelo talada", "estrangelo turabdin", "freesans", "freeserif", "gautami", "helv", "helvetica", "helvetica-light", "impact", "incised901 swc", "luxi sans", "luxi serif", "ms outlook", "ms sans serif", "microsoft sans serif", "omegaserif88591", "omegaserif88592", "omegaserif88593", "omegaserif88594", "omegaserif88595", "omegaserifviscii", "opensymbol", "palatino linotype", "palatino", "segeo", "serto batnan", "serto jerusalem outline", "serto jerusalem", "serto kharput", "serto malankara", "serto mardin", "serto urhoy", "swiss742 cn swc", "swiss742 swc", "sylfaen", "tahoma", "trebuchet ms", "tunga", "zapfhumanist dm swc"])
  widths.set(name, [8, 0x924, 36.5]);
for (const name of ["andale mono", "baekmuk galim", "baekmuk headline", "bitstream vera sans mono", "dejavu sans mono", "bitstream vera serif", "dejavu serif", "bookman old style", "calibri", "comic sans ms", "courier new", "courier", "cumberland amt", "fixedsys", "franklin gothic medium", "freemono", "lettergothic swc", "lucida console", "lucida sans unicode", "lucida sans", "luxi mono", "mangal", "suse sans mono", "suse sans", "suse serif", "shruti", "system", "terminal", "verdana"])
  widths.set(name, [9, 0x900, 32.0]);
for (const name of ["andy mt", "arial narrow", "dutch801 swc", "garamond", "goha-tibeb zemen", "haettenschweiler", "helvetica-narrow", "ms serif", "modern", "monotype corsiva", "origgaramond swc", "roman", "small fonts", "symbol", "symbolps", "thorndale amt", "times new roman", "tms rmn", "vrinda"])
  widths.set(name, [7, 0x955, 42.5]);
for (const name of ["arial black", "georgia", "helvetica-black", "latha", "mv boli", "raavi"])
  widths.set(name, [10, 0x8e3, 28.5]);
for (const name of ["kartika", "script"])
  widths.set(name, [6, 0x999, 51.25]);
for (const name of ["mt extra", "marlett", "monotype sorts", "webdings"])
  widths.set(name, [15, 0x93b, 19.75]);
for (const name of ["wst_czec", "wst_engl", "wst_fren", "wst_germ", "wst_ital", "wst_span", "wst_swed"])
  widths.set(name, [11, 0x8cc, 25.75]);
for (const name of ["wingdings 2"])
  widths.set(name, [17, 0x911, 17.25]);
for (const name of ["wingdings 3"])
  widths.set(name, [13, 0x8aa, 21.25]);
for (const name of ["wingdings"])
  widths.set(name, [19, 0x8f0, 15.25]);

export function biffFontWidth(name: string): FontWidth {
  // Native matching folds ASCII only, including for unknown Unicode font names.
  let key = "";
  for (const character of name) key += character >= "A" && character <= "Z" ? character.toLowerCase() : character;
  return widths.get(key) ?? fallback;
}
