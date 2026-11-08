import type { CompileOwner } from "../interp/budget.js";
import type { ParseResult } from "../parse.js";
import { ParseError } from "../parse/format-error.js";
import { createModuleSource, createDynamicSource, createEvalSource, type DynamicSource, type EvalSourceContext } from "../parse/dynamic-source.js";
import { SnapshotValidationError } from "./validation.js";
import { isConstructibleGuestFunction, validateGuestFunctionAst } from "./guest-ast-validation.js";
import { validateTemplateObjects } from "./template-validation.js";
import { validateGuestHeapGraphs } from "./guest-heap-validation.js";

export function validateGuestHeapSource(heap: Record<string, unknown>, ast: unknown, owner?: CompileOwner): void {
  const entries = Object.entries(heap);
  const closures = entries.filter(([, value]) =>
    value !== null && typeof value === "object" && (["guest-function", "guest-class", "guest-generator"].includes(String((value as Record<string, unknown>).kind)) ||
      (value as Record<string, unknown>).templateNodeId !== undefined));
  const dynamicSources = new Map<number, DynamicSource>();
  for (const [id, value] of entries) {
    const record = value as Record<string, unknown>;
    if (record.kind === "guest-source" || record.kind === "guest-script") {
      try {
        const compiled = record.kind === "guest-script"
          ? createEvalSource(record.body as string, record.context as EvalSourceContext, owner)
          : record.functionKind === "module" ? createModuleSource(record.body as string, owner)
          : createDynamicSource(record.functionKind as Exclude<DynamicSource["kind"], "eval" | "module">,
            record.parameters as string, record.body as string, owner);
        dynamicSources.set(Number(id), compiled.source);
      } catch (error) {
        if (!(error instanceof SyntaxError) && !(error instanceof ParseError)) throw error;
        throw new SnapshotValidationError("invalidValue", `$.heap[${JSON.stringify(id)}]`, error.message);
      }
    }
  }
  if (closures.length > 0) {
    const constructibility = new Map<string, boolean>();
    const functions = new Map<number, Record<string, unknown>>();
    const pending: unknown[] = [ast];
    while (pending.length > 0) {
      const value = pending.pop();
      if (value === null || typeof value !== "object") continue;
      const node = value as Record<string, unknown>;
      if (typeof node.nodeId === "number") {
        functions.set(node.nodeId, node);
      }
      for (const entry of Object.values(node)) pending.push(entry);
    }
    for (const [id, value] of closures) {
      const record = value as Record<string, unknown>;
      if (record.kind === "guest-array") continue;
      const nodes = record.dynamicSource === undefined ? functions
        : dynamicSources.get((record.dynamicSource as {id: number}).id)!.nodes;
      const origin = nodes.get(record.astNodeId as number);
      try {
        validateGuestFunctionAst(record, origin);
        if (record.kind === "guest-function") constructibility.set(id, isConstructibleGuestFunction(origin as unknown as Record<string, unknown>, record));
      }
      catch (error) {
        throw new SnapshotValidationError("invalidValue", `$.heap[${JSON.stringify(id)}].astNodeId`, error instanceof Error ? error.message : String(error));
      }
    }
    validateGuestHeapGraphs(heap, constructibility);
    try { validateTemplateObjects(heap, functions.values() as Iterable<ParseResult>, dynamicSources); }
    catch (error) { throw new SnapshotValidationError("invalidValue", "$.heap", String(error)); }
  }
}
