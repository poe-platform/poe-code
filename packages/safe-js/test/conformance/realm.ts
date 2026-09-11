import { parseEvalScript } from "../../src/parse/parser.js";
import { Budget, SandboxError, type BudgetOptions, type CompileOwner } from "../../src/interp/budget.js";
import { createBuiltinBindings } from "../../src/interp/globals.js";
import { interpret, Scope, type InterpreterValue } from "../../src/interp/interpreter.js";
import { getRealmGlobalObject } from "../../src/interp/intrinsics.js";
import { SandboxJobQueue } from "../../src/interp/jobs.js";
import { createIntrinsicObject, getSandboxPrototype, registerIntrinsicFunction, releaseObjectPrototype, setSandboxPrototype } from "../../src/interp/object-model.js";
import { createSandboxClosure, type SandboxObject } from "../../src/interp/values.js";
import { sandboxString } from "../../src/interp/string-coercion.js";

export type ScriptOutcome =
  | { status: "normal"; value: InterpreterValue }
  | { status: "throw"; phase: "parse" | "runtime"; error: unknown }
  | { status: "host-error"; error: unknown };

export type Test262Realm = {
  host: SandboxObject;
  evaluate(source: string, nested?: boolean): Promise<ScriptOutcome>;
  dispose(): Promise<void>;
};

export function createTest262Realm(options: BudgetOptions = {}, onPrint?: (message: string) => void, owner?: CompileOwner): Test262Realm {
  const budget = owner?.budget.forkRealm() ?? new Budget(options);
  const bindings = createBuiltinBindings({ budget, compileOwner: owner });
  const operation = budget.acquireCompileOwner(false, owner);
  const jobs = new SandboxJobQueue();
  const controller = new AbortController();
  const scope = new Scope(bindings).child({}, { globalEnvironment: true });
  const global = getRealmGlobalObject(budget);
  scope.declare("this", "const", global);
  const host = createIntrinsicObject();
  setSandboxPrototype(host, getSandboxPrototype(host, budget), budget);
  const children: Test262Realm[] = [];
  let disposal: Promise<void> | undefined;
  const realm: Test262Realm = {
    host,
    async evaluate(source: string, nested = false): Promise<ScriptOutcome> {
      if (disposal !== undefined) return { status: "host-error", error: new Error("Test262 realm is disposed") };
      let parsed: ReturnType<typeof parseEvalScript>;
      try {
        parsed = parseEvalScript(source, {}, operation.owner);
      } catch (error) {
        return error instanceof SandboxError ? { status: "host-error", error }
          : { status: "throw", phase: "parse", error };
      }
      try {
        const result = await interpret({ type: "BlockStatement", body: parsed.node.body, span: parsed.node.span }, {
          budget, scope, jobs, signal: controller.signal, compileOwner: operation.owner,
          useScopeDirectly: true, nested, script: { strict: parsed.strict }
        });
        return result.ok ? { status: "normal", value: result.returnValue }
          : { status: "host-error", error: result.error };
      } catch (error) {
        return error instanceof SandboxError || controller.signal.aborted ? { status: "host-error", error }
          : { status: "throw", phase: "runtime", error };
      }
    },
    dispose(): Promise<void> {
      if (disposal !== undefined) return disposal;
      controller.abort(new Error("Test262 realm disposed"));
      disposal = Promise.all([jobs.drain(), ...children.map(child => child.dispose())]).then(() => undefined).finally(() => {
        releaseObjectPrototype(budget);
        operation.release();
      });
      return disposal;
    }
  };
  const evalScript = createSandboxClosure({ guest: true, sandbox: true, name: "evalScript", length: 1,
    call: async (args, context) => {
      const source = await sandboxString(args[0], budget, context);
      const outcome = await realm.evaluate(source, true);
      if (outcome.status !== "normal") throw outcome.error;
      return outcome.value;
    }
  });
  const createRealm = createSandboxClosure({ guest: true, sandbox: true, name: "createRealm", length: 0,
    call: async () => {
      const child = createTest262Realm(options, onPrint, operation.owner);
      children.push(child);
      const initialized = await child.evaluate("", true);
      if (initialized.status !== "normal") throw initialized.error;
      return child.host;
    }
  });
  const print = createSandboxClosure({ guest: true, sandbox: true, name: "print", length: 1,
    call: async (args, context) => {
      const message = await sandboxString(args[0], budget, context);
      onPrint?.(message);
      return undefined;
    }
  });
  for (const closure of [evalScript, createRealm, print]) registerIntrinsicFunction(budget, closure);
  Object.assign(host, { global, evalScript, createRealm });
  Object.defineProperties(global, {
    $262: { value: host, writable: true, configurable: true },
    print: { value: print, writable: true, configurable: true }
  });
  return realm;
}
