import { OfficeError } from "./errors.js";
import { Length } from "./length.js";
import { required } from "./masters.js";
import { nodeFor } from "./shape-operations.js";
import { TextFrame } from "./text-frames.js";
import { MSO_VERTICAL_ANCHOR } from "./text-frame-enums.js";
import { applyTableUpdate, readTable, type TableUpdate } from "./tables.js";
import { parseXmlPart, type XmlElement, type XmlPart } from "./xml.js";
function position(index: number, length: number): void {
  if (!Number.isSafeInteger(index) || index < 0 || index >= length)
    throw new OfficeError(
      "invalid-selection",
      "Table position is outside the collection.",
      "select"
    );
}
function indexed<T extends { get(index: number): unknown }>(collection: T): T {
  return new Proxy(collection, {
    get(target, key, receiver) {
      if (typeof key === "string" && key !== "" && String(Number(key)) === key)
        return target.get(Number(key));
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      if (typeof key === "string" && key !== "" && String(Number(key)) === key)
        throw new OfficeError(
          "invalid-value",
          "Table collections cannot replace entries.",
          "usage"
        );
      return Reflect.set(target, key, value, receiver);
    }
  });
}
export class Table {
  #xml: XmlPart;
  readonly #id: number;
  constructor(xml: XmlPart, shapeId?: number) {
    this.#xml = xml;
    this.#id = shapeId ?? readTable(xml.root, xml).shapeId;
    readTable(this.element, xml);
  }
  get xml(): XmlPart {
    return this.#xml;
  }
  get element(): XmlElement {
    return nodeFor(this.#xml.root, String(this.#id));
  }
  get rows(): TableRows {
    return new TableRows(this);
  }
  get columns(): TableColumns {
    return new TableColumns(this);
  }
  cell(row: number, column: number): TableCell {
    position(row, this.rows.length);
    position(column, this.columns.length);
    return new TableCell(this, row, column);
  }
  *iter_cells(): IterableIterator<TableCell> {
    for (let row = 0; row < this.rows.length; row++)
      for (let column = 0; column < this.columns.length; column++) yield this.cell(row, column);
  }
  get first_row(): boolean {
    return readTable(this.element, this.#xml).firstRow;
  }
  set first_row(value: boolean) {
    this.#xml = applyTableUpdate(this.#xml, this.element, { firstRow: value });
  }
  get last_row(): boolean {
    return readTable(this.element, this.#xml).lastRow;
  }
  set last_row(value: boolean) {
    this.#xml = applyTableUpdate(this.#xml, this.element, { lastRow: value });
  }
  get first_col(): boolean {
    return readTable(this.element, this.#xml).firstCol;
  }
  set first_col(value: boolean) {
    this.#xml = applyTableUpdate(this.#xml, this.element, { firstCol: value });
  }
  get last_col(): boolean {
    return readTable(this.element, this.#xml).lastCol;
  }
  set last_col(value: boolean) {
    this.#xml = applyTableUpdate(this.#xml, this.element, { lastCol: value });
  }
  get horz_banding(): boolean {
    return readTable(this.element, this.#xml).horzBand;
  }
  set horz_banding(value: boolean) {
    this.#xml = applyTableUpdate(this.#xml, this.element, { horzBand: value });
  }
  get vert_banding(): boolean {
    return readTable(this.element, this.#xml).vertBand;
  }
  set vert_banding(value: boolean) {
    this.#xml = applyTableUpdate(this.#xml, this.element, { vertBand: value });
  }
  /** Applies one validated change while keeping previously returned cell handles live. */
  update(options: TableUpdate): void {
    this.#xml = applyTableUpdate(this.#xml, this.element, options);
  }
  bindTextFrame(row: number, column: number): TextFrame {
    const body = () => {
      const graphic = this.element.children.find((n) => n.name.localName === "graphic")!;
      const tbl = required(required(graphic, "graphicData"), "tbl");
      const tr = tbl.children.filter((n) => n.name.localName === "tr")[row]!;
      return required(tr.children.filter((n) => n.name.localName === "tc")[column]!, "txBody");
    };
    let source: XmlPart | undefined, cached: XmlPart;
    const read = () => {
      if (source !== this.#xml) {
        source = this.#xml;
        cached = parseXmlPart(new TextEncoder().encode(this.#xml.markup(body(), true)), {
          maxBytes: 64000000,
          maxNodes: 4000000,
          maxDepth: 64
        });
      }
      return cached;
    };
    return new TextFrame(read(), undefined, {
      read,
      write: (xml) => {
        applyTableUpdate(this.#xml, this.element, {
          cell: { row, column },
          text: this.cell(row, column).text
        });
        const target = body();
        const find = (node: XmlElement): XmlElement | undefined =>
          node.children.includes(target) ? node : node.children.map(find).find(Boolean);
        const owner = find(this.#xml.root)!;
        this.#xml = this.#xml.spliceChildren(owner, owner.children.indexOf(target), 1, [
          xml.markup(xml.root, true)
        ]);
      }
    });
  }
}
export class TableCell {
  constructor(
    readonly table: Table,
    readonly row: number,
    readonly column: number
  ) {
    position(row, table.rows.length);
    position(column, table.columns.length);
  }
  get text(): string {
    return readTable(this.table.element, this.table.xml).cells[
      this.row * this.table.columns.length + this.column
    ]!.text;
  }
  set text(value: string) {
    this.table.update({ cell: { row: this.row, column: this.column }, text: value });
  }
  get text_frame(): TextFrame {
    return this.table.bindTextFrame(this.row, this.column);
  }
  get is_spanned(): boolean {
    return readTable(this.table.element, this.table.xml).cells[
      this.row * this.table.columns.length + this.column
    ]!.isSpanned;
  }
  get is_merge_origin(): boolean {
    return readTable(this.table.element, this.table.xml).cells[
      this.row * this.table.columns.length + this.column
    ]!.isMergeOrigin;
  }
  get span_height(): number {
    return readTable(this.table.element, this.table.xml).cells[
      this.row * this.table.columns.length + this.column
    ]!.spanHeight;
  }
  get span_width(): number {
    return readTable(this.table.element, this.table.xml).cells[
      this.row * this.table.columns.length + this.column
    ]!.spanWidth;
  }
  get margin_left(): Length {
    return new Length(
      readTable(this.table.element, this.table.xml).cells[
        this.row * this.table.columns.length + this.column
      ]!.marginLeft ?? 91440
    );
  }
  set margin_left(value: Length | null) {
    this.table.update({ cell: { row: this.row, column: this.column }, marginLeft: value });
  }
  get margin_right(): Length {
    return new Length(
      readTable(this.table.element, this.table.xml).cells[
        this.row * this.table.columns.length + this.column
      ]!.marginRight ?? 91440
    );
  }
  set margin_right(value: Length | null) {
    this.table.update({ cell: { row: this.row, column: this.column }, marginRight: value });
  }
  get margin_top(): Length {
    return new Length(
      readTable(this.table.element, this.table.xml).cells[
        this.row * this.table.columns.length + this.column
      ]!.marginTop ?? 45720
    );
  }
  set margin_top(value: Length | null) {
    this.table.update({ cell: { row: this.row, column: this.column }, marginTop: value });
  }
  get margin_bottom(): Length {
    return new Length(
      readTable(this.table.element, this.table.xml).cells[
        this.row * this.table.columns.length + this.column
      ]!.marginBottom ?? 45720
    );
  }
  set margin_bottom(value: Length | null) {
    this.table.update({ cell: { row: this.row, column: this.column }, marginBottom: value });
  }
  get vertical_anchor(): MSO_VERTICAL_ANCHOR | null {
    const value = readTable(this.table.element, this.table.xml).cells[
      this.row * this.table.columns.length + this.column
    ]!.verticalAnchor;
    if (value === null) return null;
    if (value === "top") return MSO_VERTICAL_ANCHOR.TOP;
    if (value === "middle") return MSO_VERTICAL_ANCHOR.MIDDLE;
    if (value === "bottom") return MSO_VERTICAL_ANCHOR.BOTTOM;
    throw new OfficeError("unsupported-edit", "Cell anchor is preserve-only.", "validate-intent");
  }
  set vertical_anchor(value: MSO_VERTICAL_ANCHOR | null) {
    const anchor =
      value === null
        ? null
        : value === MSO_VERTICAL_ANCHOR.TOP
          ? "top"
          : value === MSO_VERTICAL_ANCHOR.MIDDLE
            ? "middle"
            : value === MSO_VERTICAL_ANCHOR.BOTTOM
              ? "bottom"
              : undefined;
    if (anchor === undefined)
      throw new OfficeError("invalid-value", "Invalid cell anchor.", "usage");
    this.table.update({ cell: { row: this.row, column: this.column }, verticalAnchor: anchor });
  }
}
export class TableRows implements Iterable<TableRow> {
  readonly [index: number]: TableRow;
  constructor(readonly table: Table) {
    return indexed(this);
  }
  get length(): number {
    return readTable(this.table.element, this.table.xml).rows;
  }
  get(index: number): TableRow {
    position(index, this.length);
    return new TableRow(this.table, index);
  }
  *[Symbol.iterator](): IterableIterator<TableRow> {
    for (let i = 0; i < this.length; i++) yield this.get(i);
  }
}
export class TableColumns implements Iterable<TableColumn> {
  readonly [index: number]: TableColumn;
  constructor(readonly table: Table) {
    return indexed(this);
  }
  get length(): number {
    return readTable(this.table.element, this.table.xml).columns;
  }
  get(index: number): TableColumn {
    position(index, this.length);
    return new TableColumn(this.table, index);
  }
  *[Symbol.iterator](): IterableIterator<TableColumn> {
    for (let i = 0; i < this.length; i++) yield this.get(i);
  }
}
export class TableRow {
  constructor(
    readonly table: Table,
    readonly index: number
  ) {
    position(index, table.rows.length);
  }
  get height(): Length {
    return new Length(readTable(this.table.element, this.table.xml).rowHeights[this.index]!);
  }
  set height(value: Length) {
    this.table.update({ cell: { row: this.index, column: 0 }, rowHeight: value });
  }
  get cells(): TableCells {
    return new TableCells(this.table, this.index);
  }
}
export class TableColumn {
  constructor(
    readonly table: Table,
    readonly index: number
  ) {
    position(index, table.columns.length);
  }
  get width(): Length {
    return new Length(readTable(this.table.element, this.table.xml).columnWidths[this.index]!);
  }
  set width(value: Length) {
    this.table.update({ cell: { row: 0, column: this.index }, columnWidth: value });
  }
}
export class TableCells implements Iterable<TableCell> {
  readonly [index: number]: TableCell;
  constructor(
    readonly table: Table,
    readonly row: number
  ) {
    position(row, table.rows.length);
    return indexed(this);
  }
  get length(): number {
    return this.table.columns.length;
  }
  get(index: number): TableCell {
    position(index, this.length);
    return this.table.cell(this.row, index);
  }
  *[Symbol.iterator](): IterableIterator<TableCell> {
    for (let i = 0; i < this.length; i++) yield this.get(i);
  }
}
