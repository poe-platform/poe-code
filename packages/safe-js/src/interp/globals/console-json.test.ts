import { describe, expect, it, vi } from "vitest";

import { Budget, SandboxError } from "../budget.js";
import {
  createSandboxClosure,
  type SandboxArray,
  type SandboxClosure,
  type SandboxObject
} from "../values.js";
import { createConsoleJsonGlobals } from "./console-json.js";

describe("createConsoleJsonGlobals", () => {
  it("writes console output through the provided sink", async () => {
    const sink = {
      error: vi.fn(),
      log: vi.fn()
    };
    const globals = createConsoleJsonGlobals({
      budget: new Budget(),
      sink
    });

    await expect(
      getClosure(getProperty(globals.console, "log")).call(["hello", 42])
    ).resolves.toBeUndefined();
    await expect(
      getClosure(getProperty(globals.console, "error")).call(["fail"])
    ).resolves.toBeUndefined();

    expect(sink.log).toHaveBeenCalledWith("hello", 42);
    expect(sink.error).toHaveBeenCalledWith("fail");
  });

  it("defaults to the host console sink", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const globals = createConsoleJsonGlobals({
      budget: new Budget()
    });

    await expect(
      getClosure(getProperty(globals.console, "log")).call(["hello"])
    ).resolves.toBeUndefined();
    await expect(
      getClosure(getProperty(globals.console, "error")).call(["problem"])
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith("hello");
    expect(error).toHaveBeenCalledWith("problem");

    log.mockRestore();
    error.mockRestore();
  });

  it("parses and stringifies JSON values", async () => {
    const globals = createConsoleJsonGlobals({
      budget: new Budget()
    });
    const parseJson = getClosure(getProperty(globals.JSON, "parse"));
    const stringifyJson = getClosure(getProperty(globals.JSON, "stringify"));

    const parsed = await parseJson.call(['{"name":"poe","count":2}']);

    expect(parsed).toEqual({
      count: 2,
      name: "poe"
    });

    await expect(stringifyJson.call([parsed, null, 2])).resolves.toBe(
      '{\n  "name": "poe",\n  "count": 2\n}'
    );
  });

  it("returns undefined for top-level JSON.stringify(undefined)", async () => {
    const globals = createConsoleJsonGlobals({
      budget: new Budget()
    });
    const stringifyJson = getClosure(getProperty(globals.JSON, "stringify"));

    await expect(stringifyJson.call([undefined])).resolves.toBeUndefined();
  });

  it("returns undefined for top-level JSON.stringify(undefined) even with a string budget", async () => {
    const globals = createConsoleJsonGlobals({
      budget: new Budget({
        stringLength: 1
      })
    });
    const stringifyJson = getClosure(getProperty(globals.JSON, "stringify"));

    await expect(stringifyJson.call([undefined])).resolves.toBeUndefined();
  });

  it("preserves __proto__ as parsed data instead of mutating the object prototype", async () => {
    const globals = createConsoleJsonGlobals({
      budget: new Budget()
    });
    const parseJson = getClosure(getProperty(globals.JSON, "parse"));

    const parsed = (await parseJson.call([
      '{"__proto__":{"polluted":true},"safe":1}'
    ])) as SandboxObject;

    expect(Object.prototype.hasOwnProperty.call(parsed, "__proto__")).toBe(true);
    expect(parsed.__proto__).toEqual({
      polluted: true
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("matches V8 JSON.parse coercion and number edge semantics", async () => {
    const globals = createConsoleJsonGlobals({
      budget: new Budget()
    });
    const parseJson = getClosure(getProperty(globals.JSON, "parse"));

    await expect(parseJson.call(["null"])).resolves.toBeNull();
    await expect(parseJson.call(["1e308"])).resolves.toBe(1e308);
    await expect(parseJson.call(["1e500"])).resolves.toBe(Infinity);
    await expect(parseJson.call([0])).resolves.toBe(0);
  });

  it.each(["NaN", "Infinity", '{"a":1,}', "{a:1}", ""])(
    "throws SyntaxError for invalid JSON.parse input %j",
    async (input) => {
      const globals = createConsoleJsonGlobals({
        budget: new Budget()
      });
      const parseJson = getClosure(getProperty(globals.JSON, "parse"));

      await expect(parseJson.call([input])).rejects.toThrow(SyntaxError);
    }
  );

  it("matches V8 JSON.stringify omission, nulling, indentation, and unsupported BigInt behavior", async () => {
    const globals = createConsoleJsonGlobals({
      budget: new Budget()
    });
    const stringifyJson = getClosure(getProperty(globals.JSON, "stringify"));

    await expect(stringifyJson.call([undefined])).resolves.toBeUndefined();
    await expect(stringifyJson.call([{ a: undefined }])).resolves.toBe("{}");
    await expect(stringifyJson.call([[undefined]])).resolves.toBe("[null]");
    await expect(stringifyJson.call([{ a: 1 }, null, 2])).resolves.toBe('{\n  "a": 1\n}');
    await expect(stringifyJson.call([{ a: 1 }, null, 100])).resolves.toBe(
      `{
          "a": 1
}`
    );
    await expect(stringifyJson.call([{ a: 1n } as never])).rejects.toThrow(TypeError);
  });

  it("rejects circular JSON.stringify values with a TypeError", async () => {
    const globals = createConsoleJsonGlobals({
      budget: new Budget()
    });
    const stringifyJson = getClosure(getProperty(globals.JSON, "stringify"));
    const circular: SandboxObject = {};
    circular.self = circular;

    await expect(stringifyJson.call([circular])).rejects.toThrow(TypeError);
    await expect(stringifyJson.call([circular])).rejects.toThrow("circular");
  });

  it("supports sandbox JSON.stringify replacer functions", async () => {
    const globals = createConsoleJsonGlobals({
      budget: new Budget()
    });
    const stringifyJson = getClosure(getProperty(globals.JSON, "stringify"));
    const replacer = createSandboxClosure({
      call: ([key, value]) => (key === "drop" ? undefined : value)
    });

    await expect(stringifyJson.call([{ keep: 1, drop: 2 }, replacer])).resolves.toBe('{"keep":1}');
  });

  it("honors sandbox toJSON methods before JSON.stringify serializes", async () => {
    const globals = createConsoleJsonGlobals({
      budget: new Budget()
    });
    const stringifyJson = getClosure(getProperty(globals.JSON, "stringify"));

    await expect(
      stringifyJson.call([
        {
          toJSON: createSandboxClosure({
            call: () => "x"
          })
        }
      ])
    ).resolves.toBe('"x"');
  });

  it("honors sandbox array toJSON methods before JSON.stringify serializes", async () => {
    const globals = createConsoleJsonGlobals({
      budget: new Budget()
    });
    const stringifyJson = getClosure(getProperty(globals.JSON, "stringify"));
    const value = [1, 2] as SandboxArray;
    Object.defineProperty(value, "toJSON", {
      value: createSandboxClosure({
        call: () => ({ length: value.length })
      })
    });

    await expect(stringifyJson.call([value])).resolves.toBe('{"length":2}');
  });

  it("passes console edge primitives as separate readable sink arguments", async () => {
    const sink = {
      error: vi.fn(),
      log: vi.fn()
    };
    const globals = createConsoleJsonGlobals({
      budget: new Budget(),
      sink
    });

    await expect(
      getClosure(getProperty(globals.console, "log")).call([undefined, null, NaN, Infinity])
    ).resolves.toBeUndefined();

    expect(sink.log).toHaveBeenCalledWith(undefined, null, NaN, Infinity);
  });

  it("rejects invalid JSON.parse and JSON.stringify arguments", async () => {
    const globals = createConsoleJsonGlobals({
      budget: new Budget()
    });
    const parseJson = getClosure(getProperty(globals.JSON, "parse"));
    const stringifyJson = getClosure(getProperty(globals.JSON, "stringify"));

    await expect(parseJson.call(["{"])).rejects.toThrow(SyntaxError);
    await expect(stringifyJson.call([{ ok: true }, "x"])).rejects.toThrow(
      "JSON.stringify(value, replacer, indent) only supports function, null, or undefined replacers."
    );
    await expect(stringifyJson.call([{ ok: true }, null, false])).rejects.toThrow(
      "JSON.stringify(value, replacer, indent) requires indent to be a string, number, or undefined."
    );
  });

  it("rejects JSON.parse input that exceeds the string-length budget", async () => {
    const globals = createConsoleJsonGlobals({
      budget: new Budget({
        stringLength: 4
      })
    });
    const parseJson = getClosure(getProperty(globals.JSON, "parse"));

    await expect(parseJson.call(['"hello"'])).rejects.toEqual(
      expect.objectContaining({
        budget: "stringLength",
        current: 7,
        limit: 4
      } satisfies Partial<SandboxError>)
    );
  });

  it("rejects parsed arrays and stringified output that exceed budgets", async () => {
    const parseGlobals = createConsoleJsonGlobals({
      budget: new Budget({
        arrayLength: 2,
        stringLength: 64
      })
    });
    const stringifyGlobals = createConsoleJsonGlobals({
      budget: new Budget({
        stringLength: 10
      })
    });
    const parseJson = getClosure(getProperty(parseGlobals.JSON, "parse"));
    const stringifyJson = getClosure(getProperty(stringifyGlobals.JSON, "stringify"));

    await expect(parseJson.call(["[1,2,3]"])).rejects.toEqual(
      expect.objectContaining({
        budget: "arrayLength",
        current: 3,
        limit: 2
      } satisfies Partial<SandboxError>)
    );

    await expect(stringifyJson.call([{ message: "hello" }])).rejects.toEqual(
      expect.objectContaining({
        budget: "stringLength",
        current: 19,
        limit: 10
      } satisfies Partial<SandboxError>)
    );
  });
});

function getProperty(value: SandboxObject, name: string) {
  return value[name];
}

function getClosure(value: unknown): SandboxClosure {
  return value as SandboxClosure;
}
