import type { ModelStore, ModelRef } from "./model-store.js";
import { InputTypeError, InvalidValueError } from "./archive.js";
import { BoundsError } from "./model-errors.js";
import { numericSequence } from "./numeric-index.js";
import type { XmlElement } from "./package-xml.js";
import { UnsupportedEditError } from "./xml-write.js";
import { mergedTableGrid, editMergedTable } from "./table-merge.js";
import { tableRows } from "./table-rows.js";
import {
  MarkupCompatibility,
  documentCompatibilityProfile,
  type CompatibilityContent
} from "./compatibility.js";
import {
  styleChild as child,
  styleAttribute as attr,
  styleInteger,
  styleToggle
} from "./style-properties.js";
import {
  Length,
  WD_TABLE_ALIGNMENT,
  WD_TABLE_DIRECTION,
  WD_CELL_VERTICAL_ALIGNMENT,
  WD_ROW_HEIGHT_RULE,
  type Length as LengthValue
} from "./formatting-values.js";
import type { DocxEnumValue, DocxLength, DocxEnumNames } from "./operation-types.js";
import { twips, xmlValue } from "./create-content.js";
import { runElementOpen } from "./run-properties.js";

import type { Paragraph } from "./block-model.js";
import type { TableStyle, ParagraphStyle } from "./styles-model.js";

const orders: Record<string, string[]> = {
  tblPr:
    "tblStyle tblpPr tblOverlap bidiVisual tblStyleRowBandSize tblStyleColBandSize tblW jc tblCellSpacing tblInd tblBorders shd tblLayout tblCellMar tblLook tblCaption tblDescription tblPrChange".split(
      " "
    ),
  trPr: "cnfStyle divId gridBefore gridAfter wBefore wAfter cantSplit trHeight tblHeader tblCellSpacing jc hidden ins del trPrChange".split(
    " "
  ),
  tcPr: "cnfStyle tcW gridSpan hMerge vMerge tcBorders shd noWrap tcMar textDirection tcFitText vAlign hideMark cellIns cellDel cellMerge tcPrChange".split(
    " "
  )
};
function mark(w: string, tag: string, attrs: Record<string, string> = {}, body = ""): string {
  return `<tm:${tag} xmlns:tm="${w}"${Object.entries(attrs)
    .map(([k, v]) => ` tm:${k}="${xmlValue(v)}"`)
    .join("")}>${body}</tm:${tag}>`;
}
function index(length: number, value: number): number {
  if (!Number.isSafeInteger(value)) throw new InputTypeError("Expected an integer index.");
  const result = value < 0 ? length + value : value;
  if (result < 0 || result >= length) throw new BoundsError("Table index is out of range.");
  return result;
}
function enumName<E extends keyof DocxEnumNames>(
  value: DocxEnumValue<E> | null,
  family: E,
  names: Record<string, string>
): string | null {
  if (value === null) return null;
  if (!value || value.enum !== family || !Object.hasOwn(names, value.name))
    throw new TypeError(`Expected ${family}.`);
  return names[value.name]!;
}
function readEnum<E extends keyof DocxEnumNames>(
  raw: string | undefined,
  symbols: { readonly [K in DocxEnumNames[E]]: DocxEnumValue<E> },
  names: Record<string, string>
): DocxEnumValue<E> | null {
  if (raw === undefined) return null;
  const name = Object.keys(names).find((k) => names[k] === raw);
  if (!name) throw new TypeError("Unknown stored table enumeration value.");
  return symbols[name as DocxEnumNames[E]]!;
}
function properties(
  store: ModelStore,
  ref: ModelRef,
  container: string,
  tag: string,
  values: Record<string, string> | null
): void {
  store.change(ref.part, (xml) => {
    const owner = store.node(ref),
      props = child(owner, container),
      old = child(props, tag);
    if (!values && !old) return;
    if (old && values) {
      const prefix = [...old.namespaces].find(([p, namespace]) => p && namespace === owner.namespace)?.[0] ?? "tm";
      const attributes = old.attributes.map(a =>
        a.namespace === owner.namespace && Object.hasOwn(values, a.localName) ? { ...a, value: values[a.localName]! } : a
      );
      for (const [localName, value] of Object.entries(values))
        if (!attributes.some(a => a.namespace === owner.namespace && a.localName === localName))
          attributes.push({ name: `${prefix}:${localName}`, namespace: owner.namespace, localName, value });
      const namespaces = new Map(old.namespaces);
      namespaces.set(prefix, owner.namespace);
      xml.replaceElement(old, runElementOpen({ ...old, attributes, namespaces }) + xml.sourceXml(old, new Map(), true) + `</${old.name}>`);
      return;
    }
    const markup = values ? mark(owner.namespace, tag, values) : "";
    if (old) xml.replaceElement(old, markup);
    else if (props) {
      const order = orders[container]!;
      xml.insertChildren(
        props,
        markup,
        props.children.find(
          (n) => n.namespace === owner.namespace && order.indexOf(n.localName) > order.indexOf(tag)
        )
      );
    } else
      xml.insertChildren(owner, mark(owner.namespace, container, {}, markup),
        container === "trPr" && owner.children[0]?.localName === "tblPrEx" ? owner.children[1] : owner.children[0]);
  });
}
function storedLength(node: XmlElement | undefined, key = "w"): LengthValue | null {
  const raw = attr(node, key);
  if (raw !== undefined) {
    const scale = ({ in: 914400, cm: 360000, mm: 36000, pt: 12700, pc: 152400, pi: 152400 } as Record<string, number>)[raw.slice(-2)];
    if (scale !== undefined) {
      const magnitude = raw.slice(0, -2);
      if (!magnitude || [...magnitude].some(c => !"0123456789.+-".includes(c)))
        throw new InputTypeError("Invalid stored table length.");
      return Length(Number(magnitude) * scale);
    }
  }
  const n = styleInteger(raw);
  return n === null ? null : Length(n * 635);
}
type TableGrid = ReturnType<typeof mergedTableGrid> & { original(node: XmlElement): XmlElement };
function activeGrid(store: ModelStore, ref: ModelRef): TableGrid {
  const table = store.node(ref),
    active = new Map<XmlElement, XmlElement[]>();
  const collect = (content: readonly CompatibilityContent[]) => {
    for (const item of content)
      if ("source" in item) {
        active.set(
          item.source,
          item.content.filter((i) => "source" in i).map((i) => i.source)
        );
        collect(item.content);
      }
  };
  collect(
    new MarkupCompatibility(
      store.xml(ref.part).root,
      documentCompatibilityProfile,
      store.context.budget
    ).content
  );
  const rows = tableRows(
    table,
    (n) => n,
    (n) => active.get(n) ?? [],
    store.context.budget
  );
  if (!rows.length) {
    const columns = child(table, "tblGrid")?.children.filter(n => n.namespace === table.namespace && n.localName === "gridCol") ?? [];
    store.context.budget.check("tableColumns", columns.length);
    return { rows: [], columns, owners: [], physical: [], slots: [], original: n => n };
  }
  const copy = (n: XmlElement): XmlElement => ({
    ...n,
    children: (active.get(n) ?? n.children).map(copy)
  });
  const copied = copy(table),
    view = {
      ...copied,
      children: [
        ...copied.children.filter((n) => n.localName !== "tr" && n.localName !== "sdt"),
        ...rows.map(copy)
      ]
    };
  const grid = mergedTableGrid(view, store.context.budget);
  const originals = new Map<XmlElement, XmlElement>();
  const match = (a: XmlElement, b: XmlElement) => {
    originals.set(b, a);
    const kids = active.get(a) ?? a.children;
    kids.forEach((n, i) => {
      const c = b.children[i];
      if (c) match(n, c);
    });
  };
  // Match rows independently because native repeat wrappers are flattened above.
  const gridSource = (active.get(table) ?? table.children).find(
    (n) => n.namespace === table.namespace && n.localName === "tblGrid"
  );
  if (gridSource) match(gridSource, child(view, "tblGrid")!);
  rows.forEach((row, i) => match(row, grid.rows[i]!));
  return { ...grid, original: (n: XmlElement) => originals.get(n) ?? n };
}

export class Table {
  private readonly cellCache = new Map<number, _Cell>();
  readonly rows: _Rows;
  readonly columns: _Columns;
  constructor(
    readonly store: ModelStore,
    readonly ref: ModelRef
  ) {
    this.rows = new _Rows(this);
    this.columns = new _Columns(this);
  }
  get part() {
    this.store.node(this.ref);
    return this.store.part(this.ref.part);
  }
  get element() {
    return this.store.element(this.ref);
  }
  get table(): Table {
    this.store.node(this.ref);
    return this;
  }
  grid(): TableGrid {
    return activeGrid(this.store, this.ref);
  }
  logicalCell(node: XmlElement): _Cell {
    const ref = this.store.ref(this.ref.part, node);
    let cell = this.cellCache.get(ref.id);
    if (!cell) {
      cell = new _Cell(this.store, ref, this);
      this.cellCache.set(ref.id, cell);
    }
    return cell;
  }
  cell(row_idx: number, col_idx: number): _Cell {
    const grid = this.grid(),
      row = index(grid.rows.length, row_idx),
      column = index(grid.columns.length, col_idx),
      owner = grid.slots[row]?.[column];
    if (!owner) throw new BoundsError("The selected grid slot is omitted.");
    return this.logicalCell(grid.original(owner.node));
  }
  row_cells(row_idx: number): _Cell[] {
    const grid = this.grid(),
      row = index(grid.rows.length, row_idx);
    return grid.slots[row]!.filter((o) => o !== undefined).map((o) =>
      this.logicalCell(grid.original(o.node))
    );
  }
  column_cells(column_idx: number): _Cell[] {
    const grid = this.grid(),
      column = index(grid.columns.length, column_idx);
    return grid.slots.flatMap((row) =>
      row[column] ? [this.logicalCell(grid.original(row[column]!.node))] : []
    );
  }
  get alignment(): DocxEnumValue<"WD_TABLE_ALIGNMENT"> | null {
    return readEnum(
      attr(child(child(this.store.node(this.ref), "tblPr"), "jc"), "val"),
      WD_TABLE_ALIGNMENT,
      { LEFT: "left", CENTER: "center", RIGHT: "right" }
    );
  }
  set alignment(value: DocxEnumValue<"WD_TABLE_ALIGNMENT"> | null) {
    const name = enumName(value, "WD_TABLE_ALIGNMENT", {
      LEFT: "left",
      CENTER: "center",
      RIGHT: "right"
    });
    properties(this.store, this.ref, "tblPr", "jc", name === null ? null : { val: name });
  }
  get autofit(): boolean {
    return attr(child(child(this.store.node(this.ref), "tblPr"), "tblLayout"), "type") !== "fixed";
  }
  set autofit(value: boolean) {
    if (typeof value !== "boolean") throw new TypeError("Expected a boolean.");
    properties(this.store, this.ref, "tblPr", "tblLayout", { type: value ? "autofit" : "fixed" });
  }
  get table_direction(): DocxEnumValue<"WD_TABLE_DIRECTION"> | null {
    const value = styleToggle(child(child(this.store.node(this.ref), "tblPr"), "bidiVisual"));
    return value === null ? null : value ? WD_TABLE_DIRECTION.RTL : WD_TABLE_DIRECTION.LTR;
  }
  set table_direction(value: DocxEnumValue<"WD_TABLE_DIRECTION"> | null) {
    const name = enumName(value, "WD_TABLE_DIRECTION", { LTR: "0", RTL: "1" });
    properties(this.store, this.ref, "tblPr", "bidiVisual", name === null ? null : { val: name });
  }
  get style(): TableStyle | null {
    return this.store.tableStyle(
      attr(child(child(this.store.node(this.ref), "tblPr"), "tblStyle"), "val") ?? null,
      this.ref.part
    );
  }
  set style(value: string | TableStyle | null) {
    const id = this.store.tableStyleId(value, this.ref.part);
    properties(this.store, this.ref, "tblPr", "tblStyle", id === null ? null : { val: id });
  }
  add_row(): _Row {
    const grid = this.grid();
    if (!grid.columns.length) throw new InvalidValueError("Adding a row requires declared columns.");
    this.store.change(this.ref.part, (xml) => {
      const table = this.store.node(this.ref),
        cells = grid.columns
          .map((c) =>
            mark(
              table.namespace,
              "tc",
              {},
              mark(
                table.namespace,
                "tcPr",
                {},
                mark(table.namespace, "tcW", { w: attr(c, "w") ?? "0", type: "dxa" })
              ) + mark(table.namespace, "p")
            )
          )
          .join("");
      xml.insertChildren(table, mark(table.namespace, "tr", {}, cells));
    });
    return this.rows.at(-1);
  }
  add_column(width: DocxLength): _Column {
    const value = String(twips(width, false)),
      grid = this.grid(),
      rowRefs = grid.rows.map((row) => this.store.ref(this.ref.part, grid.original(row)));
    if (
      grid.physical.some(
        (cells, i) =>
          cells.some((p) => p.span !== 1 || p.owner.rowSpan !== 1) ||
          grid.slots[i]!.filter(Boolean).length !== grid.columns.length
      )
    )
      throw new UnsupportedEditError("Adding columns requires an unmerged rectangular table.");
    this.store.change(this.ref.part, (xml) => {
      const table = this.store.node(this.ref),
        decl = child(table, "tblGrid")!;
      xml.insertChildren(decl, mark(table.namespace, "gridCol", { w: value }));
      for (const row of rowRefs)
        xml.insertChildren(
          this.store.node(row),
          mark(
            table.namespace,
            "tc",
            {},
            mark(
              table.namespace,
              "tcPr",
              {},
              mark(table.namespace, "tcW", { w: value, type: "dxa" })
            ) + mark(table.namespace, "p")
          )
        );
    });
    return this.columns.at(-1);
  }
}
export class _Cell {
  constructor(
    readonly store: ModelStore,
    readonly ref: ModelRef,
    private readonly owner: Table
  ) {}
  get table(): Table {
    this.store.node(this.ref);
    return this.owner;
  }
  get part() {
    this.store.node(this.ref);
    return this.store.part(this.ref.part);
  }
  get element() {
    return this.store.element(this.ref);
  }
  get grid_span(): number {
    return Number(attr(child(child(this.store.node(this.ref), "tcPr"), "gridSpan"), "val") ?? 1);
  }
  *iter_inner_content(): Iterable<Paragraph | Table> {
    yield* this.store.blocks(this.ref);
  }
  get paragraphs(): Paragraph[] {
    return [...this.iter_inner_content()].filter((n): n is Paragraph => !(n instanceof Table));
  }
  get tables(): Table[] {
    return [...this.iter_inner_content()].filter((n): n is Table => n instanceof Table);
  }
  get text(): string {
    return this.paragraphs.map((p) => p.text).join("\n");
  }
  set text(value: string) {
    if (typeof value !== "string") throw new TypeError("Expected text.");
    this.store.cellText(this.ref, value);
  }
  add_paragraph(text = "", style: string | ParagraphStyle | null = null): Paragraph {
    return this.store.addParagraph(this.ref, text, style);
  }
  add_table(rows: number, cols: number): Table {
    return this.store.addTable(this.ref, rows, cols, this.width ?? Length(914400));
  }
  get vertical_alignment(): DocxEnumValue<"WD_CELL_VERTICAL_ALIGNMENT"> | null {
    return readEnum(
      attr(child(child(this.store.node(this.ref), "tcPr"), "vAlign"), "val"),
      WD_CELL_VERTICAL_ALIGNMENT,
      { TOP: "top", CENTER: "center", BOTTOM: "bottom", BOTH: "both" }
    );
  }
  set vertical_alignment(value: DocxEnumValue<"WD_CELL_VERTICAL_ALIGNMENT"> | null) {
    const name = enumName(value, "WD_CELL_VERTICAL_ALIGNMENT", {
      TOP: "top",
      CENTER: "center",
      BOTTOM: "bottom",
      BOTH: "both"
    });
    properties(this.store, this.ref, "tcPr", "vAlign", name === null ? null : { val: name });
  }
  get width(): LengthValue | null {
    const node = child(child(this.store.node(this.ref), "tcPr"), "tcW");
    return attr(node, "type") === "dxa" ? storedLength(node) : null;
  }
  set width(value: DocxLength | null) {
    properties(
      this.store,
      this.ref,
      "tcPr",
      "tcW",
      value === null ? null : { w: String(twips(value, false)), type: "dxa" }
    );
  }
  merge(other_cell: _Cell): _Cell {
    const tableOwner = this.table;
    if (!(other_cell instanceof _Cell) || other_cell.table !== this.table)
      throw new TypeError("Merge requires cells from the same table.");
    const grid = this.table.grid(),
      a = grid.owners.find((o) => grid.original(o.node) === this.store.node(this.ref))!,
      b = grid.owners.find((o) => grid.original(o.node) === this.store.node(other_cell.ref))!;
    for (const [start, size] of [["row", "rowSpan"], ["column", "columnSpan"]] as const) {
      const aStart = a[start], bStart = b[start], aEnd = aStart + a[size], bEnd = bStart + b[size];
      if ((aStart === bStart && aEnd !== bEnd) ||
          (aStart < bStart && aEnd > bEnd) ||
          (bStart < aStart && bEnd > aEnd))
        throw new InvalidValueError("Merge endpoints do not define a rectangle.");
    }
    const top = Math.min(a.row, b.row),
      left = Math.min(a.column, b.column),
      bottom = Math.max(a.row + a.rowSpan - 1, b.row + b.rowSpan - 1),
      right = Math.max(a.column + a.columnSpan - 1, b.column + b.columnSpan - 1);
    const coordinate = (r: number, c: number) => {
      let s = "",
        n = c + 1;
      while (n) {
        n--;
        s = String.fromCharCode(65 + (n % 26)) + s;
        n = Math.floor(n / 26);
      }
      return s + (r + 1);
    };
    this.store.change(this.ref.part, (xml) => {
      const table = this.store.node(this.table.ref);
      xml.replaceElement(
        table,
        editMergedTable(
          xml,
          table,
          table,
          "tables.merge",
          { from: coordinate(top, left), to: coordinate(bottom, right), join: "paragraphs" },
          this.store.context.budget
        )
      );
    });
    return tableOwner.cell(top, left);
  }
}
export class _Row {
  constructor(
    private readonly owner: Table,
    readonly ref: ModelRef
  ) {}
  get table(): Table {
    this.owner.store.node(this.ref);
    return this.owner;
  }
  get part() {
    return this.table.part;
  }
  get element() {
    return this.table.store.element(this.ref);
  }
  get cells(): readonly _Cell[] {
    const grid = this.table.grid(),
      row = grid.rows.findIndex((n) => grid.original(n) === this.table.store.node(this.ref));
    return this.table.row_cells(row);
  }
  get grid_cols_before(): number {
    return Number(
      attr(child(child(this.table.store.node(this.ref), "trPr"), "gridBefore"), "val") ?? 0
    );
  }
  get grid_cols_after(): number {
    return Number(
      attr(child(child(this.table.store.node(this.ref), "trPr"), "gridAfter"), "val") ?? 0
    );
  }
  get height(): LengthValue | null {
    return storedLength(child(child(this.table.store.node(this.ref), "trPr"), "trHeight"), "val");
  }
  set height(value: DocxLength | null) {
    if (value === null) this.clearHeightAttribute("val");
    else
      properties(this.table.store, this.ref, "trPr", "trHeight", {
        val: String(twips(value, false))
      });
  }
  get height_rule(): DocxEnumValue<"WD_ROW_HEIGHT_RULE"> | null {
    const n = child(child(this.table.store.node(this.ref), "trPr"), "trHeight");
    return n
      ? readEnum(attr(n, "hRule") ?? "atLeast", WD_ROW_HEIGHT_RULE, {
          AUTO: "auto",
          AT_LEAST: "atLeast",
          EXACTLY: "exact"
        })
      : null;
  }
  set height_rule(value: DocxEnumValue<"WD_ROW_HEIGHT_RULE"> | null) {
    const name = enumName(value, "WD_ROW_HEIGHT_RULE", {
      AUTO: "auto",
      AT_LEAST: "atLeast",
      EXACTLY: "exact"
    });
    if (name === null) this.clearHeightAttribute("hRule");
    else properties(this.table.store, this.ref, "trPr", "trHeight", { hRule: name });
  }
  private clearHeightAttribute(name: string): void {
    this.table.store.change(this.ref.part, (xml) => {
      const node = child(child(this.table.store.node(this.ref), "trPr"), "trHeight");
      if (node)
        if (!node.attributes.some(a => a.namespace === node.namespace && a.localName !== name) &&
            !node.content.some(c => c.kind !== "text" || c.text.trim())) xml.replaceElement(node, "");
        else xml.setQualifiedAttribute(node, { namespace: node.namespace, localName: name }, null);
    });
  }
}
export class _Column {
  constructor(
    private readonly owner: Table,
    readonly ref: ModelRef
  ) {}
  get table(): Table {
    this.owner.store.node(this.ref);
    return this.owner;
  }
  get part() {
    return this.table.part;
  }
  get element() {
    return this.table.store.element(this.ref);
  }
  get cells(): readonly _Cell[] {
    const grid = this.table.grid(),
      col = grid.columns.findIndex((n) => grid.original(n) === this.table.store.node(this.ref));
    return this.table.column_cells(col);
  }
  get width(): LengthValue | null {
    return storedLength(this.table.store.node(this.ref));
  }
  set width(value: DocxLength | null) {
    this.table.store.change(this.ref.part, (xml) => {
      xml.setQualifiedAttribute(
        this.table.store.node(this.ref),
        { namespace: this.table.store.node(this.ref).namespace, localName: "w" },
        value === null ? null : String(twips(value, false))
      );
    });
  }
}
export class _Rows implements Iterable<_Row> {
  readonly [index: number]: _Row;
  private readonly cache = new Map<number, _Row>();
  constructor(private readonly owner: Table) {
    return numericSequence(this);
  }
  get table(): Table {
    this.owner.store.node(this.owner.ref);
    return this.owner;
  }
  get part() {
    return this.table.part;
  }
  get length(): number {
    return this.table.grid().rows.length;
  }
  slice(start = 0, end = this.length): _Row[] {
    for (const value of [start, end])
      if (!Number.isSafeInteger(value))
        throw new InputTypeError("Expected safe integer slice bounds.");
    return [...this].slice(start, end);
  }
  at(value: number): _Row {
    const grid = this.table.grid(),
      node = grid.original(grid.rows[index(grid.rows.length, value)]!),
      ref = this.table.store.ref(this.table.ref.part, node);
    let row = this.cache.get(ref.id);
    if (!row) {
      row = new _Row(this.table, ref);
      this.cache.set(ref.id, row);
    }
    return row;
  }
  *[Symbol.iterator](): Iterator<_Row> {
    for (let i = 0; i < this.length; i++) yield this.at(i);
  }
}
export class _Columns implements Iterable<_Column> {
  readonly [index: number]: _Column;
  private readonly cache = new Map<number, _Column>();
  constructor(private readonly owner: Table) {
    return numericSequence(this);
  }
  get table(): Table {
    this.owner.store.node(this.owner.ref);
    return this.owner;
  }
  get part() {
    return this.table.part;
  }
  get length(): number {
    return this.table.grid().columns.length;
  }
  at(value: number): _Column {
    const grid = this.table.grid(),
      node = grid.original(grid.columns[index(grid.columns.length, value)]!),
      ref = this.table.store.ref(this.table.ref.part, node);
    let col = this.cache.get(ref.id);
    if (!col) {
      col = new _Column(this.table, ref);
      this.cache.set(ref.id, col);
    }
    return col;
  }
  *[Symbol.iterator](): Iterator<_Column> {
    for (let i = 0; i < this.length; i++) yield this.at(i);
  }
}
