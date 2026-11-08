import { expect, it } from "vitest";
import { run } from "../core.js";

it("reads guest spread result getters once and skips value after truthy done", async () => {
  const source = `
    const log = [];
    let index = 0;
    const iterable = {
      [Symbol.iterator]() {
        return {
          next() {
            const current = index++;
            return {
              get done() { log.push('done'); return current ? 'finished' : 0; },
              get value() { log.push('value'); if (current) throw 'unused'; return 7; }
            };
          }
        };
      }
    };
    return [[...iterable], log];
  `;
  expect(await run(source)).toMatchObject({
    ok: true,
    returnValue: [[7], ["done", "value", "done"]]
  });
});

it("preserves promised values in built-in and guest synchronous spreads", async () => {
  const source = `
    const promise = Promise.resolve(7);
    const iterable = {
      [Symbol.iterator]() {
        let done = false;
        return { next() { const previous = done; done = true; return {done: previous, value: promise}; } };
      }
    };
    return [[...[promise]][0] === promise, [...iterable][0] === promise];
  `;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: [true, true] });
});
