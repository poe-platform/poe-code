import { ClassFrame, type ClassNamespaces } from "./class-frame.js";
import type { LexicalCell } from "./lexical-frame.js";
import type { CallStack } from "./call-stack.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { executeStatements, type StatementContext } from "./statement-execution.js";
import type { CompiledClassBody } from "./class-compilation.js";

export interface ClassBodyContext<Value> extends ClassNamespaces<Value> {
  /** Share the same depth policy with functions and nested class suites. */
  readonly calls: Pick<CallStack<ClassFrame<Value>>, "enter">;
  /** Wrap the existing cell identity as a guest cell; do not copy its contents. */
  cell(value: LexicalCell<Value>): Value;
  /** Bind protocols without executing the suite; class storage uses this frame. */
  body(frame: ClassFrame<Value>): StatementContext<Value>;
}

/** Execute analyzed class-suite code, not an arbitrary function passed directly
 * to __build_class__. Namespace metadata follows Python 3.14 ordering; ignored
 * annotations do not install annotation functions or class-dictionary cells.
 * Compiled code supplies reusable metadata constants. Concrete
 * expression/leaf protocols, traceback construction and full heap accounting
 * remain runtime responsibilities. A failed suite never publishes its class cell.
 */
export function executeClassBody<Value>(
  code: CompiledClassBody<Value>, context: ClassBodyContext<Value>, meter: ExecutionMeter
): LexicalCell<Value> | undefined {
  meter.checkpoint();
  const frame = new ClassFrame(code.scope, context, meter);
  const leave = context.calls.enter(frame);
  try {
    const body = context.body(frame);
    frame.store("__module__", frame.load("__name__"));
    meter.checkpoint();
    frame.store("__qualname__", code.qualifiedName);
    meter.checkpoint();
    frame.store("__firstlineno__", code.firstLine);
    if (code.docstring !== undefined) {
      meter.checkpoint();
      frame.store("__doc__", code.docstring.value);
    }
    meter.checkpoint();
    const result = executeStatements(code.statements, body, meter);
    if (result.kind !== "normal") throw new Error("validated class suites cannot return");
    frame.store("__static_attributes__", code.staticAttributes);
    const cell = frame.classCell;
    if (cell !== undefined) {
      meter.checkpoint();
      frame.store("__classcell__", context.cell(cell));
    }
    return cell;
  } finally {
    leave();
  }
}
