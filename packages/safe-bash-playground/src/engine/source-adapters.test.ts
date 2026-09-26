import { describe, expect, it } from "vitest";
import { limitCommandBuffers } from "./buffer-limit-adapter.mjs";
import { instrumentRootState } from "./root-state-adapter.mjs";
import { selectBrowserWorker } from "./worker-source-adapter.mjs";

describe("pinned browser source adapters", () => {
  it("replaces the worker URL without changing ownership options", () => {
    const adapted = selectBrowserWorker(
      'new Worker(new URL("./worker.js", import.meta.url), { workerData: { version: 1 } });',
      "regex"
    );
    expect(adapted).toContain('new Worker("regex", { workerData: { version: 1 } })');
    expect(adapted).not.toContain("import.meta.url");
    expect(() => selectBrowserWorker("new Worker(source)", "regex")).toThrow("constructor changed");
    expect(() => selectBrowserWorker("export const other = 1;", "regex")).toThrow(
      "structure changed"
    );
  });
  it("refuses a missing or changed command buffer binding", () => {
    expect(() => limitCommandBuffers("export const other = 32 * 1024 * 1024;")).toThrow(
      "structure changed"
    );
    expect(() => limitCommandBuffers("export const bufferLimit = 16 * 1024 * 1024;")).toThrow(
      "initializer changed"
    );
  });

  it("changes the actual lexical buffer binding rather than only its export", async () => {
    const code = limitCommandBuffers(
      "export const bufferLimit = 32 * 1024 * 1024; export function current() { return bufferLimit; }"
    );
    const adapted = await import(
      /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
    );
    expect(adapted.bufferLimit).toBe(2 * 1024 * 1024);
    expect(adapted.current()).toBe(adapted.bufferLimit);
  });

  it("refuses shell inputs without the single expected root state", () => {
    expect(() => instrumentRootState("export class Shell {};")).toThrow("structure changed");
    expect(() =>
      instrumentRootState("export class Shell { async #execute() { const state = {}; } }")
    ).toThrow("structure changed");
  });

  it("observes the assigned root state while retaining extensions and failure cleanup", async () => {
    const source = `export class Shell {
      run(options) { return this.#execute(options); }
      async #execute(options) {
        let state;
        try {
          const cwd = "/";
          const extensions = { definitions: ["read"] };
          state = { cwd, extensions };
          state.cwd = "/next";
          if (options.fail) throw new Error("execution failed");
          return state.extensions.definitions;
        } finally { options.cleaned = true; }
      }
    }`;
    const code = instrumentRootState(source);
    const { Shell } = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    for (const fail of [false, true]) {
      const states: unknown[] = [];
      const paths: string[] = [];
      const options = { fail, cleaned: false, onRootState: (value: unknown) => states.push(value), onCwd: (value: string) => paths.push(value) };
      const result = new Shell().run(options);
      if (fail) await expect(result).rejects.toThrow("execution failed");
      else expect(await result).toEqual(["read"]);
      expect(options.cleaned).toBe(true);
      expect(states).toEqual([{ cwd: "/next" }]);
      expect(Object.isFrozen(states[0])).toBe(true);
      expect(paths).toEqual(["/next"]);
    }
  });

  it("keeps browser cwd notifications separate from native session state", async () => {
    const code = instrumentRootState(`export class Shell {
      run(options) { return this.#execute(options); }
      async #execute(options) {
        const cwd = "/";
        const state = { cwd, variables: { retained: "value" } };
        state.cwd = "/next";
        options.onState?.(Object.freeze({ ...state }));
        return state;
      }
    }`);
    const { Shell } = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    const roots: unknown[] = [];
    const sessions: unknown[] = [];
    const result = await new Shell().run({
      onRootState: (value: unknown) => roots.push(value),
      onState: (value: unknown) => sessions.push(value)
    });
    expect(roots).toEqual([{ cwd: "/next" }]);
    expect(Object.isFrozen(roots[0])).toBe(true);
    expect(sessions).toEqual([{ cwd: "/next", variables: { retained: "value" } }]);
    expect(result).toEqual(sessions[0]);
  });

  it("rejects assigned state binding and placement drift", () => {
    for (const body of [
      'state = { cwd };',
      'let state = other; state = { cwd };',
      'let state; state = { directory: cwd };',
      'let state; state = { cwd }; state = { cwd };',
      'let state; const nested = () => { state = { cwd }; };',
    ]) expect(() => instrumentRootState(`class Shell { async #execute(options) { ${body} } }`)).toThrow("structure changed");
  });

  it.each([false, true])("observes constructed root state through restoration and cleanup: %s", async (fail) => {
    const code = instrumentRootState(`
      class RootShellState {
        constructor(cwd, variables, exported, extensions) {
          Object.assign(this, { cwd, variables, exported, extensions });
        }
      }
      export class Shell {
        run(options) { return this.#execute(options); }
        async #execute(options) {
          let state;
          try {
            const cwd = "/", variables = { retained: "value" }, exported = new Set();
            let currentState = new RootShellState(cwd, variables, exported, { definitions: ["read"] });
            state = currentState;
            currentState = new Proxy(currentState, {});
            state = currentState;
            currentState.cwd = "/restored";
            currentState.cwd = "/next";
            options.onState?.(state);
            if (options.fail) throw new Error("execution failed");
            return state;
          } finally { options.cleaned = true; }
        }
      }`);
    const { Shell } = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    const roots: unknown[] = [], paths: string[] = [], sessions: unknown[] = [];
    const options = { fail, cleaned: false, onRootState: (value: unknown) => roots.push(value),
      onCwd: (value: string) => paths.push(value), onState: (value: unknown) => sessions.push(value) };
    const result = new Shell().run(options);
    if (fail) await expect(result).rejects.toThrow("execution failed");
    else expect(await result).toBe(sessions[0]);
    expect(options.cleaned).toBe(true);
    expect(roots).toEqual([{ cwd: "/next" }]);
    expect(Object.isFrozen(roots[0])).toBe(true);
    expect(paths).toEqual(["/restored", "/next"]);
    expect(sessions[0]).toMatchObject({ variables: { retained: "value" }, extensions: { definitions: ["read"] } });
  });

  it("rejects changed or ambiguous root constructors", () => {
    for (const body of [
      'let currentState = new OtherState(cwd, variables, exported, extensions);',
      'let currentState = new RootShellState(other, variables, exported, extensions);',
      'let currentState = new RootShellState(cwd, exported, variables, extensions);',
      'let currentState = new RootShellState(cwd, variables, exported);',
      'let currentState = RootShellState(cwd, variables, exported, extensions);',
      'let currentState = new RootShellState(cwd, variables, exported, extensions); const state = { cwd };',
      'const nested = () => { let currentState = new RootShellState(cwd, variables, exported, extensions); };',
    ]) expect(() => instrumentRootState(`class Shell { async #execute(options) { ${body} } }`)).toThrow("structure changed");
  });
});
