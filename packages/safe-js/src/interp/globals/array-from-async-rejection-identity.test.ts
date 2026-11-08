import { assert, expect, it } from "vitest";
import { run } from "../../run.js";

it.each(["get length(){throw reason}", "get [Symbol.asyncIterator](){throw reason}"])(
  "preserves guest rejection identity in reactions: %s",
  async property => {
    const result = await run(`
      function E() {}
      const reason = new E();
      const input = {${property}};
      const values = await Array.fromAsync(input).then(
        () => ['unexpected fulfillment'],
        error => [error === reason, error.constructor === E, error instanceof E]
      );
      const control = await Promise.reject(reason).then(undefined, error => error === reason);
      return [values, control];
    `);
    assert(result.ok);
    expect(result.returnValue).toEqual([[true, true, true], true]);
  }
);
