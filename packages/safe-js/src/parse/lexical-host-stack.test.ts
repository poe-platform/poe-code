import { expect, it, vi } from "vitest";
import { formatParseError } from "./format-error.js";
import { lint } from "../lint/index.js";
import { run } from "../run.js";
import * as tokenizer from "./tokenizer.js";

it("preserves unlocated parser error identity without exposing host frames or inventing a span", () => {
  const error = new RangeError("parser capacity exhausted");
  expect(() => formatParseError("(1)", "guest.ajs", error)).toThrow(error);
  expect(error.stack).toBe("RangeError: parser capacity exhausted");
  expect(error).toMatchObject({ filename: "guest.ajs" });
  expect(error).not.toHaveProperty("span");
});

it("scrubs unlocated lexical failures in SDK and lint while accepting deep grouping", async () => {
  const source = "(".repeat(1024) + "1" + ")".repeat(1024);
  expect(await run(source, { filename: "guest.ajs" })).toMatchObject({ ok: true });
  expect(lint(source, { filename: "guest.ajs" }).filter(item => item.severity === "error")).toEqual([]);
  const failures = [new RangeError("parser capacity exhausted"), new RangeError("lexer capacity exhausted")];
  const tokenize = vi.spyOn(tokenizer, "tokenize").mockImplementation(() => { throw failures[0]; });
  const comments = vi.spyOn(tokenizer, "collectComments").mockImplementation(() => { throw failures[1]; });
  const errors: unknown[] = [];
  try {
    try { await run(source, { filename: "guest.ajs" }); } catch (error) { errors.push(error); }
    try { lint(source, { filename: "guest.ajs" }); } catch (error) { errors.push(error); }
  } finally {
    tokenize.mockRestore();
    comments.mockRestore();
  }
  expect(errors).toHaveLength(2);
  for (const [index, error] of errors.entries()) {
    expect(error).toBe(failures[index]);
    expect(["RangeError", "ParseError"]).toContain((error as Error).name);
    expect(error).toMatchObject({ filename: "guest.ajs" });
    expect((error as Error).stack).toBe(`${(error as Error).name}: ${(error as Error).message}`);
  }
});

it("retains shallow expression semantics and positioned syntax errors", async () => {
  expect(await run("return (((1 + 2)))", { filename: "guest.ajs" }))
    .toMatchObject({ ok: true, returnValue: 3 });
  expect(lint("const x = (((1 + 2)));", { filename: "guest.ajs" })
    .filter(item => item.severity === "error")).toEqual([]);
  await expect(run("const x = );", { filename: "guest.ajs" })).rejects
    .toMatchObject({ name: "ParseError", filename: "guest.ajs", line: 1, column: 11 });
});
