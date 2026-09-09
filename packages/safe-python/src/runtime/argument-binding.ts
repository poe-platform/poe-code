import type { Parameter } from "../ast.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { suggestName } from "./name-suggestion.js";

export type CallParameter = Pick<Parameter, "name" | "kind">;

export interface KeywordNames<Key> {
  /** Exact source-name spelling, or undefined if the key cannot equal a source
   * identifier. Never normalize caller keys or collapse surrogate sequences. */
  parameter(key: Key): string | undefined;
  /** Diagnostic formatting only; it must not change matching or stored keys. */
  display(key: Key): string;
}

export interface BoundArguments<Value, Key = string> {
  readonly values: ReadonlyMap<string, Value>;
  readonly varPositional: readonly Value[];
  readonly varKeywords: ReadonlyMap<Key, Value>;
}

/** Bind an already validated Python function signature and fully expanded call.
 * Defaults are already evaluated guest values, not expressions. Keyword keys are
 * exact strings or original string records: **mapping keys must not undergo
 * identifier normalization or lossy host-string conversion.
 * Call assembly owns duplicate keyword detection and non-string key validation.
 * The caller packs variadics into guest tuple/dict values and installs frame locals.
 */
export function bindArguments<Value, Key = string>(
  functionName: string, parameters: readonly CallParameter[],
  positional: readonly Value[], keywords: ReadonlyMap<Key, Value>,
  defaults: ReadonlyMap<string, Value> = new Map(), meter?: ExecutionMeter, names?: KeywordNames<Key>
): BoundArguments<Value, Key> {
  meter?.checkpoint();
  const positionalParameters: CallParameter[] = [], keywordParameters = new Map<string, CallParameter>();
  let hasVarPositional = false, hasVarKeywords = false;
  for (const parameter of parameters) {
    meter?.checkpoint();
    if (parameter.kind === "var-positional") hasVarPositional = true;
    else if (parameter.kind === "var-keyword") hasVarKeywords = true;
    else {
      if (parameter.kind !== "keyword-only") positionalParameters.push(parameter);
      if (parameter.kind !== "positional-only") keywordParameters.set(parameter.name, parameter);
    }
  }
  const keywordNames = new Map<Key, string | undefined>(), suppliedNames = new Set<string>();
  for (const key of keywords.keys()) {
    meter?.checkpoint(1, 48);
    if (!names && typeof key !== "string") throw new Error("non-string keyword storage requires a name adapter");
    const name = names ? names.parameter(key) : key as string;
    meter?.checkpoint();
    keywordNames.set(key, name);
    if (name !== undefined) suppliedNames.add(name);
  }
  const values = new Map<string, Value>(), varKeywords = new Map<Key, Value>();
  const varPositional: Value[] = [];
  for (let index = 0; index < positional.length; index++) {
    meter?.checkpoint();
    if (index < positionalParameters.length) values.set(positionalParameters[index].name, positional[index]);
    else if (hasVarPositional) varPositional.push(positional[index]);
  }
  let keywordOnlyGiven = 0;
  for (const [key, value] of keywords) {
    meter?.checkpoint();
    const name = keywordNames.get(key);
    const parameter = name === undefined ? undefined : keywordParameters.get(name);
    if (parameter !== undefined) {
      if (values.has(parameter.name)) throw new PythonRuntimeError("TypeError", `${functionName}() got multiple values for argument '${parameter.name}'`);
      values.set(parameter.name, value);
      if (parameter.kind === "keyword-only") keywordOnlyGiven++;
    } else if (hasVarKeywords) varKeywords.set(key, value);
    else {
      const conflicts: string[] = [];
      for (const candidate of positionalParameters) {
        meter?.checkpoint();
        if (candidate.kind === "positional-only" && suppliedNames.has(candidate.name)) conflicts.push(candidate.name);
      }
      if (conflicts.length) throw new PythonRuntimeError("TypeError", `${functionName}() got some positional-only arguments passed as keyword arguments: '${conflicts.join(", ")}'`);
      meter?.checkpoint(keywordParameters.size);
      const display = names ? names.display(key) : name!;
      meter?.checkpoint();
      const suggestion = name === undefined ? undefined : suggestName(name, [...keywordParameters.keys()], meter);
      const hint = suggestion === undefined ? "" : `. Did you mean '${suggestion}'?`;
      throw new PythonRuntimeError("TypeError", `${functionName}() got an unexpected keyword argument '${display}'${hint}`);
    }
  }
  if (!hasVarPositional && positional.length > positionalParameters.length) {
    let required = 0;
    for (const parameter of positionalParameters) {
      meter?.checkpoint();
      if (!defaults.has(parameter.name)) required++;
    }
    const total = positionalParameters.length;
    const expected = required === total ? `${total} positional argument${total === 1 ? "" : "s"}` : `from ${required} to ${total} positional arguments`;
    const given = keywordOnlyGiven ? `${positional.length} positional argument${positional.length === 1 ? "" : "s"} (and ${keywordOnlyGiven} keyword-only argument${keywordOnlyGiven === 1 ? "" : "s"})` : String(positional.length);
    throw new PythonRuntimeError("TypeError", `${functionName}() takes ${expected} but ${given} ${positional.length === 1 && keywordOnlyGiven === 0 ? "was" : "were"} given`);
  }
  const missingPositional: string[] = [], missingKeyword: string[] = [];
  for (const parameter of parameters) {
    meter?.checkpoint();
    if (parameter.kind === "var-positional" || parameter.kind === "var-keyword" || values.has(parameter.name)) continue;
    if (defaults.has(parameter.name)) values.set(parameter.name, defaults.get(parameter.name)!);
    else (parameter.kind === "keyword-only" ? missingKeyword : missingPositional).push(parameter.name);
  }
  const missing = missingPositional.length ? missingPositional : missingKeyword;
  if (missing.length) {
    const quoted: string[] = [];
    for (const name of missing) { meter?.checkpoint(); quoted.push(`'${name}'`); }
    const names = quoted.length === 1 ? quoted[0] : quoted.length === 2 ? quoted.join(" and ") : `${quoted.slice(0, -1).join(", ")}, and ${quoted[quoted.length - 1]}`;
    throw new PythonRuntimeError("TypeError", `${functionName}() missing ${missing.length} required ${missingPositional.length ? "positional" : "keyword-only"} argument${missing.length === 1 ? "" : "s"}: ${names}`);
  }
  return { values, varPositional, varKeywords };
}
