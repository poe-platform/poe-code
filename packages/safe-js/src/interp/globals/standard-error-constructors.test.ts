import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";
import { createErrorGlobals } from "./error.js";

it.each(["URIError", "EvalError"].flatMap(name => [false, true].map(construct => ({ name, construct })) ))(
  "provides $name (new=$construct)", async ({ name, construct }) => {
    const source = `const error=${construct ? "new " : ""}${name}("message",{cause:7});return [error.name,error.message,error.cause,error instanceof ${name},error instanceof Error,error instanceof TypeError]`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: [name, "message", 7, true, true, false] });
  }
);

it.each(["URIError", "EvalError"].flatMap(name => ["pending", "completed"].map(mode => ({ name, mode })) ))(
  "preserves $name references and brands in $mode checkpoints", async ({ name, mode }) => {
    const source = `const Constructor=${name};const error=new Constructor("message");error.name="changed";await 0;return [Constructor===${name},error instanceof Constructor,error instanceof Error,error.name,error.message]`;
    const pending = run(source);
    const completed = pending.catch(error => error);
    try {
      if (mode === "completed") await completed;
      const snapshot = restore(JSON.parse(await dump(pending)), { source });
      expect(await completed).toMatchObject({ ok: true, returnValue: [true, true, true, "changed", "message"] });
      expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: [true, true, true, "changed", "message"] });
    } finally { await completed; }
  }
);

it.each(["URIError", "EvalError"])("preserves uncaught %s names", async name => {
  await expect(run(`throw new ${name}("message")`)).rejects.toMatchObject({ name, message: "message" });
});

it.each(["URIError", "EvalError"] as const)("bounds %s message allocation", name => {
  const globals = createErrorGlobals({ budget: new Budget({ stringLength: 16 }) });
  expect(() => globals[name].call(["message".repeat(10)]))
    .toThrow(expect.objectContaining({ name: "SandboxError" }));
});

it.each(["URIError", "EvalError"])("supports primitive %s messages", async name => {
  expect(await run(`return [new ${name}().message,new ${name}(42).message,new ${name}(null).message]`))
    .toMatchObject({ ok: true, returnValue: ["", "42", "null"] });
});
