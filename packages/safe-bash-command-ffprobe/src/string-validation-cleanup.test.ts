import { expect, it } from "vitest";
import { StringValidation } from "./string-validation.js";

for (const asynchronous of [false, true]) for (const preflight of [false, true]) {
  it(`closes ${asynchronous ? "async" : "sync"} text on ${preflight ? "preflight" : "formatting"} read failure`, async () => {
    const primary = new Error("read failed");
    let closed = 0;
    const iterator = {
      next(): IteratorResult<string> { throw primary; },
      return(): IteratorResult<string> { closed++; throw new Error("cleanup failed"); }
    };
    const source = () => asynchronous ? {
      [Symbol.asyncIterator]() { return {
        async next() { return iterator.next(); },
        async return() { return iterator.return(); }
      }; }
    } : { [Symbol.iterator]() { return iterator; } };
    const validation = new StringValidation("json=sv=fail");
    await expect((async () => {
      if (preflight) await validation.accepts(source);
      else for await (const part of validation.text(source)) void part;
    })()).rejects.toBe(primary);
    expect(closed).toBe(1);
  });
}

it("retires invalid text after one chunk during fail-mode preflight", async () => {
  let closed = 0, reads = 0;
  const validation = new StringValidation("json=sv=fail");
  expect(await validation.accepts(async function* () {
    try { reads++; yield "\udcff"; reads++; yield "unread"; }
    finally { closed++; }
  })).toBe(false);
  expect(validation.failed).toBe(true);
  expect(reads).toBe(1);
  expect(closed).toBe(1);
});

it("does not close exhausted text or pre-read unrequested text", async () => {
  let reads = 0, closed = 0;
  const source = () => ({ [Symbol.iterator]() { return {
    next(): IteratorResult<string> { reads++; return { done: true, value: undefined }; },
    return(): IteratorResult<string> { closed++; return { done: true, value: undefined }; }
  }; } });
  const validation = new StringValidation("json");
  expect(await validation.accepts(source)).toBe(true);
  expect(reads).toBe(0);
  for await (const part of validation.text(source)) void part;
  expect(reads).toBe(1);
  expect(closed).toBe(0);
});
