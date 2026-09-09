import type { SymbolEvent, SymbolScope } from "./symbol-collection.js";
import { validateDeclarations } from "./declaration-validation.js";
import { PythonSyntaxError } from "./source.js";

export type ResolvedBinding = { readonly kind: "local" | "global" | "free"; readonly owner: SymbolScope };
export type ResolvedScope = {
  readonly scope: SymbolScope;
  readonly bindings: ReadonlyMap<string, ResolvedBinding>;
  readonly cells: ReadonlySet<string>;
  readonly free: ReadonlyMap<string, SymbolScope>;
  readonly children: readonly ResolvedScope[];
};
type Frame = {
  result: ResolvedScope;
  parent: Frame | undefined;
  locals: Set<string>;
  declarations: Map<string, "global" | "nonlocal">;
  outward: Set<string>;
  events: Map<string, SymbolEvent>;
  bindings: Map<string, ResolvedBinding>;
  cells: Set<string>;
  free: Map<string, SymbolScope>;
};

/** Resolve lexical owners and propagate closure requirements across intervening scopes. */
export function resolveSymbols(scope: SymbolScope, filename = "<string>"): ResolvedScope {
  validateDeclarations(scope, filename);
  const frames: Frame[] = [];
  const byScope = new Map<SymbolScope, Frame>();
  function build(scope: SymbolScope, parent?: Frame): Frame {
    const children: ResolvedScope[] = [];
    const bindings = new Map<string, ResolvedBinding>();
    const cells = new Set<string>();
    const free = new Map<string, SymbolScope>();
    const frame: Frame = { result: { scope, bindings, cells, free, children }, parent, bindings, cells, free,
      locals: new Set(), declarations: new Map(), outward: new Set(), events: new Map() };
    frames.push(frame);
    byScope.set(scope, frame);
    for (const event of scope.events) {
      if (!frame.events.has(event.name)) frame.events.set(event.name, event);
      if (["write", "delete", "parameter", "annotation", "import"].includes(event.kind)) frame.locals.add(event.name);
      if (event.kind === "write-outer") frame.outward.add(event.name);
      if (event.kind === "global" || event.kind === "nonlocal") {
        frame.declarations.set(event.name, event.kind);
        frame.events.set(event.name, event);
      }
    }
    for (const name of frame.declarations.keys()) frame.locals.delete(name);
    for (const child of scope.children) children.push(build(child, frame).result);
    return frame;
  }
  const root = build(scope);
  function enclosing(frame: Frame, name: string): Frame | undefined {
    for (let parent = frame.parent; parent; parent = parent.parent) {
      if (parent.result.scope.kind === "module") return undefined;
      if (parent.result.scope.kind === "class") {
        if (name === "__class__") return parent;
        continue;
      }
      if (parent.declarations.get(name) === "global") return undefined;
      if (parent.locals.has(name)) return parent;
    }
    return undefined;
  }
  function resolve(frame: Frame, name: string): ResolvedBinding {
    const declaration = frame.declarations.get(name);
    if (frame.result.scope.kind === "module" || declaration === "global") return { kind: "global", owner: root.result.scope };
    if (declaration === "nonlocal") {
      const owner = enclosing(frame, name);
      if (!owner) throw new PythonSyntaxError(`no binding for nonlocal '${name}' found`, filename, frame.events.get(name)!.start);
      return { kind: "free", owner: owner.result.scope };
    }
    if (frame.outward.has(name)) {
      let owner = frame.parent;
      while (owner?.result.scope.kind === "comprehension") owner = owner.parent;
      if (!owner || owner.result.scope.kind === "class") throw new PythonSyntaxError("assignment expression within a comprehension cannot be used in a class body", filename, frame.events.get(name)!.start);
      const binding = resolve(owner, name);
      return binding.kind === "global" ? binding : { kind: "free", owner: binding.owner };
    }
    if (frame.locals.has(name)) return { kind: "local", owner: frame.result.scope };
    const owner = enclosing(frame, name);
    return owner ? { kind: "free", owner: owner.result.scope } : { kind: "global", owner: root.result.scope };
  }
  for (const frame of frames) {
    for (const name of frame.events.keys()) {
      const binding = resolve(frame, name);
      frame.bindings.set(name, binding);
      if (binding.kind === "free") {
        const owner = byScope.get(binding.owner)!;
        owner.cells.add(name);
        for (let current: Frame | undefined = frame; current && current !== owner; current = current.parent) {
          current.free.set(name, owner.result.scope);
        }
      }
    }
  }
  return root.result;
}
