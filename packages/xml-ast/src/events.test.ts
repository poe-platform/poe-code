import { expect, test } from "vitest";
import { parseXmlStream } from "./index.js";

test("XML events preserve document order without retaining a tree", async () => {
  const events: unknown[] = [];
  const root = await parseXmlStream(["<!--before--><r xmlns:p='urn:p'><p:x a='1'>text</p:x><![CDATA[c]]></r><?after ok?>"], {
    retainTree: false,
    events: async (event: unknown) => { await Promise.resolve(); events.push(event); }
  } as Parameters<typeof parseXmlStream>[1]);
  expect(events.map(event => (event as { type: string }).type)).toEqual(["content", "open", "open", "content", "close", "content", "close", "content"]);
  expect(root.children).toEqual([]);
  expect(root.content).toEqual([]);
});

test("XML event consumption applies backpressure before asking for another chunk", async () => {
  let emitted = 0, consumed = 0, closed = false;
  const source = { async *[Symbol.asyncIterator]() {
    try {
      yield "<r>";
      for (let index = 0; index < 100; index++) {
        expect(consumed).toBe(emitted);
        emitted++;
        yield "<x/>";
      }
      yield "</r>";
    } finally { closed = true; }
  } };
  await parseXmlStream(source, { retainTree: false, events: async (event: { type: string; element?: { name: string } }) => {
    await Promise.resolve();
    if (event.type === "close" && event.element?.name === "x") consumed++;
  } } as Parameters<typeof parseXmlStream>[1]);
  expect(consumed).toBe(100);
  expect(closed).toBe(true);
});


for (const failure of [new Error("event consumer failed"), null, false]) test(`XML events preserve a consumer failure: ${String(failure)}`, async () => {
  let closed = false;
  const source = { async *[Symbol.asyncIterator]() {
    try { yield "<r><x/></r>"; throw new Error("unexpected read-ahead"); }
    finally { closed = true; }
  } };
  await expect(parseXmlStream(source, { retainTree: false, events: () => { throw failure; } })).rejects.toBe(failure);
  expect(closed).toBe(true);
});
