import { afterEach, describe, expect, it, vi } from "vitest";

import { makeEnvModule, parseEnvConfig, EnvAccessError } from "./env.js";
import { dump } from "../snapshot/dump.js";
import { run } from "../run.js";

describe("makeEnvModule", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns values only for allow-listed environment variables", () => {
    vi.stubEnv("ALLOWED_TOKEN", "secret");
    vi.stubEnv("BLOCKED_TOKEN", "hidden");

    const env = makeEnvModule(["ALLOWED_TOKEN"]);

    expect(env.get("ALLOWED_TOKEN")).toBe("secret");
    expect(() => env.get("BLOCKED_TOKEN")).toThrow(EnvAccessError);
  });

  it("does not silently trim a requested name into a granted name", () => {
    vi.stubEnv("ALLOWED_TOKEN", "secret");

    const env = makeEnvModule(["ALLOWED_TOKEN"]);

    expect(() => env.get("  ALLOWED_TOKEN  ")).toThrow(EnvAccessError);
  });

  it("returns undefined for allowed variables that are unset", () => {
    const env = makeEnvModule(["MISSING_TOKEN"]);

    expect(env.get("MISSING_TOKEN")).toBeUndefined();
  });

  it("uses the allow-list snapshot from construction time", () => {
    vi.stubEnv("ALLOWED_TOKEN", "secret");
    vi.stubEnv("LATE_TOKEN", "later");

    const allowList = ["ALLOWED_TOKEN"];
    const env = makeEnvModule(allowList);

    allowList.push("LATE_TOKEN");

    expect(env.get("ALLOWED_TOKEN")).toBe("secret");
    expect(() => env.get("LATE_TOKEN")).toThrow(EnvAccessError);
  });

  it("rejects empty variable names", () => {
    const env = makeEnvModule(["ALLOWED_TOKEN"]);

    expect(() => env.get("")).toThrow("Environment variable name must be a non-empty string.");
  });

  it("rejects non-string variable names", () => {
    const env = makeEnvModule(["ALLOWED_TOKEN"]);

    expect(() => env.get(123 as never)).toThrow(
      "Environment variable name must be a non-empty string."
    );
    expect(() => env.get(null as never)).toThrow(
      "Environment variable name must be a non-empty string."
    );
  });

  it("rejects empty allow-list entries", () => {
    expect(() => makeEnvModule(["ALLOWED_TOKEN", ""])).toThrow(
      "Environment allow list[1] must be a non-empty string."
    );
  });

  it("rejects non-string allow-list entries", () => {
    expect(() => makeEnvModule(["ALLOWED_TOKEN", 1 as never])).toThrow(
      "Environment allow list[1] must be a non-empty string."
    );
  });

  it("rejects non-array allow-lists", () => {
    expect(() => makeEnvModule("ALLOWED_TOKEN" as never)).toThrow(
      "Environment options must be an object."
    );
  });

  it("distinguishes denied, missing, empty, and populated values without ambient fallback", () => {
    vi.stubEnv("MISSING", "ambient-secret");
    const env = makeEnvModule({
      allow: ["PRESENT", "EMPTY", "MISSING"],
      values: { PRESENT: "value", EMPTY: "" }
    });
    expect(env.get("PRESENT")).toBe("value");
    expect(env.get("EMPTY")).toBe("");
    expect(env.get("MISSING")).toBeUndefined();
    expect(() => env.get("DENIED")).toThrow(
      expect.objectContaining({
        name: "EnvAccessError",
        code: "ENV_ACCESS_DENIED",
        variable: "DENIED"
      })
    );
    expect(Object.keys(env)).toEqual(["get"]);
  });

  it.each([" ", " Token ", "变量", "__proto__", "constructor", "toString"])(
    "uses exact own names: %s",
    (name) => {
      const env = makeEnvModule({ allow: [name], values: Object.fromEntries([[name, "exact"]]) });
      expect(env.get(name)).toBe("exact");
    }
  );

  it("copies explicit values and grants without evaluating denied properties", () => {
    const denied = vi.fn(() => "never-read");
    const values = { TOKEN: "original" };
    Object.defineProperty(values, "DENIED", { get: denied, enumerable: true });
    const allow = ["TOKEN"];
    const env = makeEnvModule({ allow, values });
    values.TOKEN = "changed";
    allow.push("DENIED");
    expect(env.get("TOKEN")).toBe("original");
    expect(() => env.get("DENIED")).toThrow(EnvAccessError);
    expect(denied).not.toHaveBeenCalled();
  });

  it("never reads inherited environment properties", () => {
    const inherited = vi.fn(() => "hidden");
    const values = Object.create(Object.defineProperty({}, "TOKEN", { get: inherited }));
    const env = makeEnvModule({ allow: ["TOKEN"], values });
    expect(env.get("TOKEN")).toBeUndefined();
    expect(inherited).not.toHaveBeenCalled();
  });

  it("continues to read granted ambient values at call time", () => {
    vi.stubEnv("TOKEN", "first");
    const env = makeEnvModule(["TOKEN"]);
    vi.stubEnv("TOKEN", "second");
    expect(env.get("TOKEN")).toBe("second");
  });

  it.each(["replacement", undefined])("uses the current ambient record after replacement (%s)", (replacement) => {
    vi.stubEnv("TOKEN", "original");
    const ambient = makeEnvModule(["TOKEN"]);
    const explicit = makeEnvModule({ allow: ["TOKEN"], values: { TOKEN: "fixed" } });
    const original = process.env;
    let observed: unknown;
    try {
      process.env = replacement === undefined ? {} : { TOKEN: replacement };
      observed = [ambient.get("TOKEN"), explicit.get("TOKEN")];
    } finally {
      process.env = original;
    }
    expect(observed).toEqual([replacement, "fixed"]);
  });

  it("rejects a granted accessor without executing it", () => {
    const getter = vi.fn(() => "secret");
    expect(() =>
      makeEnvModule({
        allow: ["TOKEN"],
        values: Object.defineProperty({}, "TOKEN", { get: getter })
      })
    ).toThrow(TypeError);
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(["A=B", "NUL\0NAME"])("rejects invalid names without truncating: %s", (name) => {
    expect(() => makeEnvModule([name])).toThrow(TypeError);
    expect(() => makeEnvModule([]).get(name)).toThrow(TypeError);
  });

  it.each([
    null,
    [],
    {},
    { allow: "TOKEN" },
    { allow: [], all: true },
    { allow: [], values: null },
    { allow: [], values: [] },
    { allow: ["TOKEN"], values: { TOKEN: 7 } },
    { allow: ["TOKEN"], values: { TOKEN: null } }
  ])("rejects malformed JSON configuration: %j", (config) => {
    expect(() => parseEnvConfig(JSON.stringify(config))).toThrow(TypeError);
  });

  it("rejects options and grant accessors without evaluating them", () => {
    const getter = vi.fn(() => ["TOKEN"]);
    expect(() =>
      makeEnvModule(Object.defineProperty({}, "allow", { get: getter }) as never)
    ).toThrow(TypeError);
    const allow = ["TOKEN"];
    Object.defineProperty(allow, "0", { get: getter });
    expect(() => makeEnvModule(allow)).toThrow(TypeError);
    expect(getter).not.toHaveBeenCalled();
  });

  it("never inherits options from a polluted Object prototype", () => {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, "allow");
    Object.defineProperty(Object.prototype, "allow", {
      configurable: true,
      value: { value: ["TOKEN"] }
    });
    try {
      expect(() => makeEnvModule({} as never)).toThrow(TypeError);
    } finally {
      if (original === undefined) Reflect.deleteProperty(Object.prototype, "allow");
      else Object.defineProperty(Object.prototype, "allow", original);
    }
  });

  it("parses explicit JSON options and preserves prototype-named values", () => {
    const options = parseEnvConfig(
      '{"allow":["__proto__","MISSING"],"values":{"__proto__":"literal"}}'
    );
    expect(makeEnvModule(options).get("__proto__")).toBe("literal");
    expect(makeEnvModule(options).get("MISSING")).toBeUndefined();
    expect(() => parseEnvConfig("{")).toThrow(SyntaxError);
  });

  it("preserves allowed reads and denial fields through JSON replay after grants change", async () => {
    const source =
      'import {get} from "env"; const value=get("TOKEN"); let failure; try{get("DENIED");}catch(error){failure=error;} await 0; return [value, failure.name, failure.code, failure.variable, failure instanceof Error];';
    const first = await run(source, {
      modules: { env: makeEnvModule({ allow: ["TOKEN"], values: { TOKEN: "original" } }) }
    });
    expect(first).toMatchObject({
      ok: true,
      returnValue: ["original", "EnvAccessError", "ENV_ACCESS_DENIED", "DENIED", true]
    });
    const snapshot = JSON.parse(await dump(first));
    const restored = await run(source, {
      snapshot,
      modules: { env: makeEnvModule({ allow: ["DENIED"], values: { DENIED: "new-secret" } }) }
    });
    expect(restored).toMatchObject({ ok: true, returnValue: first.returnValue });
    expect(JSON.stringify(restored.returnValue)).not.toContain("new-secret");
  });
});
