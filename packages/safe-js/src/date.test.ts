import { describe, expect, it, vi } from "vitest";
import { Budget, createRealm, run } from "./core.js";
import { dump } from "./dump.js";
import { restore } from "./restore.js";
import { deepCopyFromSandbox, deepCopyToSandbox } from "./index.js";
import { decodeReplayData, encodeReplayData } from "./snapshot/replay-data.js";

describe("Date intrinsic", () => {
  it.each(["wrong", null, 0.5, 8.64e15 + 1])(
    "rejects malformed replayed clock value %s",
    async (value) => {
      const source = "return Date.now();";
      const first = await run(source, { clock: { now: () => 10, snapshot: () => undefined } });
      const snapshot = JSON.parse(await dump(first));
      snapshot.replay.calls[0].outcome.data.root = value;
      await expect(run(source, { snapshot: restore(snapshot, { source }) })).rejects.toThrow(
        /Date clock/
      );
    }
  );
  it("uses numeric hints for comparisons and string hints for addition", async () => {
    const text = new Date(10).toString();
    expect(
      await run(
        "const earlier = new Date(10); const later = new Date(20); return [earlier < later, later > earlier, earlier <= later, later >= earlier, earlier + '', earlier - later];"
      )
    ).toMatchObject({ ok: true, returnValue: [true, true, true, true, text, -10] });
  });

  it.each([NaN, Infinity, undefined, "7"])(
    "rejects invalid configured clock value %s",
    async (value) => {
      await expect(
        run("Date.now();", { clock: { now: () => value as number, snapshot: () => undefined } })
      ).rejects.toThrow(/Date clock/);
    }
  );

  it("validates host Date properties without invoking accessors", () => {
    const getter = vi.fn(() => 1);
    const date = new Date(0);
    Object.defineProperty(date, "data", { get: getter });
    expect(() => deepCopyToSandbox(date)).toThrow(/Date.*properties/);
    expect(getter).not.toHaveBeenCalled();
  });

  it("encodes Date aliases and invalid values without JSON string coercion", () => {
    const date = new Date(37);
    const input = deepCopyToSandbox([date, date, new Date(NaN)]);
    const serialized = encodeReplayData(input);
    const output = deepCopyFromSandbox(decodeReplayData(serialized)) as Date[];
    expect(output[0]).toBe(output[1]);
    expect(output[0].getTime()).toBe(37);
    expect(Number.isNaN(output[2].getTime())).toBe(true);
  });

  it.each([NaN, Infinity, -0, 0.5, 8.64e15 + 1, "0", undefined])(
    "rejects malformed serialized Date epoch %s",
    (time) => {
      expect(() =>
        decodeReplayData({ root: { tag: "ref", id: 0 }, nodes: [{ kind: "date", time }] } as never)
      ).toThrow();
    }
  );
  it("constructs epoch dates and exposes sandbox-owned methods", async () => {
    expect(
      await run(
        "const date = new Date(0); return [date.toISOString(), date.getTime(), date.valueOf(), typeof Date, typeof date, date instanceof Date, Date.prototype.getTime.call(date), Object.getPrototypeOf(date) === Date.prototype, date.constructor === Date];"
      )
    ).toMatchObject({
      ok: true,
      returnValue: ["1970-01-01T00:00:00.000Z", 0, 0, "function", "object", true, 0, true, true]
    });
  });

  it("supports the actual jQuery Date.now and +new Date initialization expressions", async () => {
    const now = vi.fn(() => 123456789);
    const clock = { now, snapshot: () => undefined };
    expect(
      await run(
        "const jquery = { now: Date.now }; return [jquery.now(), +new Date, Number(new Date(7)), new Date(9) - new Date(4)];",
        { clock }
      )
    ).toMatchObject({ ok: true, returnValue: [123456789, 123456789, 7, 5] });
    expect(now).toHaveBeenCalledTimes(2);
  });

  it("parses strings, clips epochs and supports UTC construction and components", async () => {
    expect(
      await run(
        "const date = new Date('2024-02-29T12:34:56.789Z'); return [Date.parse('2024-02-29T12:34:56.789Z'), Date.UTC(2024, 1, 29, 12, 34, 56, 789), date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCDay(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds(), new Date(1.9).getTime(), new Date(date).getTime()];"
      )
    ).toMatchObject({
      ok: true,
      returnValue: [1709210096789, 1709210096789, 2024, 1, 29, 4, 12, 34, 56, 789, 1, 1709210096789]
    });
  });

  it("matches local calendar construction and accessors without exposing native prototypes", async () => {
    const native = new Date(2024, 5, 7, 8, 9, 10, 11);
    const expected = [
      native.getTime(),
      native.getFullYear(),
      native.getMonth(),
      native.getDate(),
      native.getDay(),
      native.getHours(),
      native.getMinutes(),
      native.getSeconds(),
      native.getMilliseconds(),
      native.getTimezoneOffset(),
      native.toString(),
      native.toDateString(),
      native.toTimeString()
    ];
    expect(
      await run(
        "const date = new Date(2024, 5, 7, 8, 9, 10, 11); return [date.getTime(), date.getFullYear(), date.getMonth(), date.getDate(), date.getDay(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds(), date.getTimezoneOffset(), String(date), date.toDateString(), date.toTimeString()];"
      )
    ).toMatchObject({ ok: true, returnValue: expected });
  });

  it("handles invalid dates and ISO errors", async () => {
    expect(
      await run(
        "const date = new Date('not a date'); let error; try { date.toISOString(); } catch (failure) { error = failure.name; } return [Number.isNaN(date.getTime()), Number.isNaN(new Date(undefined).valueOf()), Number.isNaN(new Date(Infinity).getTime()), date.toString(), date.toJSON(), JSON.stringify({ date }), error];"
      )
    ).toMatchObject({
      ok: true,
      returnValue: [true, true, true, "Invalid Date", null, '{"date":null}', "RangeError"]
    });
  });

  it("mutates dates with normal overflow and keeps aliases", async () => {
    expect(
      await run(
        "const date = new Date(0); const alias = date; date.setUTCFullYear(2024, 1, 29); date.setUTCHours(25, 2, 3, 4); return [alias === date, date.toISOString(), date.setTime(17), +date];"
      )
    ).toMatchObject({ ok: true, returnValue: [true, "2024-03-01T01:02:03.004Z", 17, 17] });
  });

  it("replays recorded clock reads and serialized Date values without calling the clock again", async () => {
    const now = vi.fn(() => 1000);
    const source =
      "const date = new Date(); const alias = date; date.setTime(date.getTime() + 7); return [date, alias, new Date(NaN), Date.now()];";
    const first = await run(source, { clock: { now, snapshot: () => ({ next: 1001 }) } });
    const snapshot = JSON.parse(await dump(first));
    expect(Object.values(snapshot.heap ?? {}).some((entry: any) => entry.kind === "date")).toBe(
      true
    );
    const forbidden = vi.fn(() => {
      throw new Error("clock reread");
    });
    const restoreClock = vi.fn();
    const replayed = await run(source, {
      snapshot: restore(snapshot, { source }),
      clock: { now: forbidden, restore: restoreClock, snapshot: () => undefined }
    });
    const values = deepCopyFromSandbox(replayed.returnValue as never) as Date[];
    expect(replayed.ok).toBe(true);
    expect(values[0]).toBe(values[1]);
    expect(values[0].getTime()).toBe(1007);
    expect(Number.isNaN(values[2].getTime())).toBe(true);
    expect(values[3]).toBe(1000);
    expect(forbidden).not.toHaveBeenCalled();
    expect(restoreClock.mock.calls).toEqual([[{ next: 1001 }], [{ next: 1001 }]]);
  });

  it("copies Date graphs rather than sharing native mutable state", async () => {
    const native = new Date(7);
    const copied = deepCopyToSandbox([native, native, new Date(NaN)]);
    const output = deepCopyFromSandbox(copied) as Date[];
    expect(output[0]).toBe(output[1]);
    expect(output[0]).not.toBe(native);
    output[0].setTime(99);
    expect(native.getTime()).toBe(7);
    expect(Number.isNaN(output[2].getTime())).toBe(true);
    expect(
      await run("date.setTime(42); return date.getTime();", { bindings: { date: native } })
    ).toMatchObject({ ok: true, returnValue: 42 });
    expect(native.getTime()).toBe(7);
  });

  it("isolates Date values and prototype state across persistent realms", async () => {
    const first = createRealm({ clock: { now: () => 10, snapshot: () => undefined } });
    const second = createRealm({ clock: { now: () => 20, snapshot: () => undefined } });
    try {
      await first.evaluate("const date = new Date(); Date.prototype.label = 1;");
      await second.evaluate("const date = new Date();");
      expect(
        await first.evaluate("date.setTime(11); return [date.getTime(), Date.prototype.label, date.label];")
      ).toMatchObject({ ok: true, returnValue: [11, 1, 1] });
      expect(
        await second.evaluate("return [date.getTime(), Object.hasOwn(Date.prototype, 'label'), date.label];")
      ).toMatchObject({ ok: true, returnValue: [20, false, undefined] });
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("does not expose native constructors through Date or its formatting methods", async () => {
    expect(
      await run(
        "const date = new Date(0); return [date.__proto__, date.getTime.constructor, Date.constructor, Date.prototype.__proto__, date.toLocaleString.constructor, date.toLocaleDateString.constructor, date.toLocaleTimeString.constructor];"
      )
    ).toMatchObject({
      ok: true,
      returnValue: [undefined, undefined, undefined, undefined, undefined, undefined, undefined]
    });
  });

  it("bounds date parsing and retained storage", async () => {
    await expect(run("Date.parse('x'.repeat(5000));")).rejects.toThrow(
      /Date.*limit|Date.*long|Date.*4096/i
    );
    await expect(
      run(
        "const dates = []; for (let index = 0; index < 1000; index++) dates.push(new Date(index));",
        { budget: new Budget({ dataSize: 1000 }) }
      )
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
  });
});
