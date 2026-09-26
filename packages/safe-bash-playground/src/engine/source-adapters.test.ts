import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { instrumentRootState } from "./root-state-adapter.mjs";
import { selectBrowserWorker } from "./worker-source-adapter.mjs";

describe("pinned browser source adapters", () => {
  it("adapts the actual current shell source", () => {
    const source = readFileSync(new URL("../../../safe-bash/src/shell/shell.ts", import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
    }).outputText;
    expect(() => instrumentRootState(compiled)).not.toThrow();
  });

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

  it.each([false, true])("observes reused and newly constructed roots through shared execution: fail=%s", async (fail) => {
    const code = instrumentRootState(`
      class RootShellState {
        constructor(cwd, variables, exported, extensions) {
          Object.assign(this, { cwd, variables, exported, extensions });
        }
      }
      export class Shell {
        run(options, reuse) {
          const warm = reuse ? { currentState: new RootShellState("/warm", { retained: "value" }, new Set(), { definitions: ["read"] }), runtime: {} } : undefined;
          return this.#execute(options, warm);
        }
        async #execute(options, warm) {
          let state = warm?.currentState;
          let runtime = warm?.runtime;
          try {
            let currentState;
            if (warm) {
              currentState = warm.currentState;
              runtime = warm.runtime;
            } else {
              const cwd = "/", variables = { retained: "value" }, exported = new Set();
              currentState = new RootShellState(cwd, variables, exported, { definitions: ["read"] });
              state = currentState;
              currentState = new Proxy(currentState, {});
              state = currentState;
              currentState.cwd = "/restored";
              runtime = {};
            }
            currentState.cwd = "/next";
            options.onState?.(state);
            if (options.fail) throw new Error("execution failed");
            return { state, runtime };
          } finally { options.cleaned = true; }
        }
      }`);
    const { Shell } = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    for (const reuse of [false, true]) {
      const roots: unknown[] = [], paths: string[] = [], sessions: unknown[] = [];
      const options = { fail, cleaned: false, onRootState: (value: unknown) => roots.push(value),
        onCwd: (value: string) => paths.push(value), onState: (value: unknown) => sessions.push(value) };
      const result = new Shell().run(options, reuse);
      if (fail) await expect(result).rejects.toThrow("execution failed");
      else expect((await result).state).toBe(sessions[0]);
      expect(options.cleaned).toBe(true);
      expect(roots).toEqual([{ cwd: "/next" }]);
      expect(Object.isFrozen(roots[0])).toBe(true);
      expect(paths).toEqual(reuse ? ["/next"] : ["/restored", "/next"]);
      expect(sessions[0]).toMatchObject({ variables: { retained: "value" }, extensions: { definitions: ["read"] } });
    }
  });

  it("preserves initialization failure without reporting an uninitialized root", async () => {
    const code = instrumentRootState(`export class Shell {
      run(options) { return this.#execute(options); }
      async #execute(options, warm) {
        let state = warm?.currentState;
        let runtime = warm?.runtime;
        try {
          let currentState;
          if (warm) {
            currentState = warm.currentState;
            runtime = warm.runtime;
          } else {
            throw new Error("initialization failed");
            currentState = new RootShellState(cwd, variables, exported, extensions);
            state = currentState;
          }
          return { state, runtime };
        } finally { options.cleaned = true; }
      }
    }`);
    const { Shell } = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    const roots: unknown[] = [];
    const options = { cleaned: false, onRootState: (value: unknown) => roots.push(value) };
    await expect(new Shell().run(options)).rejects.toThrow("initialization failed");
    expect(options.cleaned).toBe(true);
    expect(roots).toEqual([]);
  });

  it.each([false, true])("observes the reused root with current callbacks after all cleanup: fail=%s", async (fail) => {
    const code = instrumentRootState(`
      class RootShellState {
        constructor(cwd, variables, exported, extensions) {
          Object.assign(this, { cwd, variables, exported, extensions });
        }
      }
      export class Shell {
        warm;
        run(options) { return this.#execute(options, this.warm); }
        async #execute(options, warm) {
          let state = warm?.currentState;
          let runtime = warm?.runtime;
          try {
            let currentState;
            if (warm) {
              currentState = warm.currentState;
              runtime = warm.runtime;
            } else {
              const cwd = "/", variables = {}, exported = new Set();
              currentState = new RootShellState(cwd, variables, exported, {});
              state = currentState;
              runtime = {};
            }
            this.warm = { currentState, runtime };
            currentState.cwd = options.cwd;
            if (options.fail) throw new Error("execution failed");
          } finally {
            await Promise.resolve();
            state.cwd += "/finished";
            options.events?.push("cleanup");
          }
          await options.onState?.(state);
          return state;
        }
      }`);
    const { Shell } = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    const shell = new Shell();
    const earlier: unknown[] = [], current: unknown[] = [];
    await shell.run({ cwd: "/first", onCwd: (cwd: string) => earlier.push(cwd), onRootState: (root: unknown) => earlier.push(root) });
    expect(earlier).toEqual(["/first", "/first/finished", { cwd: "/first/finished" }]);
    await shell.run({ cwd: "/unobserved" });
    expect(earlier).toHaveLength(3);
    const result = shell.run({
      cwd: "/current", fail, events: current,
      onCwd: (cwd: string) => current.push(cwd),
      onRootState: (root: unknown) => current.push(root),
      onState: async () => { await Promise.resolve(); current.push("native"); }
    });
    if (fail) await expect(result).rejects.toThrow("execution failed");
    else await result;
    expect(current).toEqual(["/current", "/current/finished", "cleanup", ...(!fail ? ["native"] : []), { cwd: "/current/finished" }]);
    expect(earlier).toHaveLength(3);
    expect(Object.getOwnPropertyDescriptor(shell.warm.currentState, "cwd")).toMatchObject({ value: "/current/finished", writable: true });
  });

  it("rejects changed or ambiguous warm root selection", () => {
    const body = `let currentState;
      if (warm) {
        currentState = warm.currentState;
        runtime = warm.runtime;
      } else {
        currentState = new RootShellState(cwd, variables, exported, extensions);
        state = currentState;
      }`;
    for (const changed of [
      body.replace("let currentState;", ""),
      body.replace("let currentState;", "let currentState = other;"),
      body.replace("if (warm)", "if (other)"),
      body.replace("warm.currentState", "warm.other"),
      body.replace("runtime = warm.runtime;", "runtime = other;"),
      body.replace("new RootShellState(cwd,", "new RootShellState(other,"),
      body.replace("state = currentState;", "state = other;"),
      body.replace("state = currentState;", "state = currentState; currentState = new RootShellState(cwd, variables, exported, extensions);"),
      body.replace("state = currentState;", "state = currentState; if (other) { currentState = new RootShellState(cwd, variables, exported, extensions); }"),
      `${body} const state = { cwd };`,
      `const nested = () => { ${body} };`,
    ]) expect(() => instrumentRootState(`class Shell { async #execute(options) { ${changed} } }`)).toThrow("structure changed");
  });

  it("refuses changed or ambiguous warm dispatch boundaries", () => {
    for (const dispatch of [
      "exec(source, changed) { return this.#execAsync(source, changed); }",
      "exec(source, options) { return this.#execAsync(options, source); }",
      "exec(source, options) { return other(source, options); }",
      "exec(source, options) { return this.#execAsync(source, options); } exec() {}",
      ""
    ]) {
      expect(() => instrumentRootState(`class Shell {
        ${dispatch}
        #execAsync() {}
        #execWarmSyncOrFallback() {}
        async #execute(options) { const cwd = "/"; const state = { cwd }; return state; }
      }`)).toThrow("dispatch structure changed");
    }
  });
});
