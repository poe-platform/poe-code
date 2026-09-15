import { expect, it, vi } from "vitest";
import { run, makeEnvModule } from "./index.js";
import { run as runCore } from "./core.js";

for (const [entry, execute] of [["node", run], ["core", runCore]] as const) {
  it.each(["process", "require", "fetch", "fs", "WebSocket", "document", "window"])(
    `${entry} denies ambient %s while retaining ECMAScript controls`,
    async (name) => {
      expect(await execute(`return [typeof ${name}, typeof Promise, typeof Map];`))
        .toMatchObject({ ok: true, returnValue: ["undefined", "function", "function"] });
      expect(await execute(`return ${name};`)).toMatchObject({
        ok: false, error: { name: "ReferenceError", code: "UNBOUND_IDENTIFIER",
          message: `Identifier '${name}' is not defined.`, span: { start: { line: 1, column: 8 } } }
      });
    }
  );
  it.each(["node:fs", "node:child_process", "https://example.test/mod.js", "acorn"])(
    `${entry} denies unregistered module %s`,
    async (name) => {
      await expect(execute(`import * as authority from ${JSON.stringify(name)}; return authority;`))
        .rejects.toThrow(name === "acorn"
          ? `Unknown module '${name}'. No modules are registered.`
          : `Invalid import specifier '${name}' at line 1, column 28.`);
    }
  );
}

it("a narrow environment registration does not grant ambient process or other names", async () => {
  const env = makeEnvModule({ allow: ["TOKEN"], values: { TOKEN: "explicit" } });
  expect(await run('import {get} from "env"; let denied; try {get("OTHER")} catch(e) {denied=e.code} return [get("TOKEN"),denied,typeof process,typeof fetch];', {
    modules: { env }
  })).toMatchObject({ ok: true, returnValue: ["explicit", "ENV_ACCESS_DENIED", "undefined", "undefined"] });
});

it("cancellation cannot undo synchronous host effects and prevents the next host call", async () => {
  const controller = new AbortController();
  const reason = new Error("host revoked");
  const effects: string[] = [];
  const next = vi.fn();
  const operation = () => {
    effects.push("before abort");
    controller.abort(reason);
    // Synchronous native execution continues until the operation returns.
    effects.push("after abort");
  };
  await expect(run('import {operation,next} from "host"; operation(); next();', {
    modules: { host: { operation, next } }, signal: controller.signal
  })).rejects.toMatchObject({ name: "Error", message: "host revoked", stack: "Error: host revoked\n    at next (line 1, column 51)" });
  expect(effects).toEqual(["before abort", "after abort"]);
  expect(next).not.toHaveBeenCalled();
});

it.each(["node:fs", "https://example.test/tool.js", "@scope/tool", "fixture.js"])(
  "static resolver refuses %s while dynamic lookup grants only its explicit exports",
  async name => {
    const read = vi.fn(() => "registered");
    const quoted = JSON.stringify(name);
    expect(await run(`try { await import(${quoted}); } catch(error) { return error.message; }`))
      .toMatchObject({ ok: true, returnValue: `Unknown module '${name}'. No modules are registered.` });
    await expect(run(`import {read} from ${quoted}; return read();`, {
      modules: { [name]: { read } }
    })).rejects.toThrow(`Invalid import specifier '${name}'`);
    expect(read).not.toHaveBeenCalled();
    expect(await run(`return [(await import(${quoted})).read(),typeof fs,typeof fetch];`, {
      modules: { [name]: { read } }
    })).toMatchObject({ ok: true, returnValue: ["registered", "undefined", "undefined"] });
    expect(read).toHaveBeenCalledTimes(1);
  }
);
