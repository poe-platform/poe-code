export type RunTag = "Strong" | "Emph" | "Underline" | "Strikeout" | "SmallCaps" | "Superscript" | "Subscript";
export const runControls: Readonly<Record<string, RunTag>> = {
  b: "Strong", i: "Emph", ul: "Underline", strike: "Strikeout", scaps: "SmallCaps", super: "Superscript", sub: "Subscript"
};
// These change layout or document bookkeeping, not textual content in the
// declared subset. Unlisted controls fail rather than pretending to support them.
export const layoutControls = new Set([
  "deff", "deflang", "deflangfe", "lang", "langfe", "adeflang", "viewkind", "viewscale", "viewzk",
  "fet", "fromtext", "fromhtml", "nouicompat", "widowctrl", "hyphauto", "deftab", "paperw", "paperh",
  "margl", "margr", "margt", "margb", "gutter", "pgnstart", "facingp", "landscape", "sectd",
  "ql", "qr", "qc", "qj", "fi", "li", "ri", "sb", "sa", "sl", "slmult", "keep", "keepn",
  "widctlpar", "nowidctlpar", "tx", "tql", "tqr", "tqc", "tqdec", "tlhyph", "tldot", "tlul",
  "trgaph", "trleft", "trrh", "trql", "trqr", "trqc", "trkeep", "trhdr", "clvertalt", "clvertalc", "clvertalb"
]);
