import type {PagedStorage} from "safe-bash-io-engine/storage";
import type {LuaStorage, LuaReference, StoredLuaValue} from "./lua-storage.js";

export interface LuaPrototypeOptions {
  parameters: number;
  vararg: boolean;
  registers: number;
  source?: LuaReference;
}
export interface LuaPrototype extends LuaPrototypeOptions {
  instructions: number;
  constants: number;
  children: number;
  captures: number;
}
export interface LuaCapture {register: boolean; index: number}

// Header offsets for each growable vector and its logical length. Nil constants
// occupy a logical slot even though Lua table storage omits their value.
const sections = {instruction: [32, 72], constant: [40, 80], child: [48, 88], capture: [56, 96]} as const;
type Section = keyof typeof sections;

/** Mutable prototype storage for a retained compiler and interpreter. Bytecode,
 * constants, nested functions, capture descriptors and source lines grow in
 * caller-backed tables; no array grows with the source. This does not itself
 * replace the resident Fengari compiler or execute the stored instructions. */
export class LuaProgram {
  constructor(private readonly storage: PagedStorage, private readonly heap: LuaStorage, private readonly cooperate: (units?: number) => Promise<void>) {}

  private async fields(position: number, ...values: number[]): Promise<void> {
    const bytes = new Uint8Array(values.length * 8), view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setFloat64(index * 8, value, true));
    await this.storage.write(position, bytes);
  }
  private async number(position: number): Promise<number> {
    const bytes = await this.storage.read(position, 8);
    return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);
  }
  private async vector(prototype: number, offset: number): Promise<LuaReference> {
    return {kind: "table", id: await this.number(prototype + offset)};
  }
  async create(options: LuaPrototypeOptions): Promise<number> {
    if (!Number.isInteger(options.parameters) || options.parameters < 0 || options.parameters > 255 ||
        !Number.isInteger(options.registers) || options.registers < 0 || options.registers > 255)
      throw new RangeError("Invalid Lua prototype register count");
    if (options.source && options.source.kind !== "string") throw new TypeError("Expected Lua source string");
    await this.cooperate();
    const vectors: number[] = [];
    for (let i = 0; i < 5; i++) vectors.push((await this.heap.table()).id);
    const prototype = this.storage.allocate(104);
    await this.fields(prototype, options.parameters, Number(options.vararg), options.registers,
      options.source?.id ?? 0, ...vectors, 0, 0, 0, 0);
    return prototype;
  }
  async describe(prototype: number): Promise<LuaPrototype> {
    const bytes = await this.storage.read(prototype, 104), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    const source = view.getFloat64(24, true);
    return {
      parameters: view.getFloat64(0, true), vararg: Boolean(view.getFloat64(8, true)), registers: view.getFloat64(16, true),
      ...(source ? {source: {kind: "string" as const, id: source}} : {}),
      instructions: view.getFloat64(72, true), constants: view.getFloat64(80, true),
      children: view.getFloat64(88, true), captures: view.getFloat64(96, true)
    };
  }
  private async append(prototype: number, section: Section, value: StoredLuaValue): Promise<number> {
    await this.cooperate();
    const [table, length] = sections[section], index = await this.number(prototype + length);
    await this.heap.set(await this.vector(prototype, table), index, value);
    await this.fields(prototype + length, index + 1);
    return index;
  }
  async read(prototype: number, section: Section, index: number): Promise<StoredLuaValue> {
    await this.cooperate();
    const [table, length] = sections[section];
    if (!Number.isSafeInteger(index) || index < 0 || index >= await this.number(prototype + length))
      throw new RangeError(`Invalid Lua ${section} index`);
    return this.heap.get(await this.vector(prototype, table), index);
  }
  private word(code: number): number {
    if (!Number.isInteger(code) || code < -2147483648 || code > 0xffffffff) throw new RangeError("Invalid Lua instruction word");
    return code >>> 0;
  }
  async emit(prototype: number, code: number, line: number): Promise<number> {
    const index = await this.append(prototype, "instruction", this.word(code));
    await this.heap.set(await this.vector(prototype, 64), index, line);
    return index;
  }
  async patch(prototype: number, index: number, code: number): Promise<void> {
    const word = this.word(code);
    await this.read(prototype, "instruction", index);
    await this.heap.set(await this.vector(prototype, 32), index, word);
  }
  async instruction(prototype: number, index: number): Promise<{code: number; line: number}> {
    const code = await this.read(prototype, "instruction", index) as number;
    const line = await this.heap.get(await this.vector(prototype, 64), index) as number;
    return {code, line};
  }
  async addConstant(prototype: number, value: StoredLuaValue): Promise<number> {
    if (typeof value === "object" && value.kind !== "string" && value.kind !== "integer")
      throw new TypeError("Invalid Lua constant");
    return this.append(prototype, "constant", value);
  }
  async addChild(prototype: number, child: number): Promise<number> {
    if (!Number.isSafeInteger(child) || child <= 0) throw new RangeError("Invalid child prototype address");
    return this.append(prototype, "child", child);
  }
  async addCapture(prototype: number, capture: LuaCapture): Promise<number> {
    if (!Number.isInteger(capture.index) || capture.index < 0 || capture.index > 255) throw new RangeError("Invalid Lua capture register");
    return this.append(prototype, "capture", Number(capture.register) * 256 + capture.index);
  }
  async capture(prototype: number, index: number): Promise<LuaCapture> {
    const value = await this.read(prototype, "capture", index) as number;
    return {register: value >= 256, index: value & 255};
  }
}
