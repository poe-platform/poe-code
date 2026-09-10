import { manglePrivateName } from "../private-names.js";
import type { ResolvedScope } from "../symbol-resolution.js";
import { bindArguments, type CallParameter, type KeywordNames, type FunctionDefaultOverrides } from "./argument-binding.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { LexicalFrame, type LexicalNamespaces } from "./lexical-frame.js";

export interface FunctionCallArguments<Value, Key = string> {
  /** Current function-qualified name for argument diagnostics. */
  readonly name: string;
  readonly positional: readonly Value[];
  /** Already expanded, duplicate-checked keywords. Original string records may
   * be retained with keywordNames supplying exact source-name matching. */
  readonly keywords: ReadonlyMap<Key, Value>;
  readonly keywordNames?: KeywordNames<Key>;
  /** Already evaluated defaults, keyed by normalized source or mangled names. */
  readonly defaults: ReadonlyMap<string, Value>;
  readonly defaultOverrides?: FunctionDefaultOverrides<Value>;
}

export interface FunctionFrameContext<Value, Key = string> extends LexicalNamespaces<Value> {
  /** Allocate builtin containers, without invoking guest-overridable constructors.
   * These operations own internal allocation metering. Dictionary construction
   * must produce independent storage even when the input is empty.
   */
  tuple(values: readonly Value[]): Value;
  dictionary(values: ReadonlyMap<Key, Value>): Value;
}

/** Bind an expanded function/lambda call and populate a fresh lexical activation.
 * The body is not executed here, including for async/generator functions. The
 * invocation engine owns suspension, recursion limits, result conversion and
 * guest exception construction. Parameter names/default keys are mangled in the
 * defining class context; caller keyword keys are never normalized or mangled.
 * Complete activation/temporary heap accounting remains a runtime responsibility.
 */
export function createFunctionFrame<Value, Key = string>(
  scope: ResolvedScope, call: FunctionCallArguments<Value, Key>,
  context: FunctionFrameContext<Value, Key>, meter: ExecutionMeter
): LexicalFrame<Value> {
  meter.checkpoint();
  const node = scope.scope.node;
  if ((scope.scope.kind !== "function" && scope.scope.kind !== "lambda") || (node.kind !== "function" && node.kind !== "lambda"))
    throw new Error("function calls require a function or lambda scope");
  const parameters: CallParameter[] = [];
  for (const parameter of node.parameters) {
    meter.checkpoint();
    parameters.push({ name: manglePrivateName(parameter.name, scope.scope.privateName), kind: parameter.kind });
  }
  const defaults = new Map<string, Value>();
  for (const [name, value] of call.defaults) {
    meter.checkpoint();
    defaults.set(manglePrivateName(name, scope.scope.privateName), value);
  }
  const bound = bindArguments(call.name, parameters, call.positional, call.keywords, defaults, meter, call.keywordNames, call.defaultOverrides);
  const frame = new LexicalFrame(scope, context, meter);
  for (const parameter of parameters) {
    meter.checkpoint();
    const value = parameter.kind === "var-positional" ? context.tuple(bound.varPositional)
      : parameter.kind === "var-keyword" ? context.dictionary(bound.varKeywords)
      : bound.values.get(parameter.name)!;
    frame.store(parameter.name, value);
  }
  return frame;
}
