import { expect, it } from "vitest";
import { dump, restore, run } from "./index.js";

it.each(["fulfilled", "rejected"] as const)(
  "replays a newly encountered %s Promise and its aliases",
  async status => {
    const nested = status === "fulfilled" ? Promise.resolve(7) : Promise.reject(new Error("reason"));
    void nested.catch(() => undefined);
    const source = `const value = await input;
      let outcome; try { outcome = ['fulfilled', await value.left]; }
      catch (reason) { outcome = ['rejected', reason.message]; }
      return [value.left === value.right, outcome]`;
    let result = await run(source, {
      bindings: { input: Promise.resolve({ left: nested, right: nested }) }
    });
    const expected = [true, [status, status === "fulfilled" ? 7 : "reason"]];
    expect(result).toMatchObject({ ok: true, returnValue: expected });
    for (let count = 0; count < 2; count++) {
      result = await run(source, { snapshot: restore(JSON.parse(await dump(result)), { source }) });
      expect(result).toMatchObject({ ok: true, returnValue: expected });
    }
  }
);

it("replays a newly encountered Promise whose fulfillment refers back to itself", async () => {
  const value: { self?: Promise<unknown> } = {};
  const nested = Promise.resolve(value);
  value.self = nested;
  const source = "const value = await input; return (await value.nested).self === value.nested";
  let result = await run(source, { bindings: { input: Promise.resolve({ nested }) } });
  delete value.self;
  expect(result).toMatchObject({ ok: true, returnValue: true });
  for (let count = 0; count < 2; count++) {
    result = await run(source, { snapshot: restore(JSON.parse(await dump(result)), { source }) });
    expect(result).toMatchObject({ ok: true, returnValue: true });
  }
});

it("preserves newly encountered Promise identity across separate journal outcomes", async () => {
  const nested = Promise.resolve(7);
  const source = "const a=await first;const b=await second;return a.nested===b.nested";
  const first = await run(source, { bindings: {
    first: Promise.resolve({ nested }), second: Promise.resolve({ nested })
  } });
  expect(first).toMatchObject({ ok: true, returnValue: true });
  const replayed = await run(source, { snapshot: restore(JSON.parse(await dump(first)), { source }) });
  expect(replayed).toMatchObject({ ok: true, returnValue: true });
});

it.each(["first", "second"])("preserves shared settlement identity when awaiting %s first", async order => {
  const payload = { count: 0 };
  const nested = Promise.resolve(payload);
  const source = `const a=await ${order}; const b=await ${order === "first" ? "second" : "first"};
    const left=await a.nested; const right=await b.nested;
    left.count++; return [left===right,right.count,a===b]`;
  let result = await run(source, { bindings: {
    first: Promise.resolve({ nested }), second: Promise.resolve({ nested })
  } });
  expect(result).toMatchObject({ ok: true, returnValue: [true, 1, false] });
  expect(payload.count).toBe(0);
  for (let count = 0; count < 2; count++) {
    result = await run(source, { snapshot: restore(JSON.parse(await dump(result)), { source }) });
    expect(result).toMatchObject({ ok: true, returnValue: [true, 1, false] });
  }
});

it("does not merge independent Promises with equal settlements", async () => {
  const source = "const a=await first;const b=await second;return [a.nested===b.nested,(await a.nested)===(await b.nested)]";
  let result = await run(source, { bindings: {
    first: Promise.resolve({ nested: Promise.resolve({ value: 7 }) }),
    second: Promise.resolve({ nested: Promise.resolve({ value: 7 }) })
  } });
  expect(result).toMatchObject({ ok: true, returnValue: [false, false] });
  for (let count = 0; count < 2; count++) {
    result = await run(source, { snapshot: restore(JSON.parse(await dump(result)), { source }) });
    expect(result).toMatchObject({ ok: true, returnValue: [false, false] });
  }
});

it("replays the original settlement rather than guest-mutated Promise state", async () => {
  const payload = { count: 0 };
  const source = "const value=await (await input).nested; return ++value.count";
  let result = await run(source, { bindings: {
    input: Promise.resolve({ nested: Promise.resolve(payload) })
  } });
  expect(result).toMatchObject({ ok: true, returnValue: 1 });
  expect(payload.count).toBe(0);
  for (let count = 0; count < 2; count++) {
    result = await run(source, { snapshot: restore(JSON.parse(await dump(result)), { source }) });
    expect(result).toMatchObject({ ok: true, returnValue: 1 });
  }
});

it("replays mutually referring new Promises reached through different outcomes", async () => {
  const leftValue: { peer?: Promise<unknown> } = {};
  const rightValue: { peer?: Promise<unknown> } = {};
  const left = Promise.resolve(leftValue);
  const right = Promise.resolve(rightValue);
  leftValue.peer = right;
  rightValue.peer = left;
  const source = `const b=await second; const a=await first;
    return [(await a.nested).peer===b.nested,(await b.nested).peer===a.nested]`;
  let result = await run(source, { bindings: {
    first: Promise.resolve({ nested: left }), second: Promise.resolve({ nested: right })
  } });
  delete leftValue.peer;
  delete rightValue.peer;
  expect(result).toMatchObject({ ok: true, returnValue: [true, true] });
  for (let count = 0; count < 2; count++) {
    result = await run(source, { snapshot: restore(JSON.parse(await dump(result)), { source }) });
    expect(result).toMatchObject({ ok: true, returnValue: [true, true] });
  }
});
