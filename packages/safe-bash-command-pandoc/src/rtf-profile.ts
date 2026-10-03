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

export interface RtfState {
  codepage: number;
  defaultFont: number | undefined;
  uc: number;
  font: number | undefined;
  color: number;
  size: number | undefined;
  tags: Set<RunTag>;
  list: number | undefined;
  level: number;
  alignment: string | undefined;
  left: number | undefined;
  right: number | undefined;
  indent: number | undefined;
  heading: number | undefined;
}

export const initialRtfState = (): RtfState => ({codepage: 1252, defaultFont: undefined, uc: 1, font: undefined, color: 0, size: undefined, tags: new Set(), list: undefined, level: 0, alignment: undefined, left: undefined, right: undefined, indent: undefined, heading: undefined});

export const characters: Readonly<Record<string, string>> = {
  emdash: "—", endash: "–", bullet: "•", lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”",
  emspace: "\u2003", enspace: "\u2002", qmspace: "\u2005"
};
export const metadataDestinations = new Set(["info", "generator", "fonttbl", "colortbl", "stylesheet", "listtable", "listoverridetable"]);
export const forbiddenDestinations = new Set(["object", "objdata", "objclass", "objname", "objalias", "datafield", "filetbl"]);
export const unsupportedDestinations = new Set(["header", "headerl", "headerr", "headerf", "footer", "footerl", "footerr", "footerf", "annotation", "shp", "shptxt", "nonshppict", "upr", "ud", "xmlopen", "xmlattrname", "xmlattrvalue"]);
