import type {ResolvedScope} from "../symbol-resolution.js";
import {manglePrivateName} from "../private-names.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {stableSort} from "./stable-sort.js";

/** Compiler-owned names, not runtime values. Captured parameters occur in both
 * variableNames and cellNames. Inlined comprehensions also reserve fast slots
 * for saving/restoring cells, including in module and class code. */
export interface CodeLocalLayout {
  readonly variableNames:readonly string[];
  readonly cellNames:readonly string[];
  readonly freeNames:readonly string[];
  readonly positionalCount:number;
  readonly positionalOnlyCount:number;
  readonly keywordOnlyCount:number;
  readonly varPositional:boolean;
  readonly varKeyword:boolean;
}

export function compileCodeLocalLayout(scope:ResolvedScope,meter:ExecutionMeter):CodeLocalLayout {
  meter.checkpoint();
  const node=scope.scope.node;
  const generator=node.kind==="comprehension"&&node.collection==="generator";
  if(node.kind!=="function"&&node.kind!=="lambda"&&node.kind!=="module"&&node.kind!=="class"&&!generator)throw Error("local layout requires a code-owning scope");
  const optimized=node.kind==="function"||node.kind==="lambda"||generator;
  meter.checkpoint(0,640);
  const variables:string[]=[],sharedCells:string[]=[],cells:string[]=[],free:string[]=[],seen=new Set<string>();
  const owned=new Set([scope.scope]),codeChildren:ResolvedScope[]=[];
  const inlined=(child:ResolvedScope)=>child.scope.node.kind==="dictionary-comprehension"||child.scope.node.kind==="comprehension"&&child.scope.node.collection!=="generator";
  const pending=[scope];
  while(pending.length){
    meter.checkpoint();const current=pending.pop()!;
    for(const child of current.children){
      meter.checkpoint();
      if(inlined(child)){meter.checkpoint(0,48);owned.add(child.scope);pending.push(child);}
      else {meter.checkpoint(0,8);codeChildren.push(child);}
    }
  }
  // Only an actual nested code object needs a closure. Lexical resolution also
  // has cells used solely to connect inline binding environments.
  const captured=new Set<string>(),rootCaptured=new Set<string>();
  for(const child of codeChildren)for(const [name,owner] of child.free){
    meter.checkpoint();if(!owned.has(owner))continue;
    if(!captured.has(name)){meter.checkpoint(0,40);captured.add(name);}
    if(owner===scope.scope&&!rootCaptured.has(name)){meter.checkpoint(0,40);rootCaptured.add(name);}
  }
  let positionalCount=0,positionalOnlyCount=0,keywordOnlyCount=0,varPositional=false,varKeyword=false;
  if(generator){meter.checkpoint(0,48);variables.push(".0");seen.add(".0");positionalCount=1;}
  // Keyword-only parameters precede variadic slots, regardless of source order.
  for(const group of ["ordinary","var-positional","var-keyword"] as const)for(const parameter of node.kind==="function"||node.kind==="lambda"?node.parameters:[]){
    meter.checkpoint();
    const kind=parameter.kind;
    if((kind==="var-positional"||kind==="var-keyword"?kind:"ordinary")!==group)continue;
    const name=manglePrivateName(parameter.name,scope.scope.privateName);
    meter.checkpoint(0,48);variables.push(name);seen.add(name);
    if(kind==="positional-only"){positionalCount++;positionalOnlyCount++;}
    else if(kind==="positional-or-keyword")positionalCount++;
    else if(kind==="keyword-only")keywordOnlyCount++;
    else if(kind==="var-positional")varPositional=true;
    else varKeyword=true;
  }
  const reserveInline=(child:ResolvedScope):void=>{
    meter.checkpoint(1,64);
    const globalWrites=new Set<string>();
    for(const event of child.scope.events){
      meter.checkpoint();if(event.kind==="write-outer"&&child.bindings.get(event.name)?.kind==="global"){meter.checkpoint(0,40);globalWrites.add(event.name);}
    }
    for(const [name,binding] of child.bindings){
      meter.checkpoint();if(binding.kind!=="local"&&!globalWrites.has(name)||seen.has(name))continue;
      meter.checkpoint(0,48);variables.push(name);seen.add(name);
    }
    for(const nested of child.children){meter.checkpoint();if(inlined(nested))reserveInline(nested);}
  };
  let childIndex=0;
  for(let index=0;index<=scope.scope.events.length;index++){
    meter.checkpoint();
    while(childIndex<scope.children.length&&scope.children[childIndex].scope.parentEventIndex===index){
      const child=scope.children[childIndex++];meter.checkpoint();if(inlined(child))reserveInline(child);
    }
    if(!optimized||index===scope.scope.events.length)continue;
    const event=scope.scope.events[index];
    if(event.kind==="annotation"||event.kind==="global"||event.kind==="nonlocal"||seen.has(event.name)||rootCaptured.has(event.name)||scope.bindings.get(event.name)?.kind!=="local")continue;
    meter.checkpoint(0,48);variables.push(event.name);seen.add(event.name);
  }
  for(const name of variables){meter.checkpoint();if(captured.has(name)){meter.checkpoint(0,8);sharedCells.push(name);}}
  for(const name of captured){meter.checkpoint();if(!seen.has(name)){meter.checkpoint(0,8);cells.push(name);}}
  for(const name of scope.free.keys()){meter.checkpoint(1,8);free.push(name);}
  meter.checkpoint(0,128);
  const order={key:(name:string)=>name,less(left:string,right:string){
    let a=0,b=0;
    while(a<left.length&&b<right.length){
      meter.checkpoint();const x=left.codePointAt(a)!,y=right.codePointAt(b)!;
      if(x!==y)return x<y;
      a+=x>0xffff?2:1;b+=y>0xffff?2:1;
    }
    return a===left.length&&b<right.length;
  }};
  const orderedCells=cells.length>1?stableSort(cells,order,meter):cells;
  for(const name of orderedCells){meter.checkpoint(1,8);sharedCells.push(name);}
  const orderedFree=free.length>1?stableSort(free,order,meter):free;
  return Object.freeze({variableNames:Object.freeze(variables),cellNames:Object.freeze(sharedCells),freeNames:Object.freeze(orderedFree),positionalCount,positionalOnlyCount,keywordOnlyCount,varPositional,varKeyword});
}
