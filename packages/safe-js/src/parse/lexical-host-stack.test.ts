import { expect, it } from "vitest";
import { formatParseError } from "./format-error.js";
import { lint } from "../lint/index.js";
import { run } from "../run.js";

it("preserves unlocated parser error identity without exposing host frames or inventing a span", () => {
  const error = new RangeError("parser capacity exhausted");
  expect(() => formatParseError("(1)", "guest.ajs", error)).toThrow(error);
  expect(error.stack).toBe("RangeError: parser capacity exhausted");
  expect(error).toMatchObject({ filename: "guest.ajs" });
  expect(error).not.toHaveProperty("span");
});

it("scrubs bounded hostile Agent Script parse errors in SDK and lint", async () => {
  const source = "(".repeat(1024) + "1" + ")".repeat(1024);
  const errors: unknown[] = [];
  try { await run(source, { filename: "guest.ajs" }); } catch (error) { errors.push(error); }
  try { lint(source, { filename: "guest.ajs" }); } catch (error) { errors.push(error); }
  expect(errors).toHaveLength(2);
  for (const error of errors) {
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
