import { InvalidValueError } from "./archive.js";
import { pageGeometry, renderContent } from "./create-content.js";
import type { DocumentBudget } from "./budget.js";
import type { Location } from "./location-token.js";
import type { DocxOperationArguments, DocxTableInput } from "./operation-types.js";
import type { XmlElement } from "./package-xml.js";
import { UnsupportedEditError } from "./xml-write.js";
import { sectionAttribute, sectionChild } from "./section-properties.js";

/** Resolve explicit stored geometry; no layout engine or host metrics are consulted. */
export function renderInsertedTable(options: DocxOperationArguments<"tables.add">, location: Location | undefined, root: XmlElement, mainRoot: XmlElement, styles: XmlElement | undefined, budget: DocumentBudget) {
  const supplied = options.content;
  if (supplied && (supplied.page || supplied.theme || supplied.styles || supplied.blocks.length !== 1 || supplied.blocks[0]?.kind !== "table"))
    throw new InvalidValueError("Table content requires exactly one table and no document settings.");
  const block = supplied?.blocks[0] as DocxTableInput | undefined;
  if (block && (block.rows.length !== options.rows || block.rows[0]!.length !== options.cols))
    throw new InvalidValueError("Typed table content must match explicit rows and columns.");
  const formatKeys = ["width", "style", "columnWidths", "autofit", "repeatHeader", "headerRows", "allowRowSplit", "rowHeight", "heightRule", "borders", "shading", "cellMargin", "rowOptions"] as const;
  const formatting = Object.fromEntries(formatKeys.filter(key => options[key] !== undefined).map(key => {
    if (block?.[key] !== undefined) throw new InvalidValueError("Table formatting cannot be supplied twice.");
    return [key, options[key]];
  }));
  budget.table(options.rows, options.cols);
  const table: DocxTableInput = { kind: "table", rows: block?.rows ?? Array.from({ length: options.rows }, () => Array.from({ length: options.cols }, () => ({ blocks: [] }))), ...block, ...formatting };
  const width = tableContainerWidth(location, root, mainRoot, options.before);
  return renderContent({ version: 1, blocks: [table] }, mainRoot.namespace, budget, styles, width);
}

/** Stored section or enclosing-cell width shared by insertion and explicit grid growth. */
export function tableContainerWidth(location: Location | undefined, root: XmlElement, mainRoot: XmlElement, before?: boolean): number {
  const body = sectionChild(mainRoot, "body")!;
  const sections = body.children.flatMap(n => n.localName === "p" ? sectionChild(sectionChild(n, "pPr"), "sectPr") ?? [] : n.localName === "sectPr" ? [n] : []);
  let section = sections.at(-1);
  if (location?.positions.section) section = sections[location.positions.section - 1];
  // An insertion after a section-ending paragraph belongs to the following section.
  if (location?.kind === "paragraph" && !location.value.range && !before) {
    let node = root; for (const i of location.value.path) node = node.children[i]!;
    if (sectionChild(sectionChild(node, "pPr"), "sectPr")) section = sections[(location.positions.section ?? 1)];
  }
  let width = pageGeometry(undefined, section, mainRoot.namespace).width;
  const columns = sectionChild(section, "cols");
  const count = Number(sectionAttribute(columns, "num") ?? 1);
  if (!Number.isSafeInteger(count) || count < 1) throw new UnsupportedEditError("Invalid section column geometry.");
  if (count > 1) {
    const entries = columns?.children.filter(n => n.namespace === mainRoot.namespace && n.localName === "col") ?? [];
    if (entries.length) {
      if (entries.length !== count) throw new UnsupportedEditError("Incomplete section column geometry.");
      width = Math.min(...entries.map(n => Number(sectionAttribute(n, "w"))));
    } else width = Math.floor((width - (count - 1) * Number(sectionAttribute(columns, "space") ?? 720)) / count);
  }
  let node = root;
  let tableMargins: XmlElement | undefined;
  for (const index of location?.value.path ?? []) {
    node = node.children[index]!;
    if (node.namespace !== root.namespace) continue;
    if (node.localName === "tbl") tableMargins = sectionChild(sectionChild(node, "tblPr"), "tblCellMar");
    if (node.localName !== "tc") continue;
    const props = sectionChild(node, "tcPr"), cellWidth = sectionChild(props, "tcW");
    if (sectionAttribute(cellWidth, "type") !== "dxa") throw new UnsupportedEditError("Nested insertion requires an explicit cell width in twips.");
    width = Number(sectionAttribute(cellWidth, "w"));
    const margins = sectionChild(props, "tcMar");
    for (const edge of ["left", "right"]) {
      const alternate = edge === "left" ? "start" : "end";
      const margin = sectionChild(margins, edge) ?? sectionChild(margins, alternate) ?? sectionChild(tableMargins, edge) ?? sectionChild(tableMargins, alternate);
      if (margin && sectionAttribute(margin, "type") !== "dxa") throw new UnsupportedEditError("Nested insertion requires explicit cell margins in twips.");
      width -= Number(sectionAttribute(margin, "w") ?? 0);
    }
  }
  if (!Number.isSafeInteger(width) || width < 1) throw new UnsupportedEditError("No positive stored container width is available.");
  return width;
}
