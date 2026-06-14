import { describe, expect, it } from "vitest";

import { DisallowedSyntaxError, parse } from "../parse.js";
import { run } from "../run.js";

describe("parse import.meta", () => {
  it("evaluates import.meta to the configured meta object", async () => {
    await expect(
      expectReturn("return import.meta;", {
        filepath: "agent.ajs",
        nested: {
          value: "ready"
        },
        url: "file:///workspace/agent.ajs"
      })
    ).resolves.toEqual({
      filepath: "agent.ajs",
      nested: {
        value: "ready"
      },
      url: "file:///workspace/agent.ajs"
    });
  });

  it("evaluates import.meta.url to the configured url field", async () => {
    await expect(
      expectReturn("return import.meta.url;", {
        url: "file:///workspace/script.ajs"
      })
    ).resolves.toBe("file:///workspace/script.ajs");
  });

  it("returns undefined for absent import.meta fields", async () => {
    await expect(
      expectReturn("return import.meta.foo;", {
        url: "file:///workspace/script.ajs"
      })
    ).resolves.toBeUndefined();
  });

  it("rejects assignment to import.meta because it is read-only", () => {
    expect(() => parse("import.meta = x")).toThrowError(DisallowedSyntaxError);
  });

  it("rejects assignment to import.meta properties at parse time", () => {
    expect(() => parse("import.meta.x = y")).toThrowError(DisallowedSyntaxError);
  });

  it("rejects import.meta writes before running module bodies", async () => {
    await expect(run("import.meta = x")).rejects.toThrowError(DisallowedSyntaxError);
    await expect(run("import.meta.x = y")).rejects.toThrowError(DisallowedSyntaxError);
    await expect(run("import.meta.x += 1")).rejects.toThrowError(DisallowedSyntaxError);
  });

  it("rejects import.meta property updates as writes", () => {
    expect(() => parse("import.meta.x++")).toThrowError(DisallowedSyntaxError);
    expect(() => parse("++import.meta.x")).toThrowError(DisallowedSyntaxError);
  });

  it.each(["import . meta", "import. meta", "import .meta", "import.\nmeta"])(
    "rejects spaced import.meta spelling %s",
    (source) => {
      expect(() => parse(source)).toThrowError();
    }
  );

  it("works inside arrow, await, and conditional expression bodies", async () => {
    await expect(
      expectReturn(
        [
          "const fromArrow = () => import.meta.url;",
          "const fromAwait = async () => await import.meta.url;",
          'const fromConditional = true ? import.meta.url : "missing";',
          "return JSON.stringify(Array.of(fromArrow(), await fromAwait(), fromConditional));"
        ].join("\n"),
        {
          url: "file:///workspace/nested.ajs"
        }
      )
    ).resolves.toBe(
      JSON.stringify([
        "file:///workspace/nested.ajs",
        "file:///workspace/nested.ajs",
        "file:///workspace/nested.ajs"
      ])
    );
  });

  it("evaluates multiple import.meta uses to the same object identity", async () => {
    await expect(
      expectReturn(
        [
          "const first = import.meta;",
          "const second = import.meta;",
          "const fromArrow = () => import.meta;",
          "return first === second && second === fromArrow();"
        ].join("\n"),
        {
          url: "file:///workspace/same.ajs"
        }
      )
    ).resolves.toBe(true);
  });

  it('evaluates typeof import.meta to "object"', async () => {
    await expect(
      expectReturn("return typeof import.meta;", {
        url: "file:///workspace/type.ajs"
      })
    ).resolves.toBe("object");
  });
});

async function expectReturn(source: string, importMeta: Record<string, unknown>): Promise<unknown> {
  const result = await run(source, {
    importMeta
  });

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }

  return result.returnValue;
}
