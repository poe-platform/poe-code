import type { Statement } from "../statement-ast.js";
import { executeClassBody } from "./class-body.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { LexicalCell, LexicalNamespaces } from "./lexical-frame.js";
import type { CompiledProgram } from "./program-compilation.js";
import { RuntimeDictionaryNamespace } from "./runtime-dictionary-namespace.js";
import { createRuntimeFrameBody, type RuntimeExecutionContext } from "./runtime-program.js";
import type { DictionaryValue, RuntimeValue } from "./runtime-values.js";

export interface RuntimeClassBodyContext extends LexicalNamespaces<RuntimeValue>, RuntimeExecutionContext {
  /** Prepared exact dictionary, not the containing frame's locals. */
  readonly namespace: DictionaryValue;
}

/** Run a compiled class suite against its prepared dictionary. Methods capture
 * this activation's cells while retaining the defining globals/builtins. Publish
 * the owned class cell once as a guest record and return its internal identity for
 * construction validation. Builder lookup, arbitrary prepared mappings, bases,
 * metaclass construction and class-statement decorators remain separate layers.
 */
export function executeRuntimeClassBody(
  program: CompiledProgram<RuntimeValue>, statement: Extract<Statement, { kind: "class" }>,
  context: RuntimeClassBodyContext, meter: ExecutionMeter
): LexicalCell<RuntimeValue> | undefined {
  meter.checkpoint(1, 96);
  const code = program.classes.get(statement);
  if (code === undefined) throw new Error("class definition has no matching compiled code");
  meter.checkpoint(0,96);
  const locals = new RuntimeDictionaryNamespace(context.namespace, context.values, meter,{isException:context.exceptions?.matches.bind(context.exceptions)});
  const body = createRuntimeFrameBody(program, context, meter);
  return executeClassBody(code, {
    globals: context.globals, builtins: context.builtins, closure: context.closure,
    locals, calls: context.calls, cell: cell => context.values.cell(cell),
    body: frame => body(frame, context)
  }, meter);
}
