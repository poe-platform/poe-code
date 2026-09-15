import { describe, expect, it } from "vitest";
import { ListStorage } from "./list-storage.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
const numeric = { key: (value: number) => value, less: (a: number, b: number) => a < b };

describe("list sort lifecycle", () => {
  it("sorts the owned slots while all key and ordering callbacks see an empty list", () => {
    const list = new ListStorage([3, 1, 2], budget());
    list.sort({ key: value => { expect(list.length).toBe(0); return value; }, less: (a, b) => {
      expect(list.snapshot()).toEqual([]); return a < b;
    } });
    expect(list.snapshot()).toEqual([1, 2, 3]);
  });
  it("preserves equal-key identities in reverse order", () => {
    const values = [{ k: 1, id: 0 }, { k: 2, id: 1 }, { k: 1, id: 2 }], list = new ListStorage(values, budget());
    list.sort({ key: v => v.k, less: numeric.less, reverse: true });
    expect(list.snapshot()).toEqual([values[1], values[0], values[2]]);
  });
  it.each(["append", "insert", "extend", "slice"] as const)("detects %s followed by clear, discarding added elements", method => {
    const list = new ListStorage([3, 1, 2], budget()); let once = false;
    expect(() => list.sort({ ...numeric, key: value => {
      if (!once) {
        once = true;
        if (method === "append") list.append(9);
        else if (method === "insert") list.insert(0n, 9);
        else if (method === "extend") list.extend(new ListStorage([9], budget()));
        else list.setSlice(null, null, null, new ListStorage([9], budget()));
        list.clear();
      }
      return value;
    } })).toThrow(expect.objectContaining({ name: "ValueError", message: "list modified during sort" }));
    expect(list.snapshot()).toEqual([1, 2, 3]);
  });
  it("allows no-op mutation methods and nested empty sorting", () => {
    const list = new ListStorage([3, 1, 2], budget());
    list.sort({ ...numeric, key: value => {
      list.clear(); list.reverse(); list.repeatInPlace(0n); list.deleteSlice();
      list.extend(new ListStorage([], budget())); list.setSlice(null, null, null, new ListStorage([], budget()));
      list.sort(numeric); return value;
    } });
    expect(list.snapshot()).toEqual([1, 2, 3]);
  });
  it("does not lose outer mutation detection across nested sorting", () => {
    const list = new ListStorage([3, 1, 2], budget()); let once = false;
    expect(() => list.sort({ ...numeric, key: value => {
      if (!once) { once = true; list.append(8); list.sort(numeric); list.clear(); } return value;
    } })).toThrow(expect.objectContaining({ name: "ValueError", message: "list modified during sort" }));
    expect(list.snapshot()).toEqual([1, 2, 3]); list.sort(numeric); expect(list.snapshot()).toEqual([1, 2, 3]);
  });
  it("retains a callback exception in preference to the mutation error", () => {
    const list = new ListStorage([3, 1, 2], budget()), failure = new Error("key failed");
    expect(() => list.sort({ ...numeric, key: () => { list.append(9); throw failure; } })).toThrow(failure);
    expect(list.snapshot()).toEqual([3, 1, 2]); list.sort(numeric); expect(list.snapshot()).toEqual([1, 2, 3]);
  });
  it("restores the original permutation after a comparison failure", () => {
    const list = new ListStorage([3, 1, 2], budget()), failure = new Error("less failed");
    expect(() => list.sort({ ...numeric, less: () => { list.append(9); throw failure; } })).toThrow(failure);
    expect(list.snapshot()).toEqual([3, 1, 2]);
  });
  it("keeps existing cursors on the sorted slots unless they observed exhaustion during sorting", () => {
    const list = new ListStorage([3, 1, 2], budget()), live = list.iterate(), exhausted = list.iterate();
    live.next();
    list.sort({ ...numeric, key: value => { expect(exhausted.next().done).toBe(true); return value; } });
    expect([...live]).toEqual([2, 3]); expect([...exhausted]).toEqual([]);
  });
  it("restores slots without additional budget checks after fatal termination", () => {
    let reject = false;
    const list = new ListStorage([3, 1, 2], { checkpoint: () => { if (reject) throw new ExecutionLimitError("cancelled"); } });
    expect(() => list.sort({ ...numeric, key: value => { reject = true; return value; } })).toThrow(ExecutionLimitError);
    reject = false; expect(list.snapshot()).toEqual([3, 1, 2]);
  });
  it("detects modifications performed by ordering callbacks", () => {
    const list = new ListStorage([3, 1, 2], budget());
    expect(() => list.sort({ ...numeric, less: (a, b) => { list.append(9); return a < b; } })).toThrow(expect.objectContaining({ name: "ValueError" }));
    expect(list.snapshot()).toEqual([1, 2, 3]);
  });
});
