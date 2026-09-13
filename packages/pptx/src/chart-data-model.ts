import { sequenceSlice } from "./model-sequence.js";
import {
  IndexError,
  PropertyAccessError,
  TypeError as ModelTypeError,
  ValueError
} from "./errors.js";
import {
  createChartXml,
  chartTypes,
  type ChartData as ChartDataInput,
  type CreatableChartType
} from "./chart-editing.js";
import { createChartWorkbook, workbookColumn } from "./chart-workbook.js";
import { XL_CHART_TYPE } from "./chart-enums.js";
import type { SelectionContext } from "./selectors.js";

export type CategoryLabel = string | number | Date | null;
function format(value: string): string {
  if (typeof value !== "string") throw new ModelTypeError("Number format must be a string.");
  return value;
}
function numeric(value: number | null, nullable = true): number | null {
  if (value === null && nullable) return null;
  if (typeof value !== "number") throw new ModelTypeError("Expected a numeric chart value.");
  if (!Number.isFinite(value)) throw new ValueError("Chart values must be finite.");
  return value;
}
function label(value: CategoryLabel): CategoryLabel {
  if (value === null) return null;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new ValueError("Invalid category date.");
    return new Date(value.getTime());
  }
  if (typeof value === "number") return numeric(value, false)!;
  if (typeof value !== "string") throw new ModelTypeError("Invalid category label.");
  return value;
}
function kind(value: CategoryLabel): string {
  return value instanceof Date ? "date" : value === null ? "string" : typeof value;
}
function bounds(value: number, length: number): number {
  if (!Number.isSafeInteger(value)) throw new IndexError();
  return Math.max(0, Math.min(length, value < 0 ? length + value : value));
}
const sequenceStorage = new WeakMap<object, unknown[]>();
const sequenceTargets = new WeakMap<object, object>();
function sameOwner(left: object, right: object): boolean {
  return (sequenceTargets.get(left) ?? left) === (sequenceTargets.get(right) ?? right);
}
function sequenceItems<T>(owner: ChartDataSequence<T>): T[] {
  return sequenceStorage.get(owner)! as T[];
}
export class ChartDataSequence<T> implements Iterable<T> {
  readonly [index: number]: T;

  constructor() {
    const items: T[] = [];
    sequenceStorage.set(this, items);
    const proxy = new Proxy(this, {
      get(target, key, receiver) {
        if (typeof key === "string" && key !== "" && String(Number(key)) === key)
          return target.at(Number(key));
        return Reflect.get(target, key, receiver);
      },
      set(target, key, value, receiver) {
        if (typeof key === "string" && key !== "" && String(Number(key)) === key)
          throw new ValueError("Sequence entries cannot be replaced.");
        return Reflect.set(target, key, value, receiver);
      },
      defineProperty(target, key, descriptor) {
        if (typeof key === "string" && key !== "" && String(Number(key)) === key)
          throw new ValueError("Sequence entries cannot be replaced.");
        return Reflect.defineProperty(target, key, descriptor);
      },
      deleteProperty(target, key) {
        if (typeof key === "string" && key !== "" && String(Number(key)) === key)
          throw new ValueError("Sequence entries cannot be removed.");
        return Reflect.deleteProperty(target, key);
      }
    });
    sequenceStorage.set(proxy, items);
    sequenceTargets.set(proxy, this);
    return proxy;
  }
  get length(): number {
    return sequenceItems(this).length;
  }
  at(index: number): T {
    if (!Number.isSafeInteger(index) || index < -this.length || index >= this.length)
      throw new IndexError();
    return sequenceItems(this)[index < 0 ? this.length + index : index]!;
  }
  slice(start?: number, end?: number, step = 1): readonly T[] {
    return sequenceSlice(sequenceItems(this), start, end, step);
  }
  [Symbol.iterator](): IterableIterator<T> {
    return sequenceItems(this)[Symbol.iterator]();
  }
  includes(value: T): boolean {
    return sequenceItems(this).includes(value);
  }
  count(value: T): number {
    return sequenceItems(this).filter((item) => item === value).length;
  }
  reversed(): readonly T[] {
    return Object.freeze([...sequenceItems(this)].reverse());
  }
}
export class Categories extends ChartDataSequence<Category> {
  #customFormat: string | null = null;
  add_category(value: CategoryLabel): Category {
    const normalized = label(value);
    if (this.length && kind(this.at(0).label) !== kind(normalized))
      throw new ValueError("Category labels must have the same type.");
    const category = new Category(normalized, this);
    sequenceItems(this).push(category);
    return category;
  }
  index(category: Category): number {
    let offset = 0;
    for (const item of this) {
      if (item === category) return offset;
      offset += item.leaf_count;
    }
    throw new ValueError("Category does not belong to this hierarchy.");
  }
  get are_dates(): boolean {
    return this.depth === 1 && this.length > 0 && this.at(0).label instanceof Date;
  }
  get are_numeric(): boolean {
    return (
      this.depth === 1 &&
      this.length > 0 &&
      (this.are_dates || typeof this.at(0).label === "number")
    );
  }
  get depth(): number {
    if (!this.length) return 0;
    const depths = sequenceItems(this).map((item) => item.depth);
    if (depths.some((depth) => depth !== depths[0]))
      throw new ValueError("Category hierarchy must have uniform depth.");
    return depths[0]!;
  }
  get leaf_count(): number {
    return sequenceItems(this).reduce((count, item) => count + item.leaf_count, 0);
  }
  get levels(): readonly (readonly (readonly [number, CategoryLabel])[])[] {
    const levels: [number, CategoryLabel][][] = Array.from({ length: this.depth }, () => []);
    const visit = (category: Category, depth: number): void => {
      levels[depth]!.push([category.idx, category.label]);
      for (const child of category.sub_categories) visit(child, depth + 1);
    };
    for (const category of this) visit(category, 0);
    return Object.freeze(
      levels.reverse().map((level) => Object.freeze(level.map((pair) => Object.freeze(pair))))
    );
  }
  get number_format(): string {
    return this.#customFormat ?? (this.are_dates ? "yyyy\\-mm\\-dd" : "General");
  }
  set number_format(value: string | null) {
    this.#customFormat = value === null ? null : format(value);
  }
}
export class Category {
  #value: CategoryLabel;
  #children: Category[] = [];
  readonly #parent: Categories | Category;
  constructor(value: CategoryLabel, parent: Categories | Category) {
    this.#value = label(value);
    this.#parent = parent;
  }
  get label(): CategoryLabel {
    return this.#value instanceof Date ? new Date(this.#value.getTime()) : (this.#value ?? "");
  }
  get sub_categories(): readonly Category[] {
    return Object.freeze([...this.#children]);
  }
  add_sub_category(value: CategoryLabel): Category {
    if (typeof this.#value !== "string" || typeof value !== "string")
      throw new ValueError("Hierarchical categories require string labels.");
    const category = new Category(value, this);
    this.#children.push(category);
    return category;
  }
  get idx(): number {
    return this.#parent.index(this);
  }
  index(category: Category): number {
    let offset = this.idx;
    for (const item of this.#children) {
      if (item === category) return offset;
      offset += item.leaf_count;
    }
    throw new ValueError("Subcategory does not belong to this category.");
  }
  get depth(): number {
    if (!this.#children.length) return 1;
    const depths = this.#children.map((child) => child.depth);
    if (depths.some((depth) => depth !== depths[0]))
      throw new ValueError("Category hierarchy must have uniform depth.");
    return depths[0]! + 1;
  }
  get leaf_count(): number {
    return this.#children.length
      ? this.#children.reduce((sum, child) => sum + child.leaf_count, 0)
      : 1;
  }
  numeric_str_val(date_1904 = false): string {
    if (typeof date_1904 !== "boolean") throw new ModelTypeError();
    if (this.#value instanceof Date) {
      const day = Math.floor(this.#value.getTime() / 86400000);
      const serial = date_1904
        ? day - Math.floor(Date.UTC(1904, 0, 1) / 86400000)
        : day -
          Math.floor(Date.UTC(1899, 11, 31) / 86400000) +
          (day >= Math.floor(Date.UTC(1900, 2, 1) / 86400000) ? 1 : 0);
      return serial.toFixed(1);
    }
    return String(this.#value);
  }
}
interface NumberFormatOwner {
  readonly number_format: string;
}
export class CategoryDataPoint {
  readonly value: number | null;
  readonly #owner: NumberFormatOwner;
  readonly #override: string | null;
  get owner(): NumberFormatOwner {
    return this.#owner;
  }
  constructor(owner: NumberFormatOwner, value: number | null, override: string | null = null) {
    this.value = numeric(value);
    if (override !== null) format(override);
    this.#owner = owner;
    this.#override = override;
    Object.freeze(this);
  }
  get number_format(): string {
    return this.#override ?? this.owner.number_format;
  }
}
export class XyDataPoint {
  readonly x: number;
  readonly y: number | null;
  readonly #owner: NumberFormatOwner;
  readonly #override: string | null;
  get owner(): NumberFormatOwner {
    return this.#owner;
  }
  constructor(
    owner: NumberFormatOwner,
    x: number,
    y: number | null,
    override: string | null = null
  ) {
    this.x = numeric(x, false)!;
    this.y = numeric(y);
    if (override !== null) format(override);
    this.#owner = owner;
    this.#override = override;
    if (new.target === XyDataPoint) Object.freeze(this);
  }
  get number_format(): string {
    return this.#override ?? this.owner.number_format;
  }
}
export class BubbleDataPoint extends XyDataPoint {
  readonly bubble_size: number;
  constructor(
    owner: NumberFormatOwner,
    x: number,
    y: number | null,
    size: number,
    number_format: string | null = null
  ) {
    super(owner, x, y, number_format);
    this.bubble_size = numeric(size, false)!;
    if (size < 0) throw new ValueError("Bubble size must not be negative.");
    Object.freeze(this);
  }
}
interface SeriesOwner extends NumberFormatOwner {
  series_index(series: NumberFormatOwner): number;
  data_point_offset(series: NumberFormatOwner): number;
  series_name_ref(series: NumberFormatOwner): string;
  x_values_ref(series: NumberFormatOwner): string;
  y_values_ref(series: NumberFormatOwner): string;
}
class SeriesData<
  P extends { readonly owner: NumberFormatOwner },
  O extends SeriesOwner = SeriesOwner
> extends ChartDataSequence<P> {
  readonly #name: string;
  readonly #owner: O;
  readonly #override: string | null;
  get name(): string {
    return this.#name;
  }
  get owner(): O {
    return this.#owner;
  }
  constructor(owner: O, name: string | null, override: string | null = null) {
    super();
    this.#name = name === null ? "" : format(name);
    this.#owner = owner;
    this.#override = override;
    if (override !== null) format(override);
  }
  get number_format(): string {
    return this.#override ?? this.owner.number_format;
  }
  get index(): number {
    return this.owner.series_index(this);
  }
  get data_point_offset(): number {
    return this.owner.data_point_offset(this);
  }
  get name_ref(): string {
    return this.owner.series_name_ref(this);
  }
  get x_values_ref(): string {
    return this.owner.x_values_ref(this);
  }
  get y_values_ref(): string {
    return this.owner.y_values_ref(this);
  }
  append(point: P): void {
    if (!sameOwner(point.owner, this))
      throw new ValueError("Data point belongs to another series.");
    sequenceItems(this).push(point);
  }
}
export class CategorySeriesData extends SeriesData<CategoryDataPoint, CategoryChartData> {
  add_data_point(value: number | null, number_format: string | null = null): CategoryDataPoint {
    const point = new CategoryDataPoint(this, value, number_format);
    sequenceItems(this).push(point);
    return point;
  }
  get values(): readonly (number | null)[] {
    return Object.freeze(sequenceItems(this).map((point) => point.value));
  }
  get y_values(): readonly (number | null)[] {
    if (this.length)
      throw new PropertyAccessError(
        "Category points expose value; use values for category series."
      );
    return Object.freeze([]);
  }
  get x_values(): readonly number[] {
    if (this.length)
      throw new PropertyAccessError(
        "Category points expose labels through categories, not x coordinates."
      );
    return Object.freeze([]);
  }
  get categories(): Categories {
    return this.owner.categories;
  }
  get categories_ref(): string {
    return this.owner.categories_ref;
  }
  get values_ref(): string {
    return this.owner.values_ref(this);
  }
}
export class XySeriesData extends SeriesData<XyDataPoint> {
  add_data_point(x: number, y: number | null, number_format: string | null = null): XyDataPoint {
    const point = new XyDataPoint(this, x, y, number_format);
    sequenceItems(this).push(point);
    return point;
  }
  get x_values(): readonly number[] {
    return Object.freeze(sequenceItems(this).map((point) => point.x));
  }
  get y_values(): readonly (number | null)[] {
    return Object.freeze(sequenceItems(this).map((point) => point.y));
  }
}
export class BubbleSeriesData extends SeriesData<BubbleDataPoint, BubbleChartData> {
  add_data_point(
    x: number,
    y: number | null,
    size: number,
    number_format: string | null = null
  ): BubbleDataPoint {
    const point = new BubbleDataPoint(this, x, y, size, number_format);
    sequenceItems(this).push(point);
    return point;
  }
  get x_values(): readonly number[] {
    return Object.freeze(sequenceItems(this).map((point) => point.x));
  }
  get y_values(): readonly (number | null)[] {
    return Object.freeze(sequenceItems(this).map((point) => point.y));
  }
  get bubble_sizes(): readonly number[] {
    return Object.freeze(sequenceItems(this).map((point) => point.bubble_size));
  }
  get bubble_sizes_ref(): string {
    return this.owner.bubble_sizes_ref(this);
  }
}
abstract class BaseChartData<
  S extends {
    readonly owner: SeriesOwner;
    readonly length: number;
    readonly name: string;
    readonly number_format: string;
  }
>
  extends ChartDataSequence<S>
  implements SeriesOwner
{
  readonly #numberFormat: string;
  get number_format(): string {
    return this.#numberFormat;
  }
  constructor(number_format = "General") {
    super();
    this.#numberFormat = format(number_format);
  }
  abstract to_chart_data(date1904?: boolean): ChartDataInput;
  protected abstract get columnsPerSeries(): number;
  index(series: S, start = 0, stop = this.length): number {
    for (let i = bounds(start, this.length); i < bounds(stop, this.length); i++)
      if (sequenceItems(this)[i] === series) return i;
    throw new ValueError("Series is not in this chart data.");
  }
  series_index(series: NumberFormatOwner): number {
    const i = sequenceItems(this).findIndex((item) => sameOwner(item, series));
    if (i < 0) throw new ValueError("Series is not in this chart data.");
    return i;
  }
  data_point_offset(series: NumberFormatOwner): number {
    return sequenceItems(this)
      .slice(0, this.series_index(series))
      .reduce((sum, item) => sum + item.length, 0);
  }
  append(series: S): void {
    if (!sameOwner(series.owner, this))
      throw new ValueError("Series belongs to another chart data.");
    sequenceItems(this).push(series);
  }
  protected column(series: NumberFormatOwner): number {
    return this.series_index(series) * this.columnsPerSeries;
  }
  protected reference(series: NumberFormatOwner, column: number): string {
    const letter = workbookColumn(column);
    const count = sequenceItems(this)[this.series_index(series)]!.length;
    return `Sheet1!$${letter}$2:$${letter}$${count + 1}`;
  }
  series_name_ref(series: NumberFormatOwner): string {
    return `Sheet1!$${workbookColumn(this.column(series) + 1)}$1`;
  }
  x_values_ref(series: NumberFormatOwner): string {
    return this.reference(series, this.column(series));
  }
  y_values_ref(series: NumberFormatOwner): string {
    return this.reference(series, this.column(series) + 1);
  }
  async xlsx_blob(context: SelectionContext, date1904 = false): Promise<Uint8Array> {
    const data = this.to_chart_data(date1904);
    return createChartWorkbook(
      {
        ...data,
        ...(this instanceof CategoryChartData && this.categories.are_dates
          ? {
              categories: [...this.categories].map((category) =>
                Number(category.numeric_str_val(date1904 ?? false))
              )
            }
          : {})
      },
      this.columnsPerSeries > 1,
      context,
      { date1904 }
    );
  }
  xml_bytes(chart_type: CreatableChartType | XL_CHART_TYPE): Uint8Array {
    const type =
      typeof chart_type === "string"
        ? chart_type
        : chartTypes.find((name) => XL_CHART_TYPE[name] === chart_type);
    if (!type || !chartTypes.includes(type)) throw new ValueError("Unsupported chart type.");
    return new TextEncoder().encode(createChartXml(type, this.to_chart_data()));
  }
}
export class CategoryChartData extends BaseChartData<CategorySeriesData> {
  #categoryData = new Categories();
  protected get columnsPerSeries(): number {
    return 1;
  }
  get categories(): Categories {
    return this.#categoryData;
  }
  set categories(values: Iterable<CategoryLabel>) {
    const next = new Categories();
    for (const value of values) next.add_category(value);
    this.#categoryData = next;
  }
  add_category(value: CategoryLabel): Category {
    return this.#categoryData.add_category(value);
  }
  add_series(
    name: string | null,
    values: Iterable<number | null> = [],
    number_format: string | null = null
  ): CategorySeriesData {
    const series = new CategorySeriesData(this, name, number_format);
    for (const value of values) series.add_data_point(value);
    sequenceItems(this).push(series);
    return series;
  }
  get categories_ref(): string {
    if (!this.categories.length) throw new ValueError("Chart data contains no categories.");
    return `Sheet1!$A$2:$${workbookColumn(Math.max(1, this.categories.depth) - 1)}$${this.categories.leaf_count + 1}`;
  }
  protected override column(series: NumberFormatOwner): number {
    return this.series_index(series) + Math.max(1, this.categories.depth) - 1;
  }
  values_ref(series: NumberFormatOwner): string {
    return this.reference(series, this.column(series) + 1);
  }
  override x_values_ref(_series: NumberFormatOwner): string {
    throw new PropertyAccessError("Category chart data exposes categories_ref, not x_values_ref.");
  }
  override y_values_ref(_series: NumberFormatOwner): string {
    throw new PropertyAccessError("Category chart data exposes values_ref, not y_values_ref.");
  }

  to_chart_data(date1904?: boolean): ChartDataInput {
    const categories = this.categories;
    return {
      numberFormat: this.number_format,
      categoryNumberFormat: categories.number_format,
      ...(date1904 === undefined ? {} : { date1904 }),
      ...(categories.depth > 1
        ? {
            categoryLevels: [...categories.levels].reverse().map((level) => {
              const values: (string | null)[] = Array(categories.leaf_count).fill(null);
              for (const [index, label] of level) values[index] = String(label);
              return values;
            })
          }
        : {
            categories: [...categories].map((category) =>
              category.label instanceof Date
                ? category.label.toISOString()
                : categories.are_numeric
                  ? Number(category.numeric_str_val(date1904 ?? false))
                  : String(category.label)
            )
          }),
      series: sequenceItems(this).map((series) => ({
        name: series.name,
        values: series.values,
        numberFormat: series.number_format,
        pointNumberFormats: [...series].map((point) =>
          point.number_format === series.number_format ? null : point.number_format
        )
      }))
    };
  }
}
export class XyChartData extends BaseChartData<XySeriesData> {
  protected get columnsPerSeries(): number {
    return 2;
  }
  add_series(name: string | null, number_format: string | null = null): XySeriesData {
    const series = new XySeriesData(this, name, number_format);
    sequenceItems(this).push(series);
    return series;
  }
  to_chart_data(): ChartDataInput {
    return {
      numberFormat: this.number_format,
      series: sequenceItems(this).map((series) => ({
        name: series.name,
        values: series.y_values,
        xValues: series.x_values,
        numberFormat: series.number_format,
        pointNumberFormats: [...series].map((point) =>
          point.number_format === series.number_format ? null : point.number_format
        )
      }))
    };
  }
}
export class BubbleChartData extends BaseChartData<BubbleSeriesData> {
  protected get columnsPerSeries(): number {
    return 3;
  }
  add_series(name: string | null, number_format: string | null = null): BubbleSeriesData {
    const series = new BubbleSeriesData(this, name, number_format);
    sequenceItems(this).push(series);
    return series;
  }
  bubble_sizes_ref(series: NumberFormatOwner): string {
    return this.reference(series, this.column(series) + 2);
  }
  to_chart_data(): ChartDataInput {
    return {
      numberFormat: this.number_format,
      series: sequenceItems(this).map((series) => ({
        name: series.name,
        values: series.y_values,
        xValues: series.x_values,
        bubbleSizes: series.bubble_sizes,
        numberFormat: series.number_format,
        pointNumberFormats: [...series].map((point) =>
          point.number_format === series.number_format ? null : point.number_format
        )
      }))
    };
  }
}
export { CategoryChartData as ChartData };
export function toChartData(
  input: ChartDataInput | CategoryChartData | XyChartData | BubbleChartData
): ChartDataInput {
  return input instanceof CategoryChartData ||
    input instanceof XyChartData ||
    input instanceof BubbleChartData
    ? input.to_chart_data()
    : input;
}
