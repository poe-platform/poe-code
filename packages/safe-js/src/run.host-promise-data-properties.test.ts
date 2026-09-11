import { expect, it, vi } from "vitest";
import { dump, restore, run } from "./index.js";

it.each([false, true])("replays new host Promise data properties (async: %s)", async asynchronous => {
  const nested = Promise.resolve(7);
  Object.defineProperties(nested, {
    label: { value: "answer", enumerable: true },
    self: { value: nested }
  });
  const load = vi.fn(asynchronous ? async () => ({ nested }) : () => ({ nested }));
  const source = "const value = await load(); return [value.nested.label, value.nested.self === value.nested, await value.nested]";
  let result = await run(source, { bindings: { load } });
  expect(result).toMatchObject({ ok: true, returnValue: ["answer", true, 7] });
  for (let iteration = 0; iteration < 2; iteration++) {
    result = await run(source, { bindings: { load }, snapshot: restore(JSON.parse(await dump(result)), { source }) });
    expect(result, `replay generation ${iteration + 1}`).toMatchObject({ ok: true, returnValue: ["answer", true, 7] });
  }
  expect(load).toHaveBeenCalledOnce();
});

it("replays original host Promise properties rather than later guest mutations", async () => {
  const nested = Object.assign(Promise.resolve(7), { data: { count: 0 } });
  const load = vi.fn(() => ({ nested }));
  const source = "const value = await load(); const before = value.nested.data.count; value.nested.data.count++; await value.nested; return before";
  let result = await run(source, { bindings: { load } });
  expect(result).toMatchObject({ ok: true, returnValue: 0 });
  for (let iteration = 0; iteration < 2; iteration++) {
    result = await run(source, { bindings: { load }, snapshot: restore(JSON.parse(await dump(result)), { source }) });
    expect(result).toMatchObject({ ok: true, returnValue: 0 });
  }
  expect(load).toHaveBeenCalledOnce();
});

it("replays callable properties with explicit input capabilities", async () => {
  const read = vi.fn(() => 11);
  const nested = Object.assign(Promise.resolve(7), { read });
  const load = vi.fn(() => ({ nested }));
  const source = "const value = await load(); return [value.nested.read(), await value.nested]";
  let result = await run(source, { bindings: { read, load } });
  expect(result).toMatchObject({ ok: true, returnValue: [11, 7] });
  result = await run(source, { bindings: { read, load }, snapshot: restore(JSON.parse(await dump(result)), { source }) });
  expect(result).toMatchObject({ ok: true, returnValue: [11, 7] });
  expect(load).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledOnce();
});
