import { expect, it, vi } from "vitest";
import { dump, restore, run } from "./index.js";

it.each([
  { asynchronous: false, promiseFirst: false },
  { asynchronous: false, promiseFirst: true },
  { asynchronous: true, promiseFirst: false },
  { asynchronous: true, promiseFirst: true }
])("preserves aliases between Promise properties and their host outcome %j", async ({ asynchronous, promiseFirst }) => {
  const shared = { count: 0 };
  const nested = Object.assign(Promise.resolve(7), { data: shared });
  const payload = promiseFirst ? { nested, shared } : { shared, nested };
  const load = vi.fn(asynchronous ? async () => payload : () => payload);
  const source = "const value = await load(); const same = value.shared === value.nested.data; value.shared.count++; await value.nested; return [same, value.nested.data.count]";
  let result = await run(source, { bindings: { load } });
  expect(result).toMatchObject({ ok: true, returnValue: [true, 1] });
  for (let generation = 0; generation < 2; generation++) {
    result = await run(source, { bindings: { load }, snapshot: restore(JSON.parse(await dump(result)), { source }) });
    expect(result, `replay generation ${generation + 1}`).toMatchObject({ ok: true, returnValue: [true, 1] });
  }
  expect(load).toHaveBeenCalledOnce();
});

it.each([false, true])("preserves property aliases in an imported input settlement (promise first: %s)", async promiseFirst => {
  const shared = { count: 0 };
  const nested = Object.assign(Promise.resolve(7), { data: shared });
  const input = Promise.resolve(promiseFirst ? { nested, shared } : { shared, nested });
  const source = "const value = await input; const same = value.shared === value.nested.data; value.shared.count++; await value.nested; return [same, value.nested.data.count]";
  let result = await run(source, { bindings: { input } });
  expect(result).toMatchObject({ ok: true, returnValue: [true, 1] });
  for (let generation = 0; generation < 2; generation++) {
    result = await run(source, { snapshot: restore(JSON.parse(await dump(result)), { source }) });
    expect(result, `replay generation ${generation + 1}`).toMatchObject({ ok: true, returnValue: [true, 1] });
  }
});
