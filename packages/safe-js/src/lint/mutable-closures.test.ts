import { describe, expect, it } from "vitest";

import { run } from "../run.js";
import { lint } from "./index.js";

describe("mutable closures", () => {
  it.each([
    {
      name: "shares writes between sibling closures",
      source: `
        let count = 0;
        const increment = () => { count += 1; };
        const read = () => count;
        increment();
        increment();
        return read();
      `,
      expected: 2
    },
    {
      name: "keeps per-iteration captures independent",
      source: `
        const readers = [];
        for (let index = 0; index < 3; index += 1) {
          readers.push(() => { index += 10; return index; });
        }
        return readers.map((read) => read());
      `,
      expected: [10, 11, 12]
    },
    {
      name: "captures current values in parameter defaults",
      source: `
        let count = 1;
        const read = (value = () => count) => value();
        count = 7;
        return read();
      `,
      expected: 7
    },
    {
      name: "preserves shadowing across nested closures",
      source: `
        let count = 1;
        const create = (count) => () => { count += 1; return count; };
        const increment = create(10);
        increment();
        return [increment(), count];
      `,
      expected: [12, 1]
    },
    {
      name: "shares captures through asynchronous branches",
      source: `
        let count = 0;
        const increment = async () => {
          await Promise.resolve();
          count += 1;
        };
        await Promise.all([increment(), increment()]);
        return count;
      `,
      expected: 2
    }
  ])("$name", async ({ source, expected }) => {
    expect(lint(source).filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it("accepts legacy AS002 suppressions without requiring them", () => {
    const source = "// @as-disable-file AS002\nlet count = 0; return (() => count)();";
    expect(lint(source)).toEqual([]);
  });
});
