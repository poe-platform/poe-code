import { expect, it, vi } from "vitest";
import { createExecutionContext } from "./execution.js";
import { parseTex } from "./latex-syntax.js";
import { expandTex } from "./latex-expansion.js";
import { createFormatRegistry } from "./index.js";

it("cancels inside a LaTeX lexer run before an invalid suffix", async () => {
  const controller = new AbortController();
  const yieldTurn = vi.fn(async () => { controller.abort(); });
  const context = createExecutionContext("read", { signal: controller.signal, yield: yieldTurn });
  const text = "x".repeat(1024) + String.raw`\directlua{denied}`;
  const selection = createFormatRegistry().resolve("latex", "read");
  await expect(selection.reader!.read({ text, bytes: new TextEncoder().encode(text) }, context, selection))
    .rejects.toMatchObject({ code: "E_CANCELLED" });
  expect(yieldTurn).toHaveBeenCalledTimes(1);
  await context.close();
});

it("yields during LaTeX expansion admission rather than after expanded allocation", async () => {
  const source = String.raw`\newcommand{\a}{` + "x".repeat(1024) + String.raw`}\a`;
  const admission = createExecutionContext("read", { yield: async () => {} });
  const tokens = await parseTex(source, admission);
  await admission.close();
  const controller = new AbortController();
  let expanded = 0, yieldedAfter = -1;
  const context = createExecutionContext("read", {
    signal: controller.signal, yield: async () => { yieldedAfter = expanded; controller.abort(); }
  });
  const charge = context.charge.bind(context);
  context.charge = (key, amount) => { charge(key, amount); if (key === "expandedBytes") expanded += amount; };
  await expect(expandTex(tokens, context)).rejects.toMatchObject({ code: "E_CANCELLED" });
  expect(yieldedAfter).toBeGreaterThanOrEqual(0);
  expect(yieldedAfter).toBeLessThan(512);
  await context.close();
});
