import { assert, expect, it } from "vitest";
import { run } from "./run.js";
import { dump } from "./dump.js";
import { numericTypedArrayConstructors } from "./interp/typed-array-constructors.js";

it.each(Object.keys(numericTypedArrayConstructors))(
  "rejects live %s snapshots and cancels pending host work",
  async kind => {
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const controller = new AbortController();
    const execution = run(`
      import {wait} from 'cap';
      const buffer = new ArrayBuffer(32, {maxByteLength:64});
      const view = new ${kind}(buffer);
      await wait(); return view.length;
    `, {
      extensions: [], signal: controller.signal,
      modules: { cap: { wait: () => { started(); return new Promise(() => {}); } } }
    });
    const completion = execution.catch(error => error);
    try {
      await ready;
      // Live state is intentionally outside the public snapshot contract.
      // Check settlement at a turn boundary, without a timer or relaxed deadline.
      const capture = dump(execution).then(
        () => ({ status: "fulfilled" }),
        (error: unknown) => ({ status: "rejected", error })
      );
      expect(await Promise.race([
        capture,
        new Promise(resolve => setImmediate(() => resolve({ status: "pending" })))
      ])).toMatchObject({
        status: "rejected",
        error: { name: "TypeError", message: "Snapshot is not replayable: Live realm state cannot be serialized or replayed." }
      });
    } finally {
      controller.abort(new Error("cancel binary qualification host wait"));
      expect(await completion).toMatchObject({ message: "cancel binary qualification host wait" });
    }
  }
);

// Every declared kind participates; expected storage is literal byte data,
// independent of native floating-point conversion and host endianness.
it.each(Object.entries(numericTypedArrayConstructors))(
  "recovers %s tracking and fixed views after shrink, regrowth and transfer",
  async (kind, constructor) => {
    const width = constructor.BYTES_PER_ELEMENT;
    const source = `
      const buffer = new ArrayBuffer(${4 * width}, {maxByteLength:${6 * width}});
      const bytes = new Uint8Array(buffer); bytes.fill(165);
      const tracking = new ${kind}(buffer);
      const fixed = new ${kind}(buffer, ${width}, 2);
      const data = new DataView(buffer, ${width});
      buffer.resize(${width});
      await 0;
      const short = [tracking.length, fixed.length, fixed.byteOffset];
      let bounds; try { data.getUint8(0); } catch (e) { bounds = e.name; }
      buffer.resize(${6 * width});
      await 0;
      const grown = [tracking.length, fixed.length, data.byteLength,
        tracking.buffer === fixed.buffer, data.buffer === buffer];
      const moved = buffer.transfer();
      return [short, bounds, grown, Array.from(new Uint8Array(moved)),
        buffer.detached, tracking.length, fixed.length, bytes.length];
    `;
    const expected = [
      [1, 0, 0], "RangeError", [6, 2, 5 * width, true, true],
      [...Array(width).fill(165), ...Array(5 * width).fill(0)],
      true, 0, 0, 0
    ];
    const original = await run(source);
    assert(original.ok);
    expect(original.returnValue).toEqual(expected);
    const replay = await run(source, { snapshot: JSON.parse(await dump(original)) });
    assert(replay.ok);
    expect(replay.returnValue).toEqual(expected);
  }
);

it.each(Object.entries(numericTypedArrayConstructors))(
  "recovers %s shared growth and structured-copy block aliases",
  async (kind, constructor) => {
    const width = constructor.BYTES_PER_ELEMENT;
    const source = `
      const buffer = new SharedArrayBuffer(${2 * width}, {maxByteLength:${4 * width}});
      const tracking = new ${kind}(buffer);
      const fixed = new ${kind}(buffer, 0, 1);
      const data = new DataView(buffer);
      const copy = structuredClone({buffer, tracking, fixed, data});
      new Uint8Array(copy.buffer).fill(90);
      await 0;
      buffer.grow(${4 * width});
      await 0;
      new Uint8Array(copy.buffer)[${3 * width}] = 37;
      return [tracking.length, fixed.length, data.byteLength, copy.tracking.length,
        copy.fixed.length, copy.data.byteLength, copy.buffer !== buffer,
        copy.tracking.buffer === copy.buffer, copy.data.buffer === copy.buffer,
        Array.from(new Uint8Array(buffer))];
    `;
    const bytes = [...Array(2 * width).fill(90), ...Array(2 * width).fill(0)];
    bytes[3 * width] = 37;
    const expected = [4, 1, 4 * width, 4, 1, 4 * width, true, true, true, bytes];
    const original = await run(source);
    assert(original.ok);
    expect(original.returnValue).toEqual(expected);
    const replay = await run(source, { snapshot: JSON.parse(await dump(original)) });
    assert(replay.ok);
    expect(replay.returnValue).toEqual(expected);
  }
);
