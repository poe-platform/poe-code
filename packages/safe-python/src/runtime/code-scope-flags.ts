import type {SymbolScope} from "../symbol-collection.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {normalizeFutureFlags} from "../future-flags.js";

/** Symbol-table flags precede executable-body flags. Inlined comprehension
 * scopes still affect lexical nesting without acquiring their own code object. */
export function compileCodeScopeFlags(root:SymbolScope,features:ReadonlySet<string>,meter:ExecutionMeter,inheritedFlags=0):ReadonlyMap<SymbolScope,number> {
  try {
  meter.checkpoint(1,352);
  let future=normalizeFutureFlags(inheritedFlags,meter);
  for(const [name,flag] of [["barry_as_FLUFL",0x400000],["annotations",0x1000000]] as const){meter.checkpoint();if(features.has(name))future|=flag;}
  const result=new Map<SymbolScope,number>();
  const pending:Array<{scope:SymbolScope;parent?:SymbolScope;nested:boolean}>=[{scope:root,nested:false}];
  while(pending.length){
    meter.checkpoint(1,48);
    const {scope,parent,nested}=pending.pop()!,functionLike=scope.kind==="function"||scope.kind==="lambda"||scope.kind==="comprehension";
    let flags=future;
    if(functionLike){flags|=3;if(nested)flags|=0x10;}
    if((scope.kind==="function"||scope.kind==="lambda"||scope.node.kind==="comprehension"&&scope.node.collection==="generator")&&parent?.kind==="class")flags|=0x8000000;
    result.set(scope,flags);
    for(let index=scope.children.length-1;index>=0;index--){
      meter.checkpoint(1,64);pending.push({scope:scope.children[index],parent:scope,nested:nested||functionLike});
    }
  }
  return result;
  } finally { meter.checkpoint(); }
}
