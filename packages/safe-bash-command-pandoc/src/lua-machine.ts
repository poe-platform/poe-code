import {arithmetic,integer,isInteger,numeric,integral} from "./lua-arithmetic.js";
import {LuaMetatables, type LuaCall} from "./lua-metatables.js";
import {LuaNumbers} from "./lua-numbers.js";
import {LuaStrings} from "./lua-strings.js";
import {PandocError} from "./errors.js";
import type {LuaFrames} from "./lua-frames.js";
import type {LuaProgram} from "./lua-program.js";
import type {LuaReference, LuaStorage, StoredLuaValue} from "./lua-storage.js";

const arithmeticMethods = ["__add", "__sub", "__mul", "__mod", "__pow", "__div", "__idiv", "__band", "__bor", "__bxor", "__shl", "__shr"] as const;
const concatenable = (value: StoredLuaValue): boolean => typeof value === "number" || typeof value === "object" && (value.kind === "integer" || value.kind === "string");
const truth = (value: StoredLuaValue): boolean => value !== undefined && value !== false;
function fail(message: string): never {throw new PandocError("E_AST", "convert", message);}

export interface LuaResults {values: LuaReference; count: number}
export interface LuaArguments {readonly count: number; get(index: number): Promise<StoredLuaValue>}
export interface LuaNativeContext {
  readonly continuation: number;
  readonly state: LuaReference;
  readonly results: LuaArguments;
}
export interface LuaNativeCall {call: LuaCall; continuation: number}
export type LuaNativeOutput=Iterable<StoredLuaValue> | AsyncIterable<StoredLuaValue> | LuaNativeCall;
/** A native step either streams final values or requests a Lua callback. Its JS
 * activation ends before the callback runs. Resumption uses the same backed
 * arguments, private state and result count, including nil slots. */
export type LuaNative = (prototype: number, args: LuaArguments, context: LuaNativeContext) => LuaNativeOutput | Promise<LuaNativeOutput>;

/** Internal retained execution core. Calls use linked backing records, including
 * tail-call replacement and captured cells; results retain their nil-slot count.
 * This is not yet selected by public filters. Complete native libraries and
 * the Pandoc bridge must be integrated before it can replace the supported
 * public interpreter. */
export class LuaMachine {
  private closures: Promise<LuaReference> | undefined;
  private readonly strings: LuaStrings;
  private readonly numbers: LuaNumbers;
  private readonly metatables: LuaMetatables;
  constructor(private readonly program: LuaProgram, private readonly frames: LuaFrames, private readonly heap: LuaStorage,
    private readonly cooperate: (units?: number) => Promise<void>, private readonly native?: LuaNative) {this.strings = new LuaStrings(heap); this.numbers = new LuaNumbers(heap); this.metatables = new LuaMetatables(heap);}

  private function(value: StoredLuaValue): LuaReference {
    if (typeof value !== "object" || value.kind !== "function") fail("Expected Lua function");
    return value;
  }
  private async table(value: StoredLuaValue): Promise<LuaReference> {
    if (typeof value !== "object" || value.kind !== "table") fail("Expected Lua table");
    return value;
  }
  private async call(parent: number, call: LuaCall, destination: number, results: number): Promise<number> {
    const {callee, args} = await this.metatables.callable(call);
    const frame = await this.frames.push(parent, callee, destination, results);
    await this.initialize(frame, callee, args);
    return frame;
  }
  private async initialize(frame: number, closure: LuaReference, args: Iterable<StoredLuaValue> | AsyncIterable<StoredLuaValue>): Promise<void> {
    const address = await this.heap.prototype(closure);
    await this.frames.arguments(frame, args);
    if (address < 0) {await this.frames.top(frame, 0); return;}
    const prototype = await this.program.describe(address);
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
      let current = await this.frames.read(frame);
      const prototype = await this.heap.prototype(current.closure);
      let code: number;
      if (prototype < 0) {
        if (!this.native) throw new PandocError("E_UNSUPPORTED_FEATURE", "convert", "Native Lua library is not installed");
        const nativeFrame=frame,resultRegisters=current.registers,resultCount=current.top;
        const output=await this.native(prototype,{count:current.argumentCount,get:index=>this.frames.argument(nativeFrame,index)}, {
          continuation:current.pc,state:await this.frames.state(frame),results:{count:resultCount,get:async index=>{
            if(index<0 || index>=resultCount) return undefined;
            const cell=await this.heap.get(resultRegisters,index) as number | undefined;
            return cell===undefined?undefined:this.heap.value(cell);
          }}
        });
        await this.cooperate(0);
        if("call" in output) {
          if(!Number.isSafeInteger(output.continuation) || output.continuation<0) throw new RangeError("Invalid native Lua continuation");
          await this.frames.pc(frame,output.continuation);
          frame=await this.call(frame,output.call,0,-1);
          continue;
        }
        if(resultCount) await this.frames.resetResults(frame);
        let count = 0;
        for await (const value of output) {
          await this.cooperate();
          await this.frames.set(frame, count++, value);
        }
        await this.cooperate(0);
        await this.frames.top(frame, count);
        current = await this.frames.read(frame);
        code = 38; // RETURN all streamed results through the ordinary continuation.
      } else code = (await this.program.instruction(prototype, current.pc)).code;
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
        try {
          await set(a, arithmetic(op, isInteger(left) ? left : await this.numbers.coerce(left), isInteger(right) ? right : await this.numbers.coerce(right)));
        } catch (error) {
          if (!(error instanceof PandocError) || error.code !== "E_AST") throw error;
          const call = await this.metatables.binary(left, right, arithmeticMethods[op - 13]!);
          if (!call) throw error;
          frame = await this.call(frame, call, a, 1);
        }
        continue;
      }
      switch (op) {
        case 0: await set(a, await get(b)); break;
        case 1: await set(a, await this.program.read(prototype, "constant", bx)); break;
        case 2: await set(a, await this.program.read(prototype, "constant", await extra())); break;
        case 3: await set(a, Boolean(b)); if (c) await this.frames.pc(frame, pc + 1); break;
        case 4: for (let i = a; i <= a + b; i++) await set(i, undefined); break;
        case 5: await set(a, await this.heap.value(await upvalue(b))); break;
        case 6: case 7: {
          const object = op === 6 ? await this.heap.value(await upvalue(b)) : await get(b);
          const result = await this.metatables.index(object, await rk(c));
          if ("call" in result) frame = await this.call(frame, result.call, a, 1);
          else await set(a, result.value);
          break;
        }
        case 8: case 10: {
          const object = op === 8 ? await this.heap.value(await upvalue(a)) : await get(a);
          const call = await this.metatables.assign(object, await rk(b), await rk(c));
          if (call) frame = await this.call(frame, call, 0, 0);
          break;
        }
        case 9: await this.heap.assign(await upvalue(b), await get(a)); break;
        case 11: await set(a, await this.heap.table()); break;
        case 12: {
          const object = await get(b); await set(a + 1, object);
          const result = await this.metatables.index(object, await rk(c));
          if ("call" in result) frame = await this.call(frame, result.call, a, 1);
          else await set(a, result.value);
          break;
        }
        case 25: case 26: {
          const value = await get(b);
          try {
            await set(a, op === 25 ? isInteger(value) ? integer(-value.value) : -await this.numbers.coerce(value)
              : integer(~integral(await this.numbers.coerce(value))));
          } catch (error) {
            if (!(error instanceof PandocError) || error.code !== "E_AST") throw error;
            const call = await this.metatables.binary(value, value, op === 25 ? "__unm" : "__bnot");
            if (!call) throw error;
            frame = await this.call(frame, call, a, 1);
          }
          break;
        }
        case 27: await set(a, !truth(await get(b))); break;
        case 28: {
          const value = await get(b);
          const method = await this.metatables.method(value, "__len");
          if (method !== undefined) frame = await this.call(frame, {callee: method, args: [value, value]}, a, 1);
          else await set(a, integer(typeof value === "object" && value.kind === "string" ? await this.heap.byteLength(value) : await this.heap.length(await this.table(value))));
          break;
        }
        case 29: {
          let end = current.concatEnd >= 0 ? current.concatEnd : c, suspended = false;
          while (end > b) {
            const left = await get(end - 1), right = await get(end);
            if (concatenable(left) && concatenable(right)) {
              let start = end - 1;
              while (start > b && concatenable(await get(start - 1))) start--;
              await set(start, await this.strings.concat(this.arguments(current.registers, start, end - start + 1)));
              end = start;
            } else {
              const call = await this.metatables.binary(left, right, "__concat");
              if (!call) fail("Expected Lua string or number for concatenation");
              await this.frames.concat(frame, end - 1);
              await this.frames.pc(frame, current.pc);
              frame = await this.call(frame, call, end - 1, 1);
              suspended = true; break;
            }
          }
          if (!suspended) {await set(a, await get(b)); await this.frames.concat(frame, -1);}
          break;
        }
        case 30: if (a) await this.frames.close(frame, a - 1); await this.frames.pc(frame, pc + sbx); break;
        case 31: {
          const left = await rk(b), right = await rk(c), equal = await this.heap.equal(left, right);
          const call = !equal && typeof left === "object" && left.kind === "table" && typeof right === "object" && right.kind === "table"
            ? await this.metatables.binary(left, right, "__eq") : undefined;
          if (call) frame = await this.call(frame, call, 0, -2 - a);
          else if (Number(equal) !== a) await this.frames.pc(frame, pc + 1);
          break;
        }
        case 32: case 33: {
          const left = await rk(b), right = await rk(c);
          let comparison: boolean;
          if (typeof left === "object" && left.kind === "string" && typeof right === "object" && right.kind === "string") {
            const order = await this.strings.compare(left, right);
            comparison = op === 32 ? order < 0 : order <= 0;
          } else if ((typeof left === "number" || isInteger(left)) && (typeof right === "number" || isInteger(right))) {
            comparison = op === 32 ? numeric(left) < numeric(right) : numeric(left) <= numeric(right);
          } else {
            let call = await this.metatables.binary(left, right, op === 32 ? "__lt" : "__le"), invert = false;
            if (!call && op === 33) {call = await this.metatables.binary(right, left, "__lt"); invert = true;}
            if (!call) fail("Cannot compare Lua values");
            frame = await this.call(frame, call, 0, -2 - a - (invert ? 2 : 0));
            break;
          }
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
          const value = await get(a);
          const count = op === 41 ? 2 : b ? b - 1 : current.top - a - 1;
          const {callee: callable, args: source} = await this.metatables.callable({callee: value, args: this.arguments(current.registers, a + 1, count)});
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
          if (current.results < -1) {
            // -2/-3 compare false/true; -4/-5 negate the result for __le's
            // reversed __lt fallback. This continuation lives in the frame.
            const mode = -current.results - 2;
            const matched = truth(count ? await get(a) : undefined) !== (mode >= 2);
            if (matched !== Boolean(mode & 1)) {
              const parent = await this.frames.read(current.parent);
              await this.frames.pc(current.parent, parent.pc + 1);
            }
          } else {
            const wanted = current.results < 0 ? count : current.results;
            for (let i = 0; i < wanted; i++) await this.frames.set(current.parent, current.returnBase + i, i < count ? await get(a + i) : undefined);
          }
          frame = current.parent;
          const parent = await this.frames.read(frame);
          const top = current.results === -1 ? current.returnBase + count : (await this.program.describe(await this.heap.prototype(parent.closure))).registers;
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
