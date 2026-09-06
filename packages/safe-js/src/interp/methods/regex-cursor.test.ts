import { describe, expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { createSandboxRegex } from "../values.js";
import { callRegexMethod } from "./regex.js";
import { callStringMethod } from "./string.js";
import { isSandboxRegExpIterator } from "../regexp-iterator.js";
import { nextRegExpIterator } from "./regexp-iterator.js";

const originalCursorWorkflow = `const expression = /a/g;
expression.lastIndex = 2;
const all = [...'aba'.matchAll(expression)].map(match => match[0]);
const afterMatchAll = expression.lastIndex;
const matched = 'aba'.match(expression);
const afterMatch = expression.lastIndex;
expression.lastIndex = 2;
const replaced = 'aba'.replace(expression, 'X');
return { all, afterMatchAll, matched, afterMatch, replaced, afterReplace: expression.lastIndex };
`;

type CursorMethod =
  | "exec"
  | "test"
  | "match"
  | "matchAll"
  | "search"
  | "replace"
  | "replaceAll"
  | "split";

const cursorMethods: CursorMethod[] = [
  "exec",
  "test",
  "match",
  "matchAll",
  "search",
  "replace",
  "replaceAll",
  "split"
];

describe("STR-04 regex cursor semantics", () => {
  it("reproduces the original cursor workflow against a native anchor", async () => {
    const expected = {
      all: ["a"],
      afterMatchAll: 2,
      matched: ["a", "a"],
      afterMatch: 0,
      replaced: "XbX",
      afterReplace: 0
    };
    expect(new Function(originalCursorWorkflow)()).toEqual(expected);
    await expect(run(originalCursorWorkflow)).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  const cases = ["", "g", "i", "gi", "m", "gm", "s", "gs"].flatMap((flags) =>
    [-2, 0, 1, 2, 2.75, 3, 4].flatMap((lastIndex) =>
      cursorMethods
        .filter(
          (method) => flags.includes("g") || (method !== "matchAll" && method !== "replaceAll")
        )
        .map((method) => ({ flags, lastIndex, method }))
    )
  );

  it.each(cases)(
    "$method /a/$flags from $lastIndex agrees with native",
    async ({ flags, lastIndex, method }) => {
      const native = new RegExp("a", flags);
      native.lastIndex = lastIndex;
      let expected: unknown;
      if (method === "exec" || method === "test") {
        expected = native[method]("aba");
      } else if (method === "matchAll") {
        expected = [..."aba".matchAll(native)];
      } else if (method === "replace" || method === "replaceAll") {
        expected = "aba"[method](native, "X");
      } else {
        expected = "aba"[method](native);
      }
      const regex = createSandboxRegex("a", flags, lastIndex);
      let actual =
        method === "exec" || method === "test"
          ? await callRegexMethod(regex, method, ["aba"], new Budget())
          : await callStringMethod(
              "aba",
              method,
              [regex, ...(method === "replace" || method === "replaceAll" ? ["X"] : [])],
              new Budget()
            );
      if (isSandboxRegExpIterator(actual)) {
        const iterator = actual;
        actual = Array.from({ [Symbol.iterator]: () => ({ next: () => nextRegExpIterator(iterator) }) });
      }
      expect(regex.lastIndex).toBe(native.lastIndex);
      expect(JSON.parse(JSON.stringify(actual))).toEqual(JSON.parse(JSON.stringify(expected)));
    }
  );

  it.each(cursorMethods)("%s preserves native cursor transitions on failure", async (method) => {
    const source = `
      const regex = /z/g;
      regex.lastIndex = 2;
      ${method === "exec" || method === "test" ? `regex.${method}("aba")` : `"aba".${method}(regex${method === "replace" || method === "replaceAll" ? ', "X"' : ""})`};
      const afterOperation = regex.lastIndex;
      const next = regex.exec("z");
      return { afterOperation, next: next === null ? null : next[0], afterExec: regex.lastIndex };
    `;
    const expected = new Function(source)();
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["(?:)", "^", "$"])(
    "handles zero-width /%s/g without advancing exec or test",
    async (pattern) => {
      const source = `
      const regex = new RegExp(${JSON.stringify(pattern)}, "g");
      regex.lastIndex = 1;
      const all = [..."ab".matchAll(regex)].map(match => match[0]);
      const afterAll = regex.lastIndex;
      const matched = "ab".match(regex);
      const afterMatch = regex.lastIndex;
      regex.lastIndex = 1;
      const replaced = "ab".replace(regex, "X");
      const afterReplace = regex.lastIndex;
      const executed = regex.exec("ab");
      const afterExec = regex.lastIndex;
      const tested = regex.test("ab");
      return { all, afterAll, matched, afterMatch, replaced, afterReplace,
        executed: executed === null ? null : executed[0], afterExec, tested, afterTest: regex.lastIndex };
    `;
      const expected = new Function(source)();
      await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
    }
  );

  it.each(["replace", "replaceAll"])(
    "%s finishes scanning before callbacks and preserves their cursor writes",
    async (method) => {
      const source = `
      const regex = /a/g;
      regex.lastIndex = 2;
      const seen = [];
      const replaced = "aba".${method}(regex, (match, offset) => {
        seen.push([offset, regex.lastIndex]);
        regex.lastIndex = 1;
        const next = regex.exec("aba");
        seen.push([next[0], regex.lastIndex]);
        return "X";
      });
      return { replaced, seen, lastIndex: regex.lastIndex };
    `;
      const expected = {
        replaced: "XbX",
        seen: [
          [0, 0],
          ["a", 3],
          [2, 3],
          ["a", 3]
        ],
        lastIndex: 3
      };
      expect(new Function(source)()).toEqual(expected);
      await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
    }
  );

  it("retains callback cursor writes when replacement throws", async () => {
    const source = `
      const regex = /a/g;
      regex.lastIndex = 2;
      const seen = [];
      try {
        "aba".replace(regex, () => {
          seen.push(regex.lastIndex);
          regex.lastIndex = 1;
          throw "stop";
        });
      } catch (error) {
        return { seen, lastIndex: regex.lastIndex, error };
      }
    `;
    const expected = { seen: [0], lastIndex: 1, error: "stop" };
    expect(new Function(source)()).toEqual(expected);
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it("keeps matchAll's copied scan independent of later cursor writes", async () => {
    const source = `
      const regex = /a/g;
      regex.lastIndex = 2;
      const matches = "aba".matchAll(regex);
      regex.lastIndex = 0;
      const all = [...matches].map(match => match[0]);
      const next = regex.exec("aba");
      return { all, next: next[0], lastIndex: regex.lastIndex };
    `;
    const expected = { all: ["a"], next: "a", lastIndex: 1 };
    expect(new Function(source)()).toEqual(expected);
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["", "g"])("split /a/%s preserves the receiver across bounded limits", async (flags) => {
    const source = `
      const regex = new RegExp("a", ${JSON.stringify(flags)});
      regex.lastIndex = 2;
      const none = "aba".split(regex, 0);
      const one = "aba".split(regex, 1);
      const all = "aba".split(regex);
      const afterSplit = regex.lastIndex;
      const next = regex.exec("aba");
      return { none, one, all, afterSplit, next: next[0], afterExec: regex.lastIndex };
    `;
    const expected = new Function(source)();
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["y", "gy"])("keeps unsupported %s flags outside the accepted subset", (flags) => {
    expect(() => createSandboxRegex("a", flags)).toThrow("Unsupported regex flag 'y'");
  });
});
