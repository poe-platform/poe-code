import { InvalidValueError } from "./archive.js";
import { twips } from "./create-content.js";
import type { DocxCellMargins, DocxParagraphShading, DocxTableBorders, DocxTableInput, DocxTableRowOptions } from "./operation-types.js";
import { paragraphUnits } from "./paragraph-properties.js";
import { documentDialects } from "./dialect.js";

export function tableBorders(borders: DocxTableBorders | undefined, tag: string, w: string): string {
  if (!borders) return "";
  const edges = ["top", "left", "bottom", "right", "insideH", "insideV"] as const;
  return `<w:${tag}>${edges.map(edge => {
    const border = borders[edge]; if (!border) return "";
    const size = paragraphUnits(border.width, 12700 / 8), space = border.space ? paragraphUnits(border.space, 12700) : 0;
    if (border.width.value < 0 || size < (border.style === "none" ? 0 : 2) || size > 96 || (border.space?.value ?? 0) < 0 || space > 31)
      throw new InvalidValueError("Table border width or spacing is outside the supported range.");
    const name = w === documentDialects.strict.w ? ({ left: "start", right: "end" }[edge as string] ?? edge) : edge;
    return `<w:${name} w:val="${border.style}" w:sz="${size}" w:color="${border.color.toUpperCase()}" w:space="${space}"/>`;
  }).join("")}</w:${tag}>`;
}
export function tableShading(shading?: DocxParagraphShading): string {
  return shading ? `<w:shd w:val="${shading.pattern}" w:color="${shading.color?.toUpperCase() ?? "auto"}" w:fill="${shading.fill.toUpperCase()}"/>` : "";
}
export function tableMargins(margins: DocxCellMargins | undefined, tag: string, w: string): string {
  if (!margins) return "";
  return `<w:${tag}>${(["top", "left", "bottom", "right"] as const).map(edge => {
    const value = margins[edge]; if (!value) return "";
    const name = w === documentDialects.strict.w ? ({ left: "start", right: "end" }[edge as string] ?? edge) : edge;
    return `<w:${name} w:w="${twips(value, false)}" w:type="dxa"/>`;
  }).join("")}</w:${tag}>`;
}
export function tableGeometry(table: DocxTableInput, available: number, w: string) {
  const columns = table.rows[0]!.length;
  const supplied = table.columnWidths?.map(v => twips(v));
  if (supplied && supplied.length !== columns) throw new InvalidValueError("Column widths must match the grid column count.");
  const sum = supplied?.reduce((total, width) => total + width, 0);
  const width = table.width ? twips(table.width) : sum ?? available;
  if (width < columns || width > available || !Number.isSafeInteger(width) || sum !== undefined && width !== sum)
    throw new InvalidValueError("Table grid widths must sum to a positive width within the container.");
  const widths = supplied ?? Array.from({ length: columns }, (_, i) => Math.floor(width / columns) + (i < width % columns ? 1 : 0));
  if (table.repeatHeader !== undefined && table.headerRows !== undefined) throw new InvalidValueError("Choose repeatHeader or headerRows.");
  const headers = table.headerRows ?? (table.repeatHeader ? 1 : 0);
  if (headers > table.rows.length || table.rowOptions && table.rowOptions.length !== table.rows.length)
    throw new InvalidValueError("Row options and header count must fit the table rows.");
  let endedHeaders = false;
  const rows = table.rows.map((_, index) => {
    const options: DocxTableRowOptions = { ...(table.allowRowSplit === undefined ? {} : { allowRowSplit: table.allowRowSplit }), ...(table.rowHeight ? { height: table.rowHeight } : {}), ...(table.heightRule ? { heightRule: table.heightRule } : {}), repeatHeader: index < headers, ...table.rowOptions?.[index] };
    if (options.repeatHeader && endedHeaders) throw new InvalidValueError("Repeated headers must be consecutive leading rows.");
    if (!options.repeatHeader) endedHeaders = true;
    if (!options.height && options.heightRule && options.heightRule.name !== "AUTO") throw new InvalidValueError("A fixed or minimum row height requires a height.");
    const height = options.height ? twips(options.height, false) : 0;
    const rule = { AUTO: "auto", AT_LEAST: "atLeast", EXACTLY: "exact" }[options.heightRule?.name ?? "AT_LEAST"];
    return `<w:trPr>${options.allowRowSplit === undefined ? "" : `<w:cantSplit w:val="${Number(!options.allowRowSplit)}"/>`}${options.height || options.heightRule ? `<w:trHeight w:val="${height}" w:hRule="${rule}"/>` : ""}${options.repeatHeader ? '<w:tblHeader w:val="1"/>' : ""}</w:trPr>`;
  });
  const margins = table.cellMargin ? { top: table.cellMargin, left: table.cellMargin, bottom: table.cellMargin, right: table.cellMargin } : undefined;
  const properties = `<w:tblW w:w="${width}" w:type="dxa"/>` + tableBorders(table.borders, "tblBorders", w) + tableShading(table.shading) + `<w:tblLayout w:type="${table.autofit === false ? "fixed" : "autofit"}"/>` + tableMargins(margins, "tblCellMar", w);
  return { widths, rows, properties, margin: table.cellMargin ? twips(table.cellMargin, false) : 0 };
}
