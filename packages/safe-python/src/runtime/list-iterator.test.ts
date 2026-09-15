import { describe, expect, it } from "vitest";
import { ListStorage } from "./list-storage.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });

describe("live mutable list iteration", () => {
  it("creates independent forward/reverse cursors with element identity", () => {
    const first = {}, second = {}, list = new ListStorage([first, second], budget());
    const forward = list.iterate(), reverse = list.reversed(); expect(forward[Symbol.iterator]()).toBe(forward);
    expect(forward.next().value).toBe(first); expect(reverse.next().value).toBe(second);
    expect(forward.lengthHint()).toBe(1); expect(reverse.lengthHint()).toBe(1);
    expect([...forward]).toEqual([second]); expect([...reverse]).toEqual([first]);
  });
  it("visits appended values until forward exhaustion has actually been observed", () => {
    const list = new ListStorage([1], budget()), it = list.iterate(); expect(it.next().value).toBe(1);
    list.append(2); expect(it.lengthHint()).toBe(1); expect(it.next().value).toBe(2);
    expect(it.next()).toEqual({ done: true, value: undefined }); list.append(3);
    expect(it.next()).toEqual({ done: true, value: undefined }); expect(it.lengthHint()).toBe(0);
  });
  it("uses current numeric positions after insertion, deletion and replacement", () => {
    const list = new ListStorage([1, 2, 3], budget()), it = list.iterate(); expect(it.next().value).toBe(1);
    list.insert(0n, 9); expect(it.next().value).toBe(1);
    list.delete(0n); list.set(2n, 8); expect(it.next().value).toBe(8);
    expect(it.next()).toEqual({ done: true, value: undefined });
  });
  it("captures the starting reverse index and ignores appended tail elements", () => {
    const list = new ListStorage([1, 2, 3], budget()), it = list.reversed(); list.append(4);
    expect([...it]).toEqual([3, 2, 1]);
  });
  it("exhausts reverse iteration when its next index no longer exists", () => {
    const list = new ListStorage([1, 2, 3], budget()), it = list.reversed(); list.pop(); list.pop();
    expect(it.lengthHint()).toBe(0); expect(it.next()).toEqual({ done: true, value: undefined });
    list.append(2); list.append(3); expect(it.next()).toEqual({ done: true, value: undefined });
  });
  it("does not make a zero length hint terminal before next runs", () => {
    const list = new ListStorage([1, 2], budget()), it = list.reversed(); list.clear(); expect(it.lengthHint()).toBe(0);
    list.append(3); list.append(4); expect([...it]).toEqual([4, 3]);
  });
  it("distinguishes stored undefined from iterator completion", () => {
    const list = new ListStorage([undefined], budget()); expect(list.iterate().next()).toEqual({ done: false, value: undefined });
  });
  it("reserves fixed cursor storage without copying element slots", () => {
    const meter = budget(), list = new ListStorage(Array(100).fill(1), meter), before = meter.usage.allocatedBytes;
    list.iterate(); list.reversed(); expect(meter.usage.allocatedBytes - before).toBe(96);
  });
  it("checks limits before next advances the cursor", () => {
    let reject = false;
    const meter = { checkpoint: () => { if (reject) throw new ExecutionLimitError("steps"); } };
    const list = new ListStorage([1, 2], meter), it = list.iterate(); reject = true;
    expect(() => it.next()).toThrow(ExecutionLimitError); reject = false; expect(it.next().value).toBe(1);
  });
});
