import { describe, expect, it } from "vitest";
import { ListStorage } from "./list-storage.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });

describe("list extension", () => {
  it("extends exact list slots without aliasing the source or copying elements", () => {
    const item = {}, source = new ListStorage([item], budget()), target = new ListStorage<object>([], budget());
    target.extend(source); source.clear(); expect(target.get(0n)).toBe(item);
  });
  it("extends itself once using the original length", () => {
    const target = new ListStorage([1, 2, 3], budget()); target.extend(target);
    expect(target.snapshot()).toEqual([1, 2, 3, 1, 2, 3]);
    const empty = new ListStorage([], budget()); empty.extend(empty); expect(empty.length).toBe(0);
  });
  it("keeps a forward cursor attached across exact extension", () => {
    const target = new ListStorage([1], budget()), cursor = target.iterate(); cursor.next();
    target.extend(new ListStorage([2, 3], budget())); expect([...cursor]).toEqual([2, 3]);
  });
  it("streams undefined values and stops at the first done result", () => {
    const target = new ListStorage<number | undefined>([], budget()); let calls = 0;
    target.extendIterator({ next: () => ++calls === 1 ? { done: false, value: undefined } : { done: true, value: 9 } });
    expect(calls).toBe(2); expect(target.snapshot()).toEqual([undefined]);
  });
  it("retains partial extension and does not close an iterator on failure", () => {
    const target = new ListStorage([0], budget()), failure = new Error("next failed"); let calls = 0, closed = false;
    expect(() => target.extendIterator({
      next: () => { if (++calls === 3) throw failure; return { done: false, value: calls }; },
      return: () => { closed = true; return { done: true, value: undefined }; }
    })).toThrow(failure);
    expect(closed).toBe(false); expect(target.snapshot()).toEqual([0, 1, 2]);
  });
  it("appends each yielded value after mutations performed by next", () => {
    const target = new ListStorage([0], budget()); let calls = 0;
    target.extendIterator({ next: () => {
      calls++; if (calls === 1) { target.clear(); return { done: false, value: 1 }; }
      if (calls === 2) { target.append(8); return { done: false, value: 2 }; }
      target.append(9); return { done: true, value: undefined };
    } });
    expect(target.snapshot()).toEqual([1, 8, 2, 9]);
  });
  it("preflights exact extension before changing slots", () => {
    let reject = false;
    const target = new ListStorage([1], { checkpoint: (_steps, bytes = 0) => {
      if (reject && bytes) throw new ExecutionLimitError("allocation");
    } });
    reject = true; expect(() => target.extend(target)).toThrow(ExecutionLimitError);
    reject = false; expect(target.snapshot()).toEqual([1]);
  });
  it("checks the meter after next and before committing its yielded item", () => {
    let reject = false;
    const target = new ListStorage([1], { checkpoint: () => { if (reject) throw new ExecutionLimitError("cancelled"); } });
    expect(() => target.extendIterator({ next: () => { reject = true; return { done: false, value: 2 }; } })).toThrow(ExecutionLimitError);
    reject = false; expect(target.snapshot()).toEqual([1]);
  });
  it("bounds extending from its own live iterator rather than treating it as an exact self list", () => {
    const target = new ListStorage([1], new ExecutionBudget({ maxSteps: 30, maxAllocatedBytes: 10000 }));
    expect(() => target.extendIterator(target.iterate())).toThrow(ExecutionLimitError);
  });
});
