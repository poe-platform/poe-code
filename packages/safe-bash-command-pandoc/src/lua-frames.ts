import type {PagedStorage} from "safe-bash-io-engine/storage";
import type {LuaStorage, LuaReference, StoredLuaValue} from "./lua-storage.js";

interface Frame {
  parent: number;
  closure: LuaReference;
  registers: LuaReference;
  arguments: LuaReference;
  pc: number;
  top: number;
  returnBase: number;
  results: number;
  argumentCount: number;
  concatEnd: number;
  nativeState: number;
}

/** Linked activation records and register cells for retained Lua execution.
 * Only the active record and current value are read into memory. The caller
 * owns storage lifetime and keeps the active frame address, not a JS stack.
 * Scope close detaches cells; returning drops the frame without copying its
 * registers, so closures continue to share their original captured cells. */
export class LuaFrames {
  constructor(private readonly storage: PagedStorage, private readonly heap: LuaStorage, private readonly cooperate: (units?: number) => Promise<void>) {}

  private async fields(position: number, ...values: number[]): Promise<void> {
    const bytes = new Uint8Array(values.length * 8), view = new DataView(bytes.buffer);
    values.forEach((value, i) => view.setFloat64(i * 8, value, true));
    await this.storage.write(position, bytes);
  }
  async read(frame: number): Promise<Frame> {
    const bytes = await this.storage.read(frame, 88), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return {
      parent: view.getFloat64(0, true), closure: {kind: "function", id: view.getFloat64(8, true)},
      registers: {kind: "table", id: view.getFloat64(16, true)}, arguments: {kind: "table", id: view.getFloat64(24, true)},
      pc: view.getFloat64(32, true), top: view.getFloat64(40, true), returnBase: view.getFloat64(48, true),
      results: view.getFloat64(56, true), argumentCount: view.getFloat64(64, true), concatEnd: view.getFloat64(72, true), nativeState: view.getFloat64(80, true)
    };
  }
  async push(parent: number, closure: LuaReference, returnBase: number, results: number): Promise<number> {
    if (closure.kind !== "function") throw new TypeError("Expected Lua function");
    await this.cooperate();
    const registers = await this.heap.table(), args = await this.heap.table();
    const frame = this.storage.allocate(88);
    await this.fields(frame, parent, closure.id, registers.id, args.id, 0, 0, returnBase, results, 0, -1, 0);
    return frame;
  }
  async replace(frame: number, closure: LuaReference): Promise<void> {
    if (closure.kind !== "function") throw new TypeError("Expected Lua function");
    await this.cooperate();
    const registers = await this.heap.table(), args = await this.heap.table();
    await this.fields(frame + 8, closure.id, registers.id, args.id, 0, 0);
    await this.fields(frame + 64, 0, -1, 0);
  }
  async state(frame: number): Promise<LuaReference> {
    const {nativeState}=await this.read(frame);
    if(nativeState) return {kind:"table",id:nativeState};
    const state=await this.heap.table();
    await this.fields(frame+80,state.id);
    return state;
  }
  async resetResults(frame:number):Promise<void> {
    const registers=await this.heap.table();
    await this.fields(frame+16,registers.id);
    await this.fields(frame+40,0);
  }
  async pc(frame: number, value: number): Promise<void> {
    await this.fields(frame + 32, value);
  }
  async top(frame: number, value: number): Promise<void> {
    await this.fields(frame + 40, value);
  }
  async concat(frame: number, end: number): Promise<void> {
    await this.fields(frame + 72, end);
  }
  async get(frame: number, index: number): Promise<StoredLuaValue> {
    const cell = await this.heap.get((await this.read(frame)).registers, index) as number | undefined;
    return cell === undefined ? undefined : this.heap.value(cell);
  }
  async set(frame: number, index: number, value: StoredLuaValue): Promise<void> {
    const current = await this.read(frame);
    const cell = await this.heap.get(current.registers, index) as number | undefined;
    if (cell === undefined) await this.heap.set(current.registers, index, await this.heap.cell(value));
    else await this.heap.assign(cell, value);
    if (index >= current.top) await this.top(frame, index + 1);
  }
  async capture(frame: number, index: number): Promise<number> {
    const current = await this.read(frame);
    let cell = await this.heap.get(current.registers, index) as number | undefined;
    if (cell === undefined) {
      cell = await this.heap.cell();
      await this.heap.set(current.registers, index, cell);
    }
    return cell;
  }
  async close(frame: number, from: number): Promise<void> {
    const {registers} = await this.read(frame);
    for (let entry = await this.heap.next(registers); entry; entry = await this.heap.next(registers, entry.key)) {
      await this.cooperate();
      if ((entry.key as number) >= from) {
        const value = await this.heap.value(entry.value as number);
        await this.heap.set(registers, entry.key, await this.heap.cell(value));
      }
    }
  }
  async arguments(frame: number, source: Iterable<StoredLuaValue> | AsyncIterable<StoredLuaValue>): Promise<void> {
    const args = await this.heap.table();
    let count = 0;
    for await (const value of source) {
      await this.cooperate();
      await this.heap.set(args, count++, value);
    }
    await this.fields(frame + 24, args.id);
    await this.fields(frame + 64, count);
  }
  async argument(frame: number, index: number): Promise<StoredLuaValue> {
    return this.heap.get((await this.read(frame)).arguments, index);
  }
}
