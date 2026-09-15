import { ModuleFrame, type ModuleNamespaces } from "./module-frame.js";
import type { CompiledModule } from "./program-compilation.js";
import type { CallStack } from "./call-stack.js";
import { ExecutionLimitError,type ExecutionMeter } from "./execution-budget.js";
import { executeStatements, type StatementContext } from "./statement-execution.js";

export interface ModuleExecutionContext<Value> extends ModuleNamespaces<Value> {
  readonly calls: Pick<CallStack<ModuleFrame<Value>>, "enter">;
  /** Bind runtime operations without executing guest code during setup. */
  body(frame: ModuleFrame<Value>): StatementContext<Value>;
}

/** Execute a compiled noninteractive module/exec suite or eval expression in supplied namespaces.
 * Eval returns its value without storing doc metadata; suites return undefined.
 * Only a retained docstring writes __doc__; absence never clears an existing
 * binding. Restore active frames on every exit, without rolling back mutations.
 * Runtime adapters still supply leaf/expression protocols, builtin initialization,
 * import/module registration, guest tracebacks and complete allocation accounting.
 * This never invokes host eval/exec or implicitly grants filesystem capabilities.
 */
export function executeModule<Value>(
  code: CompiledModule<Value>, context: ModuleExecutionContext<Value>, meter: ExecutionMeter
): Value|void {
  meter.checkpoint();
  const frame = new ModuleFrame(code.scope, context, meter,code);
  const leave = context.calls.enter(frame);
  let fatal=false;
  try {
    const body = context.body(frame);
    if(code.expression!==undefined){
      body.position?.(code.expression);
      return body.evaluate(code.expression);
    }
    if (code.docstring !== undefined) frame.store("__doc__", code.docstring.value);
    const result = executeStatements(code.statements, body, meter);
    if (result.kind !== "normal") throw new Error("validated module suites cannot return");
  } catch(error) {
    fatal=error instanceof ExecutionLimitError;
    throw error;
  } finally {
    try{leave();}finally{if(!fatal)meter.checkpoint();}
  }
}
