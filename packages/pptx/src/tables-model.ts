import { applyTableStructure, type TableStructureOperation } from "./table-spans.js";
import { IndexError, InvalidHandleError, OfficeError } from "./errors.js";
import { Length } from "./length.js";
import { child, required } from "./masters.js";
import { FillFormat } from "./shapes.js";
import { nodeFor } from "./shape-operations.js";
import { TextFrame } from "./text-frames.js";
import { MSO_VERTICAL_ANCHOR } from "./text-frame-enums.js";
import { applyTableUpdate, readTable, type TableUpdate } from "./tables.js";
import type { XmlElement, XmlPart } from "./xml.js";
function position(index: number, length: number): void {
  if (!Number.isSafeInteger(index) || index < 0 || index >= length)
    throw new IndexError("Table position is outside the collection.");
}
function indexed<T extends { get(index: number): unknown }>(collection: T): T {
  return new Proxy(collection, {
    get(target, key) {
      if (typeof key === "string" && key !== "" && String(Number(key)) === key)
        return target.get(Number(key));
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    defineProperty(target, key, descriptor) {
      if (typeof key === "string" && key !== "" && String(Number(key)) === key)
        throw new OfficeError(
          "invalid-value",
          "Table collections cannot replace entries.",
          "usage"
        );
      return Reflect.defineProperty(target, key, descriptor);
    },
    deleteProperty(target, key) {
      if (typeof key === "string" && key !== "" && String(Number(key)) === key)
        throw new OfficeError("invalid-value", "Table collections cannot remove entries.", "usage");
      return Reflect.deleteProperty(target, key);
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
  readonly #cells = new Map<string, TableCell>();
  #generation = 0;
  get generation(): number {
    return this.#generation;
  }
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
    const key = `${row}:${column}`;
    let cell = this.#cells.get(key);
    if (!cell) {
      cell = new TableCell(this, row, column);
      this.#cells.set(key, cell);
    }
    return cell;
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
  structure(operation: TableStructureOperation): void {
    this.#xml = applyTableStructure(this.#xml, this.element, operation);
    if (operation.kind !== "merge" && operation.kind !== "split") {
      this.#generation++;
      this.#cells.clear();
    }
  }
  bindFill(row: number, column: number): FillFormat {
    const cell = this.cell(row, column);
    const target = () => {
      void cell.table;
      const graphic = this.element.children.find((node) => node.name.localName === "graphic")!;
      const table = required(required(graphic, "graphicData"), "tbl");
      const owner = table.children.filter((n) => n.name.localName === "tr")[row]!;
      return owner.children.filter((n) => n.name.localName === "tc")[column]!;
    };
    const edit = (transform: (xml: XmlPart, node: XmlElement) => XmlPart) => {
      void cell.table;
      applyTableUpdate(this.#xml, this.element, { cell: { row, column } });
      this.#xml = transform(this.#xml, target());
    };
    if (!child(target(), "tcPr"))
      edit((xml, node) =>
        xml.merge(node, {
          children: {
            sequence: ["txBody", "tcPr", "extLst"].map((localName) => ({
              namespace: node.name.namespace,
              localName
            })),
            upsert: [{ name: { namespace: node.name.namespace, localName: "tcPr" }, merge: {} }]
          }
        })
      );
    const read = () => this.#xml.subtree(target());
    return new FillFormat(read, undefined, false, edit, (node) => child(node, "tcPr"));
  }
  bindTextFrame(row: number, column: number, parent?: TableCell): TextFrame {
    const generation = this.#generation;
    const validate = () => {
      if (generation !== this.#generation) throw new InvalidHandleError();
    };
    const body = () => {
      validate();
      const graphic = this.element.children.find((n) => n.name.localName === "graphic")!;
      const tbl = required(required(graphic, "graphicData"), "tbl");
      const tr = tbl.children.filter((n) => n.name.localName === "tr")[row]!;
      return required(tr.children.filter((n) => n.name.localName === "tc")[column]!, "txBody");
    };
    let source: XmlPart | undefined, cached: XmlPart;
    const read = () => {
      validate();
      if (source !== this.#xml) {
        source = this.#xml;
        cached = this.#xml.subtree(body());
      }
      return cached;
    };
    return new TextFrame(read(), undefined, {
      parent,
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
  readonly #table: Table;
  readonly #generation: number;
  #frame: TextFrame | undefined;
  #fill: FillFormat | undefined;
  get table(): Table {
    if (this.#generation !== this.#table.generation) throw new InvalidHandleError();
    return this.#table;
  }
  constructor(
    table: Table,
    readonly row: number,
    readonly column: number
  ) {
    this.#table = table;
    this.#generation = table.generation;
    position(row, table.rows.length);
    position(column, table.columns.length);
  }
  equals(other: unknown): boolean {
    const table = this.table;
    return (
      other instanceof TableCell &&
      other.table === table &&
      other.row === this.row &&
      other.column === this.column
    );
  }
  get fill(): FillFormat {
    const table = this.table;
    return (this.#fill ??= table.bindFill(this.row, this.column));
  }
  merge(other: TableCell): void {
    if (!(other instanceof TableCell) || other.table !== this.table)
      throw new OfficeError("invalid-value", "Merge cells must belong to the same table.", "usage");
    this.table.structure({
      kind: "merge",
      from: { row: Math.min(this.row, other.row), column: Math.min(this.column, other.column) },
      to: { row: Math.max(this.row, other.row), column: Math.max(this.column, other.column) }
    });
  }
  split(): void {
    this.table.structure({ kind: "split", cell: { row: this.row, column: this.column } });
  }
  get text(): string {
    return readTable(this.table.element, this.table.xml).cells[
      this.row * this.table.columns.length + this.column
    ]!.text;
  }
  set text(value: string) {
    this.text_frame.text = value;
  }
  get text_frame(): TextFrame {
    const table = this.table;
    return (this.#frame ??= table.bindTextFrame(this.row, this.column, this));
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
  readonly get = this.at;
  at(index: number): TableRow {
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
  readonly get = this.at;
  at(index: number): TableColumn {
    position(index, this.length);
    return new TableColumn(this.table, index);
  }
  *[Symbol.iterator](): IterableIterator<TableColumn> {
    for (let i = 0; i < this.length; i++) yield this.get(i);
  }
}
export class TableRow {
  readonly #table: Table;
  readonly #generation: number;
  get table(): Table {
    if (this.#generation !== this.#table.generation) throw new InvalidHandleError();
    return this.#table;
  }
  constructor(
    table: Table,
    readonly index: number
  ) {
    this.#table = table;
    this.#generation = table.generation;
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
  readonly #table: Table;
  readonly #generation: number;
  get table(): Table {
    if (this.#generation !== this.#table.generation) throw new InvalidHandleError();
    return this.#table;
  }
  constructor(
    table: Table,
    readonly index: number
  ) {
    this.#table = table;
    this.#generation = table.generation;
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
  readonly #table: Table;
  readonly #generation: number;
  get table(): Table {
    if (this.#generation !== this.#table.generation) throw new InvalidHandleError();
    return this.#table;
  }
  constructor(
    table: Table,
    readonly row: number
  ) {
    this.#table = table;
    this.#generation = table.generation;
    position(row, table.rows.length);
    return indexed(this);
  }
  get length(): number {
    return this.table.columns.length;
  }
  readonly get = this.at;
  at(index: number): TableCell {
    position(index, this.length);
    return this.table.cell(this.row, index);
  }
  *[Symbol.iterator](): IterableIterator<TableCell> {
    for (let i = 0; i < this.length; i++) yield this.get(i);
  }
}
