import type {ResolvedScope} from "../symbol-resolution.js";
import type {CodeLocalLayout} from "./code-local-layout.js";
import type {ExecutionMeter} from "./execution-budget.js";

/** Temporary storage names, not a code object. A nested inline local is also
 * isolated at this entry unless the enclosing comprehension uses that name. */
export function compileInlineLocalLayout(scope:ResolvedScope,meter:ExecutionMeter,cache=new WeakMap<ResolvedScope,CodeLocalLayout>()):CodeLocalLayout {
  meter.checkpoint();
  const node=scope.scope.node;
  if(node.kind!=="dictionary-comprehension"&&(node.kind!=="comprehension"||node.collection==="generator"))throw Error("inline layout requires a materialized comprehension");
  const cached=cache.get(scope);if(cached!==undefined)return cached;
  meter.checkpoint(1,192);
  const names=new Set<string>();
  const globalWrites=new Set<string>();
  for(const event of scope.scope.events){
    meter.checkpoint();
    if(event.kind==="write-outer"&&scope.bindings.get(event.name)?.kind==="global"){
      meter.checkpoint(0,40);globalWrites.add(event.name);
    }
  }
  for(const [name,binding] of scope.bindings){
    meter.checkpoint();
    if(binding.kind==="local"||globalWrites.has(name)){meter.checkpoint(0,40);names.add(name);}
  }
  for(const child of scope.children){
    meter.checkpoint();const node=child.scope.node;
    if(node.kind!=="dictionary-comprehension"&&(node.kind!=="comprehension"||node.collection==="generator"))continue;
    for(const name of compileInlineLocalLayout(child,meter,cache).variableNames){
      meter.checkpoint();if(scope.bindings.has(name)||names.has(name))continue;
      meter.checkpoint(0,40);names.add(name);
    }
  }
  meter.checkpoint(0,176+names.size*8);
  const layout=Object.freeze({variableNames:Object.freeze([...names]),cellNames:Object.freeze([]),freeNames:Object.freeze([]),positionalCount:0,positionalOnlyCount:0,keywordOnlyCount:0,varPositional:false,varKeyword:false});
  cache.set(scope,layout);return layout;
}
