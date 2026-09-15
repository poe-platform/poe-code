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
  result: ResolvedScope & {children:ResolvedScope[]};
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
  meter?.checkpoint(1,128);
  try {
  validateDeclarations(scope, filename,meter);
  meter?.checkpoint();
  function put<K,V>(map:Map<K,V>,key:K,value:V):void{
    meter?.checkpoint(1+(typeof key==="string"?key.length:0));
    if(!map.has(key))meter?.checkpoint(0,32);map.set(key,value);
  }
  function add(set:Set<string>,name:string):void{
    meter?.checkpoint(1+name.length);if(!set.has(name))meter?.checkpoint(0,32);set.add(name);
  }
  const frames: Frame[] = [];
  const byScope = new Map<SymbolScope, Frame>();
  function build(scope: SymbolScope, parent?: Frame): Frame {
    meter?.checkpoint(1,848);
    const children: ResolvedScope[] = [];
    const bindings = new Map<string, ResolvedBinding>();
    const cells = new Set<string>();
    const free = new Map<string, SymbolScope>();
    const closureRequirements=new Map<string,SymbolScope>();
    const frame: Frame = { result: { scope, bindings, cells, free, children,closureRequirements }, parent, bindings, cells, free,closureRequirements,
      locals: new Set(), declarations: new Map(), outward: new Set(), events: new Map() };
    frames.push(frame);
    put(byScope,scope,frame);
    for (const event of scope.events) {
      meter?.checkpoint(1+event.name.length);
      if (!frame.events.has(event.name)) put(frame.events,event.name,event);
      if (event.kind==="write"||event.kind==="delete"||event.kind==="parameter"||event.kind==="annotation"||event.kind==="import") add(frame.locals,event.name);
      if (event.kind === "write-outer") add(frame.outward,event.name);
      if (event.kind === "global" || event.kind === "nonlocal") {
        put(frame.declarations,event.name,event.kind);
        put(frame.events,event.name,event);
      }
    }
    for (const name of frame.declarations.keys()) {meter?.checkpoint(1+name.length);frame.locals.delete(name);}
    return frame;
  }
  const root = build(scope);
  meter?.checkpoint(0,96);const building=[{frame:root,index:0}];
  while(building.length){
    meter?.checkpoint();const current=building[building.length-1];
    if(current.index===current.frame.result.scope.children.length){building.pop();continue;}
    const child=build(current.frame.result.scope.children[current.index++],current.frame);
    meter?.checkpoint(0,72);current.frame.result.children.push(child.result);building.push({frame:child,index:0});
  }
  function enclosing(frame: Frame, name: string): Frame | undefined {
    for (let parent = frame.parent; parent; parent = parent.parent) {
      meter?.checkpoint(1+name.length);
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
    let outward=false;
    for(;;){
    meter?.checkpoint(1+name.length,48);
    const declaration = frame.declarations.get(name);
    if (frame.result.scope.kind === "module" || declaration === "global") return { kind: "global", owner: root.result.scope };
    if (declaration === "nonlocal") {
      const owner = enclosing(frame, name);
      if (!owner) {meter?.checkpoint(0,320+2*name.length);throw new PythonSyntaxError(`no binding for nonlocal '${name}' found`, filename, frame.events.get(name)!.start);}
      return { kind: "free", owner: owner.result.scope };
    }
    if (frame.outward.has(name)) {
      let owner = frame.parent;
      while (owner?.result.scope.kind === "comprehension") {meter?.checkpoint();owner = owner.parent;}
      if (!owner || owner.result.scope.kind === "class") {meter?.checkpoint(0,416);throw new PythonSyntaxError("assignment expression within a comprehension cannot be used in a class body", filename, frame.events.get(name)!.start);}
      frame=owner;outward=true;continue;
    }
    if (frame.locals.has(name)) return { kind: outward?"free":"local", owner: frame.result.scope };
    const owner = enclosing(frame, name);
    return owner ? { kind: "free", owner: owner.result.scope } : { kind: "global", owner: root.result.scope };
    }
  }
  for (const frame of frames) {
    meter?.checkpoint();
    for (const name of frame.events.keys()) {
      meter?.checkpoint(1+name.length);
      let binding = resolve(frame, name);
      if(name==="__class__"&&binding.kind==="free"&&binding.owner.kind==="class"){
        let codeFrame=frame;
        while(codeFrame.parent){
          meter?.checkpoint();
          const node=codeFrame.result.scope.node;
          if(node.kind!=="dictionary-comprehension"&&(node.kind!=="comprehension"||node.collection==="generator"))break;
          codeFrame=codeFrame.parent;
        }
        // A class suite cannot read its own construction cell. Inlining moves
        // direct comprehension reads into that suite, but real nested code
        // (methods, lambdas and generator expressions) still captures the cell.
        if(codeFrame.result.scope===binding.owner){
          const existing=codeFrame.bindings.get(name);
          if(existing?.kind==="free")binding=existing;else{meter?.checkpoint(0,48);binding={kind:"global",owner:root.result.scope};}
        }
      }
      put(frame.bindings,name,binding);
    }
  }
  // Analyze lexical references before inline promotion: an initially global
  // reference must remain global, and nonlocal validation cannot depend on a
  // synthetic local introduced only by a later compiler transformation.
  meter?.checkpoint(0,128);
  const promoted=new Map<SymbolScope,Set<string>>();
  type InlineResult={symbols:Map<string,ResolvedBinding>;free:Map<string,SymbolScope>;cells:Set<string>;capturedFree:Set<string>};
  const inlineResults=new Map<Frame,InlineResult>();
  function inlineSymbols(frame:Frame):InlineResult {
    meter?.checkpoint(1+frame.bindings.size,384+32*frame.bindings.size);
    const symbols=new Map(frame.bindings),free=frame.closureRequirements,locals=new Set<string>();
    const cells=new Set<string>(),capturedFree=new Set<string>(),promotedCells=new Set<string>();
    for(const [name,binding] of frame.bindings){meter?.checkpoint(1+name.length);if(binding.kind==="free")put(free,name,binding.owner);}
    for(const childScope of frame.result.children){
      meter?.checkpoint();
      const child=byScope.get(childScope.scope)!,nested=inlineResults.get(child)!,node=childScope.scope.node;
      inlineResults.delete(child);
      const inline=node.kind==="dictionary-comprehension"||node.kind==="comprehension"&&node.collection!=="generator";
      if(inline){
        for(const name of nested.cells)add(cells,name);
        for(const [name,binding] of nested.symbols){
          meter?.checkpoint(1+name.length);
          if(symbols.has(name))continue;
          if(binding.kind==="local"){
            meter?.checkpoint(0,48);put(symbols,name,{kind:"local",owner:frame.result.scope});add(locals,name);
            if(nested.cells.has(name))add(promotedCells,name);
          }else put(symbols,name,binding);
        }
      }
      for(const [name,owner] of nested.free){
        meter?.checkpoint(1+name.length);
        if(!inline||nested.capturedFree.has(name)){
          add(capturedFree,name);if(owner===frame.result.scope)add(cells,name);
        }
        if(owner!==frame.result.scope)put(free,name,owner);
      }
    }
    if(frame.result.scope.kind!=="module"&&frame.result.scope.kind!=="class"){
      put(promoted,frame.result.scope,locals);
      for(const name of locals){meter?.checkpoint(1+name.length);if(free.has(name)&&!promotedCells.has(name)){add(cells,name);free.delete(name);}}
    }
    // Pass-through free names become symbols only after child inlining. Adding
    // them earlier would incorrectly prevent a local from being promoted.
    for(const [name,owner] of free){meter?.checkpoint(1+name.length);if(!symbols.has(name)){meter?.checkpoint(0,48);put(symbols,name,{kind:"free",owner});}}
    return {symbols,free,cells,capturedFree};
  }
  // Build order is preorder, so reverse order makes every child available
  // before its parent without a recursive closure-propagation call chain.
  for(let index=frames.length-1;index>=0;index--){
    meter?.checkpoint();const frame=frames[index];put(inlineResults,frame,inlineSymbols(frame));
  }
  for(const frame of frames){
    meter?.checkpoint();
    for(const [name,original] of frame.closureRequirements){
      meter?.checkpoint(1+name.length);
      let owner=original;
      for(let parent=frame.parent;parent&&parent.result.scope!==owner;parent=parent.parent){
        meter?.checkpoint(1+name.length);
        if(!promoted.get(parent.result.scope)?.has(name))continue;
        owner=parent.result.scope;put(frame.closureRequirements,name,owner);break;
      }
      add(byScope.get(owner)!.cells,name);
    }
    for(const [name,original] of frame.bindings){
      meter?.checkpoint(1+name.length);
      let binding=original;
      if(binding.kind==="free"){
        for(let parent=frame.parent;parent&&parent.result.scope!==binding.owner;parent=parent.parent){
          meter?.checkpoint(1+name.length);
          if(!promoted.get(parent.result.scope)?.has(name))continue;
          meter?.checkpoint(0,48);binding={kind:"free",owner:parent.result.scope};put(frame.bindings,name,binding);break;
        }
      }
      if (binding.kind === "free") {
        const owner = byScope.get(binding.owner)!;
        add(owner.cells,name);
        for (let current: Frame | undefined = frame; current && current !== owner; current = current.parent) {
          meter?.checkpoint();
          put(current.free,name,owner.result.scope);
        }
      }
    }
  }
  return root.result;
  } finally {meter?.checkpoint();}
}
