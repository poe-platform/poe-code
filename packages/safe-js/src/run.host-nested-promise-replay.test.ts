import { expect, it, vi } from "vitest";
import { dump, restore, run } from "./index.js";

it("replays a rejected nested host Promise without invoking the host again", async () => {
  const nested = Promise.reject(new Error("nested failure"));
  void nested.catch(() => undefined);
  const load = vi.fn(async () => ({ nested }));
  const source = "try { await (await load()).nested; return 'unexpected'; } catch (error) { return error.message; }";
  let result = await run(source, { bindings: { load } });
  expect(result).toMatchObject({ ok: true, returnValue: "nested failure" });
  for (let iteration = 0; iteration < 2; iteration++) {
    result = await run(source, { bindings: { load }, snapshot: restore(JSON.parse(await dump(result)), { source }) });
    expect(result).toMatchObject({ ok: true, returnValue: "nested failure" });
  }
  expect(load).toHaveBeenCalledOnce();
});

it("replays deeper imported settlements with per-host-outcome identity isolation", async () => {
  const leaf = Promise.resolve({ count: 0 });
  const nested = Promise.resolve({ leaf });
  const first = vi.fn(async () => ({ nested, alias: nested }));
  const second = vi.fn(async () => ({ nested }));
  const source = `const a=await first();const b=await second();
    const left=await (await a.nested).leaf;const right=await (await b.nested).leaf;
    left.count++;return [a.nested===a.alias,a.nested===b.nested,left===right,right.count]`;
  const bindings = { first, second };
  let result = await run(source, { bindings });
  expect(result).toMatchObject({ ok: true, returnValue: [true, false, false, 0] });
  for (let iteration = 0; iteration < 2; iteration++) {
    result = await run(source, { bindings, snapshot: restore(JSON.parse(await dump(result)), { source }) });
    expect(result).toMatchObject({ ok: true, returnValue: [true, false, false, 0] });
  }
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
});

it.each([false, true])("replays a nested settled Promise returned by a host function (async: %s)", async asynchronous => {
  const source = "const value=await load();return [value.left===value.right,await value.left]";
  const nested = Promise.resolve(7);
  const load = vi.fn(asynchronous ? async () => ({ left: nested, right: nested }) : () => ({ left: nested, right: nested }));
  let result = await run(source, { bindings: { load } });
  expect(result).toMatchObject({ ok: true, returnValue: [true, 7] });
  for (let iteration = 0; iteration < 2; iteration++) {
    result = await run(source, { bindings: { load }, snapshot: restore(JSON.parse(await dump(result)), { source }) });
    expect(result).toMatchObject({ ok: true, returnValue: [true, 7] });
  }
  expect(load).toHaveBeenCalledOnce();
});

it("preserves tracked Promise order across delayed and immediately resolved host results", async () => {
  let resolve!: (value: { nested: Promise<number> }) => void;
  const pending = new Promise<{ nested: Promise<number> }>(yes => { resolve = yes; });
  const slow = vi.fn(() => pending);
  const fast = vi.fn(async () => ({ nested: Promise.resolve(2) }));
  const release = vi.fn(() => { resolve({ nested: Promise.resolve(1) }); });
  const source = "const left=slow();const right=fast();release();return [await(await left).nested,await(await right).nested]";
  const bindings = { slow, fast, release };
  let result = await run(source, { bindings });
  expect(result).toMatchObject({ ok: true, returnValue: [1, 2] });
  for (let iteration = 0; iteration < 2; iteration++) {
    result = await run(source, { bindings, snapshot: restore(JSON.parse(await dump(result)), { source }) });
    expect(result).toMatchObject({ ok: true, returnValue: [1, 2] });
  }
  for (const operation of Object.values(bindings)) expect(operation).toHaveBeenCalledOnce();
});
