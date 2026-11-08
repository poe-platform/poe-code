import { describe, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { parseDynamicFunction, parseEvalScript, parseModule } from "./parser.js";

const templates = ["`${import.meta}`", "tag`${import.meta}`", "`${`${import.meta}`}`"];

describe("template interpolation parser context", () => {
  it.each(templates)("rejects import.meta in eval and Function bodies: %s", source => {
    expect(() => parseEvalScript(source)).toThrow("import.meta is only valid in module source");
    expect(() => parseDynamicFunction("normal", "", `return ${source};`))
      .toThrow("import.meta is only valid in module source");
    expect(() => parseModule(`return ${source};`)).not.toThrow();
  });

  it.each(["eval", "Function"])("throws SyntaxError at runtime through %s", async kind => {
    const body = "`${typeof import.meta}`";
    const expression = kind === "eval"
      ? `eval(${JSON.stringify(body)})`
      : `new Function(${JSON.stringify(`return ${body};`)})()`;
    const result = await run(`try { ${expression}; return "accepted"; } catch (error) { return error.name; }`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.returnValue).toBe("SyntaxError");
  });

  it.each(["", "tag"])("counts nested %s template interpolations toward conditional depth", tag => {
    const lease = new Budget({ maxCallDepth: 4 }).acquireCompileOwner();
    const nested = (depth: number) => {
      let expression = "1";
      for (let index = 0; index < depth; index++) expression = tag + "`${true ? " + expression + " : 0}`";
      return `return ${expression};`;
    };
    try {
      expect(() => parseModule(nested(4), "template.ajs", lease.owner)).not.toThrow();
      expect(() => parseModule(nested(5), "template.ajs", lease.owner))
        .toThrow("Conditional expression nesting limit exceeded");
    } finally { lease.release(); }
  });

  it.each(["true ? `${true ? 1 : 2}` : 0", "true ? 0 : `${true ? 1 : 2}`"])(
    "inherits outer conditional depth: %s", expression => {
      const lease = new Budget({ maxCallDepth: 1 }).acquireCompileOwner();
      try {
        expect(() => parseModule(`return ${expression};`, "template.ajs", lease.owner))
          .toThrow("Conditional expression nesting limit exceeded");
        expect(() => parseModule("return true ? `${() => true ? 1 : 2}` : 0;", "template.ajs", lease.owner))
          .not.toThrow();
      } finally { lease.release(); }
    }
  );
});
