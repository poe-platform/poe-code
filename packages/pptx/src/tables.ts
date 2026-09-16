import { SaxesParser } from "saxes";
import { OfficeError } from "./errors.js";
import { Length } from "./length.js";
import { attr, child, required } from "./masters.js";
import { nodeFor } from "./shape-operations.js";
import { readShape, type ShapeLength } from "./shapes.js";
import { applyFrameFormatting, TextFrame } from "./text-frames.js";
import { parseXmlPart, type XmlElement, type XmlPart, type XmlMerge } from "./xml.js";
export interface TableUpdate {
  readonly rows?: number;
  readonly columns?: number;
  readonly data?: readonly (readonly string[])[];
  readonly cell?: { readonly row: number; readonly column: number };
  readonly text?: string;
  readonly left?: ShapeLength;
  readonly top?: ShapeLength;
  readonly width?: ShapeLength;
  readonly height?: ShapeLength;
  readonly rowHeight?: ShapeLength;
  readonly columnWidth?: ShapeLength;
  readonly style?: string | null;
  readonly fill?: string | null;
  readonly borderColor?: string | null;
  readonly borderWidth?: ShapeLength | null;
  readonly marginLeft?: ShapeLength | null;
  readonly marginRight?: ShapeLength | null;
  readonly marginTop?: ShapeLength | null;
  readonly marginBottom?: ShapeLength | null;
  readonly verticalAnchor?: "top" | "middle" | "bottom" | null;
  readonly firstRow?: boolean;
  readonly lastRow?: boolean;
  readonly firstCol?: boolean;
  readonly lastCol?: boolean;
  readonly horzBand?: boolean;
  readonly vertBand?: boolean;
}
const flags = ["firstRow", "lastRow", "firstCol", "lastCol", "horzBand", "vertBand"] as const;
const margins = {
  marginLeft: "marL",
  marginRight: "marR",
  marginTop: "marT",
  marginBottom: "marB"
} as const;
function unsupported(message: string): never {
  throw new OfficeError("unsupported-edit", message, "validate-intent");
}
function invalid(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}
function dataObject(value: unknown, keys: readonly string[]): void {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some(
      (k) =>
        typeof k !== "string" ||
        !keys.includes(k) ||
        !("value" in Object.getOwnPropertyDescriptor(value, k)!)
    )
  )
    invalid("Table options require stored data with supported keys.");
}
function emu(value: ShapeLength): number {
  if (!(value instanceof Length)) {
    dataObject(value, ["value", "unit"]);
    if (
      typeof value.value !== "number" ||
      !Number.isFinite(value.value) ||
      typeof value.unit !== "string"
    )
      invalid("Table lengths require finite numeric values.");
  } else if (!("value" in (Object.getOwnPropertyDescriptor(value, "emu") ?? {})))
    invalid("Lengths require stored values.");
  const n =
    value instanceof Length
      ? value.emu
      : new Length(
          value.value *
            ({ emu: 1, in: 914400, cm: 360000, mm: 36000, pt: 12700 }[value.unit] ?? NaN)
        ).emu;
  if (!Number.isSafeInteger(n) || Math.abs(n) > 27273042316900) invalid("Invalid table length.");
  return n;
}
function validateGridStorage(value: unknown): void {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > 250000
  )
    invalid("Grid arrays require plain dense data.");
  const entries = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(entries).length !== value.length + 1)
    invalid("Grid arrays require dense data.");
  for (let i = 0; i < value.length; i++) {
    const descriptor = entries[String(i)];
    if (!descriptor || !("value" in descriptor)) invalid("Grid arrays require stored entries.");
  }
  for (let i = 0; i < value.length; i++) {
    const row = value[i];
    if (
      !Array.isArray(row) ||
      Object.getPrototypeOf(row) !== Array.prototype ||
      row.length > 250000
    )
      invalid("Grid rows require plain arrays.");
    const columns = Object.getOwnPropertyDescriptors(row);
    if (Reflect.ownKeys(columns).length !== row.length + 1)
      invalid("Grid rows require dense data.");
    for (let j = 0; j < row.length; j++)
      if (!columns[String(j)] || !("value" in columns[String(j)]!))
        invalid("Grid cells require stored entries.");
  }
}
export function validateTableUpdate(update: TableUpdate, creating = false): void {
  dataObject(update, [
    "rows",
    "columns",
    "data",
    "cell",
    "text",
    "left",
    "top",
    "width",
    "height",
    "rowHeight",
    "columnWidth",
    "style",
    "fill",
    "borderColor",
    "borderWidth",
    "verticalAnchor",
    ...Object.keys(margins),
    ...flags
  ]);
  for (const k of ["rows", "columns"] as const)
    if (
      (creating || update[k] !== undefined) &&
      (!Number.isSafeInteger(update[k]) || update[k]! < 1 || update[k]! > 250000)
    )
      invalid("Table dimensions require positive bounded integers.");
  if (creating && update.rows! * update.columns! > 250000) invalid("Table cell budget exceeded.");
  for (const k of [
    "left",
    "top",
    "width",
    "height",
    "rowHeight",
    "columnWidth",
    "borderWidth",
    ...(Object.keys(margins) as (keyof typeof margins)[])
  ] as const) {
    const v = update[k];
    if (v === null && !["borderWidth", ...Object.keys(margins)].includes(k))
      invalid("This table length cannot be null.");
    if (v !== undefined && v !== null) {
      const n = emu(v);
      if (!["left", "top"].includes(k) && n < 0) invalid("Table sizes must be nonnegative.");
      if (["width", "height", "rowHeight", "columnWidth"].includes(k) && n === 0)
        invalid("Table dimensions must be positive.");
      if (Object.hasOwn(margins, k) && n > 2147483647) invalid("Cell margin is out of range.");
    }
    if (creating && ["left", "top", "width", "height"].includes(k) && v === undefined)
      invalid("Table creation requires a complete box.");
  }
  if (creating && (emu(update.width!) < update.columns! || emu(update.height!) < update.rows!))
    invalid("Table box must provide positive row and column sizes.");
  if (update.cell !== undefined) {
    dataObject(update.cell, ["row", "column"]);
    if (![update.cell.row, update.cell.column].every((n) => Number.isSafeInteger(n) && n >= 0))
      invalid("Cell coordinates require nonnegative integers.");
  }
  if (
    update.text !== undefined &&
    (typeof update.text !== "string" || !update.cell || update.data !== undefined)
  )
    invalid("Text requires one cell and cannot accompany data.");
  if (update.data !== undefined) validateGridStorage(update.data);
  if (
    update.data !== undefined &&
    (!Array.isArray(update.data) ||
      update.data.length > 250000 ||
      update.data.some(
        (row) =>
          !Array.isArray(row) ||
          row.length > 250000 ||
          row.some((text) => typeof text !== "string" || text.length > 1048576)
      ))
  )
    invalid("Table data requires a rectangular string grid.");
  if (update.style !== undefined && update.style !== null && typeof update.style !== "string")
    invalid("Style requires a string.");
  for (const k of ["fill", "borderColor"] as const) {
    const v = update[k];
    if (
      v !== undefined &&
      v !== null &&
      (typeof v !== "string" ||
        v.length !== 6 ||
        [...v].some((c) => !"0123456789abcdefABCDEF".includes(c)))
    )
      invalid("Color requires six hexadecimal digits.");
  }
  for (const k of flags)
    if (update[k] !== undefined && typeof update[k] !== "boolean")
      invalid("Table style switches require booleans.");
  if (
    update.verticalAnchor !== undefined &&
    update.verticalAnchor !== null &&
    !["top", "middle", "bottom"].includes(update.verticalAnchor)
  )
    invalid("Invalid vertical anchor.");
}
function table(node: XmlElement) {
  const graphic = child(
    node,
    "graphic",
    node.name.namespace.includes("purl")
      ? "http://purl.oclc.org/ooxml/drawingml/main"
      : "http://schemas.openxmlformats.org/drawingml/2006/main"
  );
  if (!graphic) invalid("Expected a table graphic frame.");
  const data = required(graphic, "graphicData");
  return required(data, "tbl");
}
function rowNodes(tbl: XmlElement) {
  return tbl.children.filter(
    (n) => n.name.namespace === tbl.name.namespace && n.name.localName === "tr"
  );
}
function cells(row: XmlElement) {
  return row.children.filter(
    (n) => n.name.namespace === row.name.namespace && n.name.localName === "tc"
  );
}
function textValue(doc: XmlPart, node: XmlElement): string {
  let value = "";
  const parser = new SaxesParser({ xmlns: false });
  parser.on("text", (t) => (value += t));
  parser.on("cdata", (t) => (value += t));
  parser.write(doc.markup(node, true)).close();
  return value;
}
function storedSize(value: string | undefined): number {
  const units: Readonly<Record<string, number>> = {
    mm: 36000,
    cm: 360000,
    in: 914400,
    pt: 12700,
    pc: 152400,
    pi: 152400
  };
  const suffix = value?.slice(-2) ?? "",
    factor = units[suffix],
    numeric = factor ? value!.slice(0, -2) : value;
  if (
    !numeric ||
    [...numeric].some(
      (c, i) =>
        !(
          "0123456789".includes(c) ||
          (factor && c === ".") ||
          (i === 0 && (c === "+" || c === "-"))
        )
    )
  )
    throw new OfficeError("invalid-xml", "Invalid stored table size.", "parse");
  const parsed = Number(numeric) * (factor ?? 1),
    n = Math.sign(parsed) * Math.round(Math.abs(parsed));
  if (
    !Number.isSafeInteger(n) ||
    Math.abs(n) > 27273042316900 ||
    (!factor && !Number.isInteger(parsed))
  )
    throw new OfficeError("invalid-xml", "Invalid stored table size.", "parse");
  return n;
}
function fillType(owner: XmlElement | undefined): string | null {
  return (
    owner?.children.find(
      (node) =>
        node.name.namespace === owner.name.namespace &&
        ["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"].includes(
          node.name.localName
        )
    )?.name.localName ?? null
  );
}
export function readTable(node: XmlElement, document: XmlPart) {
  try {
    const tbl = table(node),
      ns = tbl.name.namespace,
      rows = rowNodes(tbl),
      grid = required(tbl, "tblGrid"),
      cols = grid.children.filter((n) => n.name.namespace === ns && n.name.localName === "gridCol");
    if (!rows.length || !cols.length || rows.some((row) => cells(row).length !== cols.length))
      invalid("Table physical cell rows must match the logical grid.");
    const properties = child(tbl, "tblPr"),
      style = properties && child(properties, "tableStyleId");
    const records = rows.flatMap((row, r) =>
      cells(row).map((cell, c) => {
        const pr = child(cell, "tcPr"),
          body = required(cell, "txBody"),
          sf = pr && child(pr, "solidFill"),
          rgb = sf && child(sf, "srgbClr"),
          scheme = sf && child(sf, "schemeClr");
        const spanWidth = Number(attr(cell, "gridSpan") ?? 1),
          spanHeight = Number(attr(cell, "rowSpan") ?? 1),
          isSpanned = ["hMerge", "vMerge"].some((k) => ["1", "true"].includes(attr(cell, k) ?? ""));
        const border = (localName: string) => {
          const line = pr && child(pr, localName),
            fill = line && child(line, "solidFill"),
            rgb = fill && child(fill, "srgbClr"),
            theme = fill && child(fill, "schemeClr");
          return {
            fillType: fillType(line),
            color: rgb ? (attr(rgb, "val") ?? null) : null,
            themeColor: theme ? (attr(theme, "val") ?? null) : null,
            width: line && attr(line, "w") !== undefined ? Number(attr(line, "w")) : null
          };
        };
        return {
          borders: {
            left: border("lnL"),
            right: border("lnR"),
            top: border("lnT"),
            bottom: border("lnB")
          },
          row: r,
          column: c,
          text: new TextFrame({ ...document, root: body }).text,
          spanWidth,
          spanHeight,
          isSpanned,
          isMergeOrigin: !isSpanned && (spanWidth > 1 || spanHeight > 1),
          fillType: fillType(pr),
          fill: rgb ? (attr(rgb, "val") ?? null) : null,
          themeFill: scheme ? (attr(scheme, "val") ?? null) : null,
          marginLeft: pr && attr(pr, "marL") !== undefined ? Number(attr(pr, "marL")) : null,
          marginRight: pr && attr(pr, "marR") !== undefined ? Number(attr(pr, "marR")) : null,
          marginTop: pr && attr(pr, "marT") !== undefined ? Number(attr(pr, "marT")) : null,
          marginBottom: pr && attr(pr, "marB") !== undefined ? Number(attr(pr, "marB")) : null,
          verticalAnchor: pr
            ? ({ t: "top", ctr: "middle", b: "bottom" }[attr(pr, "anchor") ?? ""] ??
              attr(pr, "anchor") ??
              null)
            : null
        };
      })
    );
    return {
      ...readShape(node),
      rows: rows.length,
      columns: cols.length,
      rowHeights: rows.map((r) => storedSize(attr(r, "h"))),
      columnWidths: cols.map((c) => storedSize(attr(c, "w"))),
      style: style ? textValue(document, style) : null,
      firstRow: !!properties && ["1", "true"].includes(attr(properties, "firstRow") ?? ""),
      lastRow: !!properties && ["1", "true"].includes(attr(properties, "lastRow") ?? ""),
      firstCol: !!properties && ["1", "true"].includes(attr(properties, "firstCol") ?? ""),
      lastCol: !!properties && ["1", "true"].includes(attr(properties, "lastCol") ?? ""),
      horzBand: !!properties && ["1", "true"].includes(attr(properties, "bandRow") ?? ""),
      vertBand: !!properties && ["1", "true"].includes(attr(properties, "bandCol") ?? ""),
      cells: records,
      data: rows.map((_, r) =>
        records.slice(r * cols.length, (r + 1) * cols.length).map((c) => c.text)
      )
    };
  } catch (error) {
    if (error instanceof OfficeError && ["invalid-value", "unsupported-edit"].includes(error.code))
      throw new OfficeError("invalid-xml", error.message, "parse");
    throw error;
  }
}
export type TableRecord = ReturnType<typeof readTable>;
function divided(total: number, count: number): number[] {
  return Array.from(
    { length: count },
    (_, i) => Math.floor(total / count) + (i < total % count ? 1 : 0)
  );
}
function validateTableLocks(root: XmlElement, node: XmlElement, update: TableUpdate): void {
  const ancestry: XmlElement[] = [];
  const locate = (current: XmlElement): boolean => {
    ancestry.push(current);
    if (current === node) return true;
    for (const child of current.children) if (locate(child)) return true;
    ancestry.pop();
    return false;
  };
  if (!locate(root)) invalid("Table must belong to its XML document.");
  const moving = update.left !== undefined || update.top !== undefined;
  for (const owner of ancestry.filter((n) =>
    ["graphicFrame", "grpSp"].includes(n.name.localName)
  )) {
    const nv = owner.children.find((n) =>
      ["nvGraphicFramePr", "nvGrpSpPr"].includes(n.name.localName)
    );
    const inspect = (current: XmlElement): boolean =>
      current.attributes.some(
        (a) =>
          a.name.namespace === "" &&
          (a.name.localName === "noSelect" || (moving && a.name.localName === "noMove")) &&
          ["true", "1"].includes(a.value)
      ) || current.children.some(inspect);
    if (nv && inspect(nv)) unsupported("The selected table or ancestor is locked.");
  }
}
export function applyTableUpdate(
  document: XmlPart,
  node: XmlElement,
  update: TableUpdate
): XmlPart {
  validateTableUpdate(update);
  validateTableLocks(document.root, node, update);
  const before = readTable(node, document);
  if (
    (update.width !== undefined && emu(update.width) < before.columns) ||
    (update.height !== undefined && emu(update.height) < before.rows)
  )
    invalid("Table box must provide positive row and column sizes.");
  if (
    (update.rows !== undefined && update.rows !== before.rows) ||
    (update.columns !== undefined && update.columns !== before.columns)
  )
    unsupported("Changing grid dimensions requires a structural operation.");
  if (
    update.data !== undefined &&
    (update.data.length !== before.rows || update.data.some((row) => row.length !== before.columns))
  )
    unsupported("Table data must match the exact grid.");
  if (update.cell && (update.cell.row >= before.rows || update.cell.column >= before.columns))
    unsupported("Cell is outside the table grid.");
  if (
    update.text !== undefined &&
    before.cells[update.cell!.row * before.columns + update.cell!.column]!.isSpanned
  )
    unsupported("Text assignment requires a merge origin.");
  if (
    update.data &&
    before.cells.some((cell) => cell.isSpanned && update.data![cell.row]![cell.column] !== "")
  )
    unsupported("Continuation cells must not own text.");
  let result = document;
  const frame = () => nodeFor(result.root, String(before.shapeId)),
    tbl = () => table(frame()),
    ns = table(node).name.namespace;
  const name = (localName: string) => ({ namespace: ns, localName }),
    at = (localName: string, value: string | null) => ({ namespace: "", localName, value });
  const merge = (target: XmlElement, edit: XmlMerge) => {
    result = result.merge(target, edit);
  };
  let heights =
      update.height === undefined
        ? [...before.rowHeights]
        : divided(emu(update.height), before.rows),
    widths =
      update.width === undefined
        ? [...before.columnWidths]
        : divided(emu(update.width), before.columns);
  if (update.rowHeight !== undefined)
    heights = heights.map((n, i) =>
      !update.cell || i === update.cell.row ? emu(update.rowHeight!) : n
    );
  if (update.columnWidth !== undefined)
    widths = widths.map((n, i) =>
      !update.cell || i === update.cell.column ? emu(update.columnWidth!) : n
    );
  for (const sizes of [heights, widths]) {
    const total = sizes.reduce((sum, n) => sum + n, 0);
    if (!Number.isSafeInteger(total) || Math.abs(total) > 27273042316900)
      invalid("Table size total exceeds drawing coordinate bounds.");
  }
  heights.forEach((h, i) => {
    if (h !== before.rowHeights[i])
      merge(rowNodes(tbl())[i]!, { attributes: [at("h", String(h))] });
  });
  widths.forEach((w, i) => {
    if (w !== before.columnWidths[i])
      merge(required(tbl(), "tblGrid").children[i]!, { attributes: [at("w", String(w))] });
  });
  const xfrm = required(frame(), "xfrm");
  const shapeEdits: { name: { namespace: string; localName: string }; merge: XmlMerge }[] = [];
  if (update.left !== undefined || update.top !== undefined)
    shapeEdits.push({
      name: name("off"),
      merge: {
        attributes: [
          ...(update.left === undefined ? [] : [at("x", String(emu(update.left)))]),
          ...(update.top === undefined ? [] : [at("y", String(emu(update.top)))])
        ]
      }
    });
  if (
    update.width !== undefined ||
    update.height !== undefined ||
    update.rowHeight !== undefined ||
    update.columnWidth !== undefined
  )
    shapeEdits.push({
      name: name("ext"),
      merge: {
        attributes: [
          at("cx", String(widths.reduce((a, b) => a + b, 0))),
          at("cy", String(heights.reduce((a, b) => a + b, 0)))
        ]
      }
    });
  if (shapeEdits.length)
    merge(xfrm, { children: { sequence: [name("off"), name("ext")], upsert: shapeEdits } });
  const flagAttrs = flags
    .filter((k) => update[k] !== undefined && update[k] !== before[k as keyof typeof before])
    .map((k) =>
      at(k === "horzBand" ? "bandRow" : k === "vertBand" ? "bandCol" : k, update[k] ? "1" : "0")
    );
  if (flagAttrs.length || (update.style !== undefined && update.style !== before.style)) {
    merge(tbl(), {
      children: {
        sequence: ["tblPr", "tblGrid"].map(name),
        upsert: [{ name: name("tblPr"), merge: { attributes: flagAttrs } }]
      }
    });
    if (update.style !== undefined && update.style !== before.style) {
      const pr = required(tbl(), "tblPr");
      merge(pr, {
        children: {
          sequence: [name("tableStyleId"), name("extLst")],
          remove: update.style === null ? [name("tableStyleId")] : [],
          upsert: update.style === null ? [] : [{ name: name("tableStyleId"), merge: {} }]
        }
      });
      if (update.style !== null)
        result = result.setText(required(required(tbl(), "tblPr"), "tableStyleId"), update.style);
    }
  }
  for (const record of before.cells) {
    const selected =
      !update.cell || (record.row === update.cell.row && record.column === update.cell.column);
    const current = () => cells(rowNodes(tbl())[record.row]!)[record.column]!;
    const text = update.data?.[record.row]?.[record.column] ?? (selected ? update.text : undefined);
    if (text !== undefined && text !== record.text)
      result = applyFrameFormatting(result, required(current(), "txBody"), { text });
    if (!selected) continue;
    const attributes = Object.entries(margins).flatMap(([key, localName]) => {
      const value = update[key as keyof typeof margins];
      return value === undefined ||
        (value === null && record[key as keyof typeof margins] === null) ||
        (value !== null && emu(value) === record[key as keyof typeof margins])
        ? []
        : [at(localName, value === null ? null : String(emu(value)))];
    });
    if (update.verticalAnchor !== undefined && update.verticalAnchor !== record.verticalAnchor)
      attributes.push(
        at(
          "anchor",
          update.verticalAnchor === null
            ? null
            : { top: "t", middle: "ctr", bottom: "b" }[update.verticalAnchor]
        )
      );
    const upsert: { name: { namespace: string; localName: string }; merge: XmlMerge }[] = [];
    const fillEdit = (color: string | null): XmlMerge => ({
      children: {
        sequence: ["noFill", "solidFill", "gradFill", "pattFill", "blipFill", "grpFill"].map(name),
        remove: ["noFill", "solidFill", "gradFill", "pattFill", "blipFill", "grpFill"]
          .filter((n) => n !== (color === null ? "noFill" : "solidFill"))
          .map(name),
        upsert: [
          {
            name: name(color === null ? "noFill" : "solidFill"),
            merge:
              color === null
                ? {}
                : {
                    children: {
                      sequence: [
                        "srgbClr",
                        "schemeClr",
                        "scrgbClr",
                        "hslClr",
                        "sysClr",
                        "prstClr"
                      ].map(name),
                      remove: ["schemeClr", "scrgbClr", "hslClr", "sysClr", "prstClr"].map(name),
                      upsert: [
                        {
                          name: name("srgbClr"),
                          merge: { attributes: [at("val", color.toUpperCase())] }
                        }
                      ]
                    }
                  }
          }
        ]
      }
    });
    if (update.borderColor !== undefined || update.borderWidth !== undefined)
      for (const edge of ["lnL", "lnR", "lnT", "lnB"])
        upsert.push({
          name: name(edge),
          merge: {
            ...(update.borderColor === undefined ? {} : fillEdit(update.borderColor)),
            ...(update.borderWidth === undefined
              ? {}
              : {
                  attributes: [
                    at("w", update.borderWidth === null ? null : String(emu(update.borderWidth)))
                  ]
                })
          }
        });
    const fill = update.fill === undefined ? undefined : fillEdit(update.fill).children!;
    if (attributes.length || upsert.length || fill)
      merge(current(), {
        children: {
          sequence: [name("txBody"), name("tcPr"), name("extLst")],
          upsert: [
            {
              name: name("tcPr"),
              merge: {
                attributes,
                children: {
                  sequence: [
                    "lnL",
                    "lnR",
                    "lnT",
                    "lnB",
                    "lnTlToBr",
                    "lnBlToTr",
                    "cell3D",
                    "noFill",
                    "solidFill",
                    "gradFill",
                    "blipFill",
                    "pattFill",
                    "grpFill",
                    "headers",
                    "extLst"
                  ].map(name),
                  remove: fill?.remove ?? [],
                  upsert: [...upsert, ...(fill?.upsert ?? [])]
                }
              }
            }
          ]
        }
      });
  }
  return result;
}
export function createTableXml(
  id: number,
  update: TableUpdate,
  p = "http://schemas.openxmlformats.org/presentationml/2006/main"
): string {
  validateTableUpdate(update, true);
  if (!Number.isInteger(id) || id < 1 || id > 4294967295) invalid("Invalid table identity.");
  if (
    ![
      "http://schemas.openxmlformats.org/presentationml/2006/main",
      "http://purl.oclc.org/ooxml/presentationml/main"
    ].includes(p)
  )
    invalid("Unsupported presentation dialect.");
  const a = p.includes("purl")
    ? "http://purl.oclc.org/ooxml/drawingml/main"
    : "http://schemas.openxmlformats.org/drawingml/2006/main";
  const rows = divided(emu(update.height!), update.rows!),
    cols = divided(emu(update.width!), update.columns!);
  const doc = parseXmlPart(
    new TextEncoder().encode(
      `<p:graphicFrame xmlns:p="${p}" xmlns:a="${a}"><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${emu(update.left!)}" y="${emu(update.top!)}"/><a:ext cx="${emu(update.width!)}" cy="${emu(update.height!)}"/></p:xfrm><a:graphic><a:graphicData uri="${a.slice(0, -5)}/table"><a:tbl><a:tblPr/><a:tblGrid>${cols.map((w) => `<a:gridCol w="${w}"/>`).join("")}</a:tblGrid>${rows.map((h) => `<a:tr h="${h}">${cols.map(() => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody><a:tcPr/></a:tc>`).join("")}</a:tr>`).join("")}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
    ),
    { maxBytes: 64000000, maxNodes: 4000000, maxDepth: 64 }
  );
  const result = applyTableUpdate(doc, doc.root, update);
  return result.markup(result.root, true);
}
