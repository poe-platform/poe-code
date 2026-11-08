import { tokenizeCos } from "../cos/lexer.js";

const ACROFORM_FONT_ALIAS_MAP: Record<string, string> = {
  Helv: "Helvetica",
  HeBo: "Helvetica-Bold",
  HeOb: "Helvetica-Oblique",
  HeBI: "Helvetica-BoldOblique",
  Cour: "Courier",
  CoBo: "Courier-Bold",
  CoOb: "Courier-Oblique",
  CoBI: "Courier-BoldOblique",
  TiRo: "Times-Roman",
  TiBo: "Times-Bold",
  TiIt: "Times-Italic",
  TiBI: "Times-BoldItalic",
  Symb: "Symbol",
  ZaDb: "ZapfDingbats",
};

export function parseDefaultAppearanceString(
  daStr: string,
  boxHeight: number
): { baseFont: string; fontSize: number; colorOp?: string | undefined } {
  let baseFont = "Helvetica";
  let fontSize = 11;
  let colorOp: string | undefined;
  const tokens = tokenizeCos(new TextEncoder().encode(daStr));
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.kind === "keyword") {
      if (tok.value === "Tf" && i >= 2) {
        const nameTok = tokens[i - 2]!;
        const sizeTok = tokens[i - 1]!;
        if (nameTok.kind === "name") {
          baseFont = ACROFORM_FONT_ALIAS_MAP[nameTok.decoded] ?? nameTok.decoded;
        }
        if (sizeTok.kind === "number") {
          fontSize =
            sizeTok.value > 0
              ? sizeTok.value
              : Math.max(6, Math.min(18, Math.floor(boxHeight * 0.65)));
        }
      } else if ((tok.value === "g" || tok.value === "G") && i >= 1) {
        const c0 = tokens[i - 1]!;
        if (c0.kind === "number") {
          colorOp = `${c0.value} ${tok.value}`;
        }
      } else if ((tok.value === "rg" || tok.value === "RG") && i >= 3) {
        const c0 = tokens[i - 3]!;
        const c1 = tokens[i - 2]!;
        const c2 = tokens[i - 1]!;
        if (c0.kind === "number" && c1.kind === "number" && c2.kind === "number") {
          colorOp = `${c0.value} ${c1.value} ${c2.value} ${tok.value}`;
        }
      } else if ((tok.value === "k" || tok.value === "K") && i >= 4) {
        const c0 = tokens[i - 4]!;
        const c1 = tokens[i - 3]!;
        const c2 = tokens[i - 2]!;
        const c3 = tokens[i - 1]!;
        if (
          c0.kind === "number" &&
          c1.kind === "number" &&
          c2.kind === "number" &&
          c3.kind === "number"
        ) {
          colorOp = `${c0.value} ${c1.value} ${c2.value} ${c3.value} ${tok.value}`;
        }
      }
    }
  }
  return { baseFont, fontSize, colorOp };
}

