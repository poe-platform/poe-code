import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { coerceThrownValue } from "./exceptions.js";

it.each(["missing", "missing()", "missing++"])("retains the source location of %s in catch", async expression => {
  const result = await run(`try {\n${expression}\n} catch (error) { return error.stack; }`);
  expect(result).toMatchObject({ ok: true, returnValue: expect.stringContaining("(line 2, column 1)") });
});

it("retains the source location through Promise rejection delivery", async () => {
  const result = await run("return await Promise.resolve().then(() => {\nreturn missing;\n}).catch(error => error.stack)");
  expect(result).toMatchObject({ ok: true, returnValue: expect.stringContaining("(line 2, column 8)") });
});

it("does not import a native host error stack", () => {
  const error = new ReferenceError("missing");
  error.stack = "private host path and context";
  expect(coerceThrownValue(error, new Budget(), [])).toMatchObject({
    stack: "ReferenceError: missing"
  });
});
