import { expect, it } from "vitest";
import { dump, restore, run } from "./index.js";

it.each(["Map", "Set"] as const)("preserves a %s settled by an imported Promise", async kind => {
  const collection = kind === "Map" ? new Map([["key", 7]]) : new Set([7]);
  const source = kind === "Map"
    ? "const value = await input; return [value.get('key'), value.size]"
    : "const value = await input; return [value.has(7), value.size]";
  const expected = kind === "Map" ? [7, 1] : [true, 1];
  let result = await run(source, { bindings: { input: Promise.resolve(collection) } });
  expect(result).toMatchObject({ ok: true, returnValue: expected });
  for (let count = 0; count < 2; count++) {
    result = await run(source, { snapshot: restore(JSON.parse(await dump(result)), { source }) });
    expect(result).toMatchObject({ ok: true, returnValue: expected });
  }
});

it("preserves collection cycles and aliases through settlement copying", async () => {
  const map = new Map<unknown, unknown>();
  const set = new Set<unknown>();
  map.set(map, set);
  set.add(map);
  const source = `const value = await input;
    return [value.map === value.again, value.map.get(value.map) === value.set,
      value.set.has(value.map)]`;
  let result = await run(source, {
    bindings: { input: Promise.resolve({ map, again: map, set }) }
  });
  expect(result).toMatchObject({ ok: true, returnValue: [true, true, true] });
  result = await run(source, { snapshot: restore(JSON.parse(await dump(result)), { source }) });
  expect(result).toMatchObject({ ok: true, returnValue: [true, true, true] });
});
