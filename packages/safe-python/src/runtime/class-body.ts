import type { ResolvedScope } from "../symbol-resolution.js";
import { ClassFrame, type ClassNamespaces } from "./class-frame.js";
import type { LexicalCell } from "./lexical-frame.js";
import type { CallStack } from "./call-stack.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { executeStatements, type StatementContext } from "./statement-execution.js";
import { cleanDocstring } from "./docstring.js";

export interface ClassBodyMetadata<Value> {
  /** Compiler-resolved lexical name; do not derive from mutable runtime globals. */
  readonly qualifiedName: string;
  /** Precompiled guest tuple of statically assigned instance attribute names. */
  readonly staticAttributes: Value;
  readonly stripDocstring: boolean;
}

export interface ClassBodyContext<Value> extends ClassNamespaces<Value> {
  /** Share the same depth policy with functions and nested class suites. */
  readonly calls: Pick<CallStack<ClassFrame<Value>>, "enter">;
  string(value: string): Value;
  integer(value: number): Value;
  /** Wrap the existing cell identity as a guest cell; do not copy its contents. */
  cell(value: LexicalCell<Value>): Value;
  /** Bind protocols without executing the suite; class storage uses this frame. */
  body(frame: ClassFrame<Value>): StatementContext<Value>;
}

/** Execute analyzed class-suite code, not an arbitrary function passed directly
 * to __build_class__. Namespace metadata follows Python 3.14 ordering; ignored
 * annotations do not install annotation functions or class-dictionary cells.
 * The compiler must supply qualified names and static-attribute tuples. Concrete
 * expression/leaf protocols, traceback construction and full heap accounting
 * remain runtime responsibilities. A failed suite never publishes its class cell.
 */
export function executeClassBody<Value>(
  scope: ResolvedScope, metadata: ClassBodyMetadata<Value>, context: ClassBodyContext<Value>, meter: ExecutionMeter
): LexicalCell<Value> | undefined {
  meter.checkpoint();
  const node = scope.scope.node;
  if (scope.scope.kind !== "class" || node.kind !== "class") throw new Error("class bodies require a class scope");
  const frame = new ClassFrame(scope, context, meter);
  const leave = context.calls.enter(frame);
  try {
    const body = context.body(frame);
    frame.store("__module__", frame.load("__name__"));
    meter.checkpoint();
    frame.store("__qualname__", context.string(metadata.qualifiedName));
    meter.checkpoint();
    frame.store("__firstlineno__", context.integer(node.decorators[0]?.start.line ?? node.start.line));
    const first = node.body[0];
    const hasDocstring = first?.kind === "expression-statement" && first.expression.kind === "literal" && first.expression.literalKind === "string";
    if (hasDocstring && !metadata.stripDocstring) {
      meter.checkpoint();
      const text = cleanDocstring(first.expression.value as Uint32Array, meter);
      meter.checkpoint();
      frame.store("__doc__", context.string(text));
    }
    meter.checkpoint();
    const result = executeStatements(hasDocstring ? node.body.slice(1) : node.body, body, meter);
    if (result.kind !== "normal") throw new Error("validated class suites cannot return");
    frame.store("__static_attributes__", metadata.staticAttributes);
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
