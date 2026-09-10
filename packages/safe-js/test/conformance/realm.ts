import { parseEvalScript } from "../../src/parse/parser.js";
import { Budget, SandboxError, type BudgetOptions } from "../../src/interp/budget.js";
import { createBuiltinBindings } from "../../src/interp/globals.js";
import { interpret, Scope, type InterpreterValue } from "../../src/interp/interpreter.js";
import { getRealmGlobalObject } from "../../src/interp/intrinsics.js";
import { SandboxJobQueue } from "../../src/interp/jobs.js";
import { releaseObjectPrototype } from "../../src/interp/object-model.js";

export type ScriptOutcome =
  | { status: "normal"; value: InterpreterValue }
  | { status: "throw"; phase: "parse" | "runtime"; error: unknown }
  | { status: "host-error"; error: unknown };

export function createTest262Realm(options: BudgetOptions = {}) {
  const budget = new Budget(options);
  const bindings = createBuiltinBindings({ budget });
  const operation = budget.acquireCompileOwner(false);
  const jobs = new SandboxJobQueue();
  const controller = new AbortController();
  const scope = new Scope(bindings).child({}, { globalEnvironment: true });
  scope.declare("this", "const", getRealmGlobalObject(budget));
  let disposal: Promise<void> | undefined;
  return {
    async evaluate(source: string): Promise<ScriptOutcome> {
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
          useScopeDirectly: true, script: { strict: parsed.strict }
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
      disposal = jobs.drain().finally(() => {
        releaseObjectPrototype(budget);
        operation.release();
      });
      return disposal;
    }
  };
}
