import { expect, it, vi } from "vitest";
import { jsonReader } from "./json.js";
import { createExecutionContext } from "./execution.js";
import { parseStrictJson } from "./strict-json.js";

it("cancels during JSON token admission before reaching an invalid trailing key", async () => {
  const controller = new AbortController();
  const yieldTurn = vi.fn(async () => { controller.abort(); });
  const context = createExecutionContext("read", { signal: controller.signal, yield: yieldTurn });
  // The invalid suffix distinguishes a real parser checkpoint from an AST
  // translation checkpoint reached only after synchronous parsing has finished.
  const text = '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[' +
    Array.from({ length: 300 }, () => '{"t":"Para","c":[{"t":"Str","c":"original"}]}').join(",") +
    '],"unfinished":';
  await expect(jsonReader.read({ bytes: new TextEncoder().encode(text), text }, context))
    .rejects.toMatchObject({ code: "E_CANCELLED" });
  expect(yieldTurn).toHaveBeenCalledTimes(1);
  await context.close();
});

it.each(['"' + "a".repeat(1024), "1".repeat(1024), " ".repeat(1024) + "?"])(
  "cooperatively cancels within a single oversized JSON token %#", async text => {
    const controller = new AbortController();
    const context = createExecutionContext("read", {
      signal: controller.signal, yield: async () => { controller.abort(); }
    });
    await expect(parseStrictJson(text, context, () => { throw new Error("suffix reached"); }))
      .rejects.toMatchObject({ code: "E_CANCELLED" });
    await context.close();
  }
);

it.each([
  ["depth", "[".repeat(16) + "0" + "]".repeat(16), 4],
  ["nodes", "[0,1,2,3,4,5]", 4],
  ["references", '["a","b","c","d"]', 4],
  ["retainedBytes", '"' + "a".repeat(256) + '"', 64],
  ["work", " ".repeat(256) + "0", 64]
] as const)("admits JSON %s before intermediate growth", async (key, text, limit) => {
  const context = createExecutionContext("read", { limits: { [key]: limit }, yield: async () => {} });
  await expect(parseStrictJson(text, context, () => { throw new Error("syntax failure"); }))
    .rejects.toMatchObject({ code: "E_LIMIT", message: expect.stringContaining(key) });
  await context.close();
});
