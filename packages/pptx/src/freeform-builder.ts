import { IndexError, OfficeError, TypeError as ModelTypeError, ValueError } from "./errors.js";
import { Length } from "./length.js";

export type FreeformCommand = Readonly<
  { type: "move" | "line"; x: number; y: number } | { type: "close" }
>;
export interface FreeformGeometry {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly localWidth: number;
  readonly localHeight: number;
  readonly commands: readonly FreeformCommand[];
}
function coordinate(value: number): number {
  const result = new Length(value).emu;
  if (Math.abs(result) > 27273042316900)
    throw new ValueError("Freeform coordinate exceeds DrawingML bounds.");
  return result;
}
function index(value: number, length: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value >= length) throw new IndexError();
  return value;
}
function budget(length: number): void {
  if (length > 4096)
    throw new OfficeError("resource-limit", "Freeform operation limit exceeded.", "usage");
}
export class FreeformPath {
  #commands: FreeformCommand[] = [];
  get commands(): readonly FreeformCommand[] {
    return Object.freeze([...this.#commands]);
  }
  append(command: FreeformCommand): void {
    budget(this.#commands.length + 1);
    if (!command || !["move", "line", "close"].includes(command.type)) throw new ModelTypeError();
    if (command.type === "close") this.#commands.push(Object.freeze({ type: "close" }));
    else
      this.#commands.push(
        Object.freeze({ type: command.type, x: coordinate(command.x), y: coordinate(command.y) })
      );
  }
}
export class DrawingOperation {
  readonly #offset: () => readonly [number, number];
  readonly x: Length | undefined;
  readonly y: Length | undefined;
  constructor(
    readonly type: "move" | "line" | "close",
    x?: number,
    y?: number,
    offset: () => readonly [number, number] = () => [0, 0]
  ) {
    this.#offset = offset;
    if (!["move", "line", "close"].includes(type)) throw new ModelTypeError();
    if (type !== "close") {
      this.x = new Length(coordinate(x!));
      this.y = new Length(coordinate(y!));
    }
    Object.freeze(this);
  }
  apply_operation_to(path: FreeformPath): void {
    if (!(path instanceof FreeformPath))
      throw new ModelTypeError("Expected a bounded freeform path.");
    path.append(
      this.type === "close"
        ? { type: "close" }
        : {
            type: this.type,
            x: this.x!.emu - this.#offset()[0],
            y: this.y!.emu - this.#offset()[1]
          }
    );
  }
}
export class FreeformBuilder<T> implements Iterable<DrawingOperation> {
  readonly [position: number]: DrawingOperation;
  readonly #insert: (geometry: FreeformGeometry) => T;
  #operations: DrawingOperation[] = [];
  #view: this;
  #startX: number;
  #startY: number;
  #scaleX: number;
  #scaleY: number;
  constructor(
    insert: (geometry: FreeformGeometry) => T,
    start_x = 0,
    start_y = 0,
    scale: number | readonly [number, number] = 1
  ) {
    this.#insert = insert;
    this.#startX = coordinate(start_x);
    this.#startY = coordinate(start_y);
    if (typeof insert !== "function") throw new ModelTypeError();
    if (typeof scale !== "number" && (!Array.isArray(scale) || scale.length !== 2))
      throw new ModelTypeError();
    [this.#scaleX, this.#scaleY] = typeof scale === "number" ? [scale, scale] : scale;
    if (
      ![this.#scaleX, this.#scaleY].every(
        (v) => typeof v === "number" && Number.isFinite(v) && v > 0
      )
    )
      throw new ValueError("Freeform scale must be positive and finite.");
    this.#view = new Proxy(this, {
      get(target, key) {
        if (typeof key === "string" && key !== "" && String(Number(key)) === key)
          return target.#operations[index(Number(key), target.length)];
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
      set() {
        throw new ValueError("Freeform builder members are read-only.");
      },
      defineProperty() {
        throw new ValueError("Freeform builder members are read-only.");
      },
      deleteProperty() {
        throw new ValueError("Freeform builder members are read-only.");
      }
    });
    return this.#view;
  }
  get length(): number {
    return this.#operations.length;
  }
  get shape_offset_x(): Length {
    return new Length(
      Math.min(this.#startX, ...this.#operations.flatMap((op) => (op.x ? [op.x.emu] : [])))
    );
  }
  get shape_offset_y(): Length {
    return new Length(
      Math.min(this.#startY, ...this.#operations.flatMap((op) => (op.y ? [op.y.emu] : [])))
    );
  }
  at(position: number): DrawingOperation {
    return this.#operations[index(position < 0 ? this.length + position : position, this.length)]!;
  }
  *[Symbol.iterator](): IterableIterator<DrawingOperation> {
    yield* this.#operations;
  }
  includes(value: DrawingOperation): boolean {
    return this.#operations.includes(value);
  }
  count(value: DrawingOperation): number {
    return this.#operations.filter((op) => op === value).length;
  }
  index(value: DrawingOperation, start = 0, stop = this.length): number {
    if (![start, stop].every(Number.isSafeInteger)) throw new ValueError();
    const first = start < 0 ? Math.max(0, this.length + start) : start;
    const end = stop < 0 ? Math.max(0, this.length + stop) : Math.min(this.length, stop);
    for (let i = first; i < end; i++) if (this.#operations[i] === value) return i;
    throw new ValueError("Drawing operation is not in the selected sequence.");
  }
  *reversed(): IterableIterator<DrawingOperation> {
    yield* [...this.#operations].reverse();
  }
  slice(start?: number, end?: number, step = 1): readonly DrawingOperation[] {
    if (
      ![...(start === undefined ? [] : [start]), ...(end === undefined ? [] : [end]), step].every(
        Number.isSafeInteger
      ) ||
      step === 0
    )
      throw new ValueError();
    const normalize = (v: number) =>
      Math.max(
        step > 0 ? 0 : -1,
        Math.min(step > 0 ? this.length : this.length - 1, v < 0 ? this.length + v : v)
      );
    const first = start === undefined ? (step > 0 ? 0 : this.length - 1) : normalize(start);
    const last = end === undefined ? (step > 0 ? this.length : -1) : normalize(end);
    const result: DrawingOperation[] = [];
    for (let i = first; step > 0 ? i < last : i > last; i += step)
      result.push(this.#operations[i]!);
    return Object.freeze(result);
  }
  add_line_segments(vertices: Iterable<readonly [number, number]>, close = true): this {
    if (typeof close !== "boolean" || !vertices || typeof vertices[Symbol.iterator] !== "function")
      throw new ModelTypeError();
    const additions: DrawingOperation[] = [];
    for (const vertex of vertices) {
      budget(this.length + additions.length + 2 + Number(close));
      if (!Array.isArray(vertex) || vertex.length !== 2) throw new ModelTypeError();
      additions.push(
        new DrawingOperation("line", vertex[0], vertex[1], () => [
          this.shape_offset_x.emu,
          this.shape_offset_y.emu
        ])
      );
    }
    if (close) additions.push(new DrawingOperation("close"));
    budget(this.length + additions.length + 1);
    this.#operations.push(...additions);
    return this.#view;
  }
  move_to(x: number, y: number): this {
    budget(this.length + 2);
    this.#operations.push(
      new DrawingOperation("move", x, y, () => [this.shape_offset_x.emu, this.shape_offset_y.emu])
    );
    return this.#view;
  }
  convert_to_shape(origin_x = new Length(0), origin_y = new Length(0)): T {
    if (!(origin_x instanceof Length) || !(origin_y instanceof Length))
      throw new ModelTypeError("Freeform origins require Length values.");
    const minX = this.shape_offset_x.emu,
      minY = this.shape_offset_y.emu;
    const maxX = Math.max(
      this.#startX,
      ...this.#operations.flatMap((op) => (op.x ? [op.x.emu] : []))
    );
    const maxY = Math.max(
      this.#startY,
      ...this.#operations.flatMap((op) => (op.y ? [op.y.emu] : []))
    );
    const path = new FreeformPath();
    path.append({ type: "move", x: this.#startX - minX, y: this.#startY - minY });
    for (const operation of this) operation.apply_operation_to(path);
    return this.#insert(
      Object.freeze({
        left: coordinate(origin_x.emu + coordinate(minX * this.#scaleX)),
        top: coordinate(origin_y.emu + coordinate(minY * this.#scaleY)),
        width: coordinate((maxX - minX) * this.#scaleX),
        height: coordinate((maxY - minY) * this.#scaleY),
        localWidth: coordinate(maxX - minX),
        localHeight: coordinate(maxY - minY),
        commands: Object.freeze(
          path.commands.map(
            (c): FreeformCommand =>
              Object.freeze(
                c.type === "close" ? c : { type: c.type, x: coordinate(c.x), y: coordinate(c.y) }
              )
          )
        )
      })
    );
  }
}
