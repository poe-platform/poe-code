import {LuaNumbers} from "./lua-numbers.js";
import {LuaStrings} from "./lua-strings.js";
import {PandocError} from "./errors.js";
import type {LuaFrames} from "./lua-frames.js";
import type {LuaProgram} from "./lua-program.js";
import type {LuaInteger, LuaReference, LuaStorage, StoredLuaValue} from "./lua-storage.js";

const integer = (value: number): LuaInteger => ({kind: "integer", value: value | 0});
const isInteger = (value: StoredLuaValue): value is LuaInteger => typeof value === "object" && value.kind === "integer";
const truth = (value: StoredLuaValue): boolean => value !== undefined && value !== false;
function fail(message: string): never {throw new PandocError("E_AST", "convert", message);}
function numeric(value: StoredLuaValue): number {
  if (typeof value === "number") return value;
  if (isInteger(value)) return value.value;
  return fail("Expected Lua number");
}
function integral(value: StoredLuaValue): number {
  const number = numeric(value);
  if ((number | 0) !== number) fail("Number has no integer representation");
  return number;
}
function shift(value: number, amount: number): number {
  if (amount >= 32 || amount <= -32) return 0;
  return amount < 0 ? value >>> -amount : value << amount;
}
function arithmetic(op: number, left: StoredLuaValue, right: StoredLuaValue): StoredLuaValue {
  const a = numeric(left), b = numeric(right), integers = isInteger(left) && isInteger(right);
  let result: number;
  switch (op) {
    case 13: result = a + b; break;
    case 14: result = a - b; break;
    case 15: result = integers ? Math.imul(a, b) : a * b; break;
    case 16:
      if (integers && b === 0) fail("Attempt to perform n%0");
      result = a % b;
      if (result !== 0 && (result < 0) !== (b < 0)) result += b;
      break;
    case 17: return a ** b;
    case 18: return a / b;
    case 19:
      if (integers && b === 0) fail("Attempt to divide by zero");
      result = Math.floor(a / b); break;
    case 20: return integer(integral(left) & integral(right));
    case 21: return integer(integral(left) | integral(right));
    case 22: return integer(integral(left) ^ integral(right));
    case 23: return integer(shift(integral(left), integral(right)));
    case 24: return integer(shift(integral(left), -integral(right)));
    default: return fail("Invalid arithmetic instruction");
  }
  return integers ? integer(result) : result;
}

export interface LuaResults {values: LuaReference; count: number}

/** Internal retained execution core. Calls use linked backing records, including
 * tail-call replacement and captured cells; results retain their nil-slot count.
 * This is not yet selected by public filters. Metamethods,
 * native libraries and bounded source compilation must be integrated before it
 * can replace the supported public interpreter. */
export class LuaMachine {
  private closures: Promise<LuaReference> | undefined;
  private readonly strings: LuaStrings;
  private readonly numbers: LuaNumbers;
  constructor(private readonly program: LuaProgram, private readonly frames: LuaFrames, private readonly heap: LuaStorage,
    private readonly cooperate: (units?: number) => Promise<void>) {this.strings = new LuaStrings(heap); this.numbers = new LuaNumbers(heap);}

  private function(value: StoredLuaValue): LuaReference {
    if (typeof value !== "object" || value.kind !== "function") fail("Expected Lua function");
    return value;
  }
  private async table(value: StoredLuaValue): Promise<LuaReference> {
    if (typeof value !== "object" || value.kind !== "table") fail("Expected Lua table");
    if (await this.heap.metatable(value)) throw new PandocError("E_UNSUPPORTED_FEATURE", "convert", "Retained metamethod execution is not integrated");
    return value;
  }
  private async initialize(frame: number, closure: LuaReference, args: Iterable<StoredLuaValue> | AsyncIterable<StoredLuaValue>): Promise<void> {
    const prototype = await this.program.describe(await this.heap.prototype(closure));
    await this.frames.arguments(frame, args);
    for (let i = 0; i < prototype.parameters; i++) await this.frames.set(frame, i, await this.frames.argument(frame, i));
    await this.frames.top(frame, prototype.registers);
  }
  private async *arguments(registers: LuaReference, start: number, count: number): AsyncGenerator<StoredLuaValue> {
    for (let i = 0; i < count; i++) {
      const cell = await this.heap.get(registers, start + i) as number | undefined;
      yield cell === undefined ? undefined : await this.heap.value(cell);
    }
  }
  private async *captures(frame: number, closure: LuaReference, prototype: number): AsyncGenerator<number> {
    const {captures} = await this.program.describe(prototype);
    for (let i = 0; i < captures; i++) {
      const capture = await this.program.capture(prototype, i);
      const cell = capture.register ? await this.frames.capture(frame, capture.index) : await this.heap.capture(closure, capture.index);
      if (cell === undefined) fail("Invalid Lua captured variable");
      yield cell;
    }
  }
  async run(closure: LuaReference, args: Iterable<StoredLuaValue> | AsyncIterable<StoredLuaValue>): Promise<LuaResults> {
    let frame = await this.frames.push(0, this.function(closure), 0, -1);
    await this.initialize(frame, closure, args);
    for (;;) {
      await this.cooperate();
      const current = await this.frames.read(frame), prototype = await this.heap.prototype(current.closure);
      const {code} = await this.program.instruction(prototype, current.pc);
      const op = code & 63, a = code >>> 6 & 255, b = code >>> 23 & 511, c = code >>> 14 & 511;
      const bx = code >>> 14, sbx = bx - 131071;
      let pc = current.pc + 1;
      await this.frames.pc(frame, pc);
      const get = (index: number) => this.frames.get(frame, index);
      const set = (index: number, value: StoredLuaValue) => this.frames.set(frame, index, value);
      const rk = (index: number) => index & 256 ? this.program.read(prototype, "constant", index & 255) : get(index);
      const upvalue = async (index: number): Promise<number> => {
        const cell = await this.heap.capture(current.closure, index);
        if (cell === undefined) fail("Invalid Lua upvalue");
        return cell;
      };
      const extra = async (): Promise<number> => {
        const next = await this.program.instruction(prototype, pc++);
        if ((next.code & 63) !== 46) fail("Expected Lua EXTRAARG");
        await this.frames.pc(frame, pc);
        return next.code >>> 6;
      };
      if (op >= 13 && op <= 24) {
        const left = await rk(b), right = await rk(c);
        await set(a, arithmetic(op, isInteger(left) ? left : await this.numbers.coerce(left), isInteger(right) ? right : await this.numbers.coerce(right)));
        continue;
      }
      switch (op) {
        case 0: await set(a, await get(b)); break;
        case 1: await set(a, await this.program.read(prototype, "constant", bx)); break;
        case 2: await set(a, await this.program.read(prototype, "constant", await extra())); break;
        case 3: await set(a, Boolean(b)); if (c) await this.frames.pc(frame, pc + 1); break;
        case 4: for (let i = a; i <= a + b; i++) await set(i, undefined); break;
        case 5: await set(a, await this.heap.value(await upvalue(b))); break;
        case 6: await set(a, await this.heap.get(await this.table(await this.heap.value(await upvalue(b))), await rk(c))); break;
        case 7: await set(a, await this.heap.get(await this.table(await get(b)), await rk(c))); break;
        case 8: await this.heap.set(await this.table(await this.heap.value(await upvalue(a))), await rk(b), await rk(c)); break;
        case 9: await this.heap.assign(await upvalue(b), await get(a)); break;
        case 10: await this.heap.set(await this.table(await get(a)), await rk(b), await rk(c)); break;
        case 11: await set(a, await this.heap.table()); break;
        case 12: {
          const object = await get(b); await set(a + 1, object);
          await set(a, await this.heap.get(await this.table(object), await rk(c))); break;
        }
        case 25: {const value = await get(b); await set(a, isInteger(value) ? integer(-value.value) : -await this.numbers.coerce(value)); break;}
        case 26: await set(a, integer(~integral(await this.numbers.coerce(await get(b))))); break;
        case 27: await set(a, !truth(await get(b))); break;
        case 28: {
          const value = await get(b);
          await set(a, integer(typeof value === "object" && value.kind === "string" ? await this.heap.byteLength(value) : await this.heap.length(await this.table(value))));
          break;
        }
        case 29: await set(a, await this.strings.concat(this.arguments(current.registers, b, c - b + 1))); break;
        case 30: if (a) await this.frames.close(frame, a - 1); await this.frames.pc(frame, pc + sbx); break;
        case 31: if (Number(await this.heap.equal(await rk(b), await rk(c))) !== a) await this.frames.pc(frame, pc + 1); break;
        case 32: case 33: {
          const left = await rk(b), right = await rk(c);
          let comparison: boolean;
          if (typeof left === "object" && left.kind === "string" && typeof right === "object" && right.kind === "string") {
            const order = await this.strings.compare(left, right);
            comparison = op === 32 ? order < 0 : order <= 0;
          } else comparison = op === 32 ? numeric(left) < numeric(right) : numeric(left) <= numeric(right);
          if (Number(comparison) !== a) await this.frames.pc(frame, pc + 1);
          break;
        }
        case 34: if (truth(await get(a)) !== Boolean(c)) await this.frames.pc(frame, pc + 1); break;
        case 35: {
          const value = await get(b);
          if (truth(value) !== Boolean(c)) await this.frames.pc(frame, pc + 1);
          else await set(a, value);
          break;
        }
        case 36: case 37: case 41: {
          const callable = this.function(await get(a));
          const count = op === 41 ? 2 : b ? b - 1 : current.top - a - 1;
          const source = this.arguments(current.registers, a + 1, count);
          if (op === 37) await this.frames.replace(frame, callable);
          else frame = await this.frames.push(frame, callable, op === 41 ? a + 3 : a, op === 41 ? c : c - 1);
          await this.initialize(frame, callable, source);
          break;
        }
        case 38: {
          const count = b ? b - 1 : current.top - a;
          if (!current.parent) {
            const values = await this.heap.table();
            for (let i = 0; i < count; i++) await this.heap.set(values, i, await get(a + i));
            return {values, count};
          }
          const wanted = current.results < 0 ? count : current.results;
          for (let i = 0; i < wanted; i++) await this.frames.set(current.parent, current.returnBase + i, i < count ? await get(a + i) : undefined);
          frame = current.parent;
          const parent = await this.frames.read(frame);
          const top = current.results < 0 ? current.returnBase + count : (await this.program.describe(await this.heap.prototype(parent.closure))).registers;
          await this.frames.top(frame, top);
          break;
        }
        case 39: {
          const initial = await get(a), step = numeric(await get(a + 2)), limit = numeric(await get(a + 1));
          const next = isInteger(initial) ? integer(initial.value + step) : numeric(initial) + step;
          const index = numeric(next);
          if (step > 0 ? index <= limit : limit <= index) {
            await set(a, next); await set(a + 3, next); await this.frames.pc(frame, pc + sbx);
          }
          break;
        }
        case 40: {
          const initial = await get(a), stepValue = await get(a + 2), step = await this.numbers.coerce(stepValue), limit = await this.numbers.coerce(await get(a + 1));
          if (isInteger(initial) && isInteger(stepValue)) {
            let end = step < 0 ? Math.ceil(limit) : Math.floor(limit), stop = false;
            if (!(end >= -2147483648 && end <= 2147483647)) {
              end = limit > 0 ? 2147483647 : -2147483648;
              stop = limit > 0 ? step < 0 : step >= 0;
            }
            await set(a + 1, integer(end)); await set(a, integer((stop ? 0 : initial.value) - step));
          } else {
            await set(a, await this.numbers.coerce(initial) - step); await set(a + 1, limit); await set(a + 2, step);
          }
          await this.frames.pc(frame, pc + sbx); break;
        }
        case 42: {
          const value = await get(a + 1);
          if (value !== undefined) {await set(a, value); await this.frames.pc(frame, pc + sbx);}
          break;
        }
        case 43: {
          const table = await this.table(await get(a)), count = b || current.top - a - 1, block = c || await extra();
          for (let i = count; i > 0; i--) await this.heap.set(table, integer((block - 1) * 50 + i), await get(a + i));
          await this.frames.top(frame, (await this.program.describe(prototype)).registers); break;
        }
        case 44: {
          const child = await this.program.read(prototype, "child", bx) as number;
          const cache = await (this.closures ??= this.heap.table());
          const previous = await this.heap.get(cache, child);
          let result = typeof previous === "object" && previous.kind === "function" ? previous : undefined;
          if (result) {
            let index = 0;
            for await (const cell of this.captures(frame, current.closure, child)) {
              if (await this.heap.capture(result, index++) !== cell) {result = undefined; break;}
            }
          }
          if (!result) {
            result = await this.heap.closure(child, this.captures(frame, current.closure, child));
            await this.heap.set(cache, child, result);
          }
          await set(a, result); break;
        }
        case 45: {
          const parameters = (await this.program.describe(prototype)).parameters;
          const available = Math.max(0, current.argumentCount - parameters), count = b ? b - 1 : available;
          for (let i = 0; i < count; i++) await set(a + i, i < available ? await this.frames.argument(frame, parameters + i) : undefined);
          if (!b) await this.frames.top(frame, a + count);
          break;
        }
        default: throw new PandocError("E_UNSUPPORTED_FEATURE", "convert", `Retained Lua opcode ${op} is not integrated`);
      }
    }
  }
}
