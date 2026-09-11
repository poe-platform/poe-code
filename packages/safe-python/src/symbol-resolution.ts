import type { SymbolEvent, SymbolScope } from "./symbol-collection.js";
import { validateDeclarations } from "./declaration-validation.js";
import { PythonSyntaxError, type SourceMeter } from "./source.js";

export type ResolvedBinding = { readonly kind: "local" | "global" | "free"; readonly owner: SymbolScope };
export type ResolvedScope = {
  readonly scope: SymbolScope;
  readonly bindings: ReadonlyMap<string, ResolvedBinding>;
  readonly cells: ReadonlySet<string>;
  readonly free: ReadonlyMap<string, SymbolScope>;
  /** Compiler capture requirements can outlive an inline cell promotion even
   * when no executable free-variable slot remains in this scope. */
  readonly closureRequirements?:ReadonlyMap<string,SymbolScope>;
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
  closureRequirements:Map<string,SymbolScope>;
};

/** Resolve lexical owners and propagate closure requirements across intervening scopes. */
export function resolveSymbols(scope: SymbolScope, filename = "<string>",meter?:SourceMeter): ResolvedScope {
  validateDeclarations(scope, filename,meter);
  const frames: Frame[] = [];
  const byScope = new Map<SymbolScope, Frame>();
  function build(scope: SymbolScope, parent?: Frame): Frame {
    const children: ResolvedScope[] = [];
    const bindings = new Map<string, ResolvedBinding>();
    const cells = new Set<string>();
    const free = new Map<string, SymbolScope>();
    const closureRequirements=new Map<string,SymbolScope>();
    const frame: Frame = { result: { scope, bindings, cells, free, children,closureRequirements }, parent, bindings, cells, free,closureRequirements,
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
      let binding = resolve(frame, name);
      if(name==="__class__"&&binding.kind==="free"&&binding.owner.kind==="class"){
        let codeFrame=frame;
        while(codeFrame.parent){
          const node=codeFrame.result.scope.node;
          if(node.kind!=="dictionary-comprehension"&&(node.kind!=="comprehension"||node.collection==="generator"))break;
          codeFrame=codeFrame.parent;
        }
        // A class suite cannot read its own construction cell. Inlining moves
        // direct comprehension reads into that suite, but real nested code
        // (methods, lambdas and generator expressions) still captures the cell.
        if(codeFrame.result.scope===binding.owner){
          const existing=codeFrame.bindings.get(name);
          binding=existing?.kind==="free"?existing:{kind:"global",owner:root.result.scope};
        }
      }
      frame.bindings.set(name, binding);
    }
  }
  // Analyze lexical references before inline promotion: an initially global
  // reference must remain global, and nonlocal validation cannot depend on a
  // synthetic local introduced only by a later compiler transformation.
  const promoted=new Map<SymbolScope,Set<string>>();
  function inlineSymbols(frame:Frame):{symbols:Map<string,ResolvedBinding>;free:Map<string,SymbolScope>;cells:Set<string>;capturedFree:Set<string>} {
    const symbols=new Map(frame.bindings),free=frame.closureRequirements,locals=new Set<string>();
    const cells=new Set<string>(),capturedFree=new Set<string>(),promotedCells=new Set<string>();
    for(const [name,binding] of frame.bindings)if(binding.kind==="free")free.set(name,binding.owner);
    for(const childScope of frame.result.children){
      const child=byScope.get(childScope.scope)!,nested=inlineSymbols(child),node=childScope.scope.node;
      const inline=node.kind==="dictionary-comprehension"||node.kind==="comprehension"&&node.collection!=="generator";
      if(inline){
        for(const name of nested.cells)cells.add(name);
        for(const [name,binding] of nested.symbols){
          if(symbols.has(name))continue;
          if(binding.kind==="local"){
            symbols.set(name,{kind:"local",owner:frame.result.scope});locals.add(name);
            if(nested.cells.has(name))promotedCells.add(name);
          }else symbols.set(name,binding);
        }
      }
      for(const [name,owner] of nested.free){
        if(!inline||nested.capturedFree.has(name)){
          capturedFree.add(name);if(owner===frame.result.scope)cells.add(name);
        }
        if(owner!==frame.result.scope)free.set(name,owner);
      }
    }
    if(frame.result.scope.kind!=="module"&&frame.result.scope.kind!=="class"){
      promoted.set(frame.result.scope,locals);
      for(const name of locals)if(free.has(name)&&!promotedCells.has(name)){cells.add(name);free.delete(name);}
    }
    // Pass-through free names become symbols only after child inlining. Adding
    // them earlier would incorrectly prevent a local from being promoted.
    for(const [name,owner] of free)if(!symbols.has(name))symbols.set(name,{kind:"free",owner});
    return {symbols,free,cells,capturedFree};
  }
  inlineSymbols(root);
  for(const frame of frames){
    for(const [name,original] of frame.closureRequirements){
      let owner=original;
      for(let parent=frame.parent;parent&&parent.result.scope!==owner;parent=parent.parent){
        if(!promoted.get(parent.result.scope)?.has(name))continue;
        owner=parent.result.scope;frame.closureRequirements.set(name,owner);break;
      }
      byScope.get(owner)!.cells.add(name);
    }
    for(const [name,original] of frame.bindings){
      let binding=original;
      if(binding.kind==="free"){
        for(let parent=frame.parent;parent&&parent.result.scope!==binding.owner;parent=parent.parent){
          if(!promoted.get(parent.result.scope)?.has(name))continue;
          binding={kind:"free",owner:parent.result.scope};frame.bindings.set(name,binding);break;
        }
      }
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
