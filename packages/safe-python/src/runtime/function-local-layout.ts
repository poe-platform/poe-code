import type {ResolvedScope} from "../symbol-resolution.js";
import {manglePrivateName} from "../private-names.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {stableSort} from "./stable-sort.js";

/** Compiler-owned names, not runtime values. Captured parameters occur in both
 * variableNames and cellNames; other cells have no fast-local slot. */
export interface FunctionLocalLayout {
  readonly variableNames:readonly string[];
  readonly cellNames:readonly string[];
  readonly freeNames:readonly string[];
  readonly positionalCount:number;
  readonly positionalOnlyCount:number;
  readonly keywordOnlyCount:number;
  readonly varPositional:boolean;
  readonly varKeyword:boolean;
}

export function compileFunctionLocalLayout(scope:ResolvedScope,meter:ExecutionMeter):FunctionLocalLayout {
  meter.checkpoint();
  const node=scope.scope.node;
  if(node.kind!=="function"&&node.kind!=="lambda")throw Error("local layout requires function or lambda code");
  meter.checkpoint(0,320);
  const variables:string[]=[],capturedParameters:string[]=[],cells:string[]=[],free:string[]=[],seen=new Set<string>();
  let positionalCount=0,positionalOnlyCount=0,keywordOnlyCount=0,varPositional=false,varKeyword=false;
  // Keyword-only parameters precede variadic slots, regardless of source order.
  for(const group of ["ordinary","var-positional","var-keyword"] as const)for(const parameter of node.parameters){
    meter.checkpoint();
    const kind=parameter.kind;
    if((kind==="var-positional"||kind==="var-keyword"?kind:"ordinary")!==group)continue;
    const name=manglePrivateName(parameter.name,scope.scope.privateName);
    meter.checkpoint(0,48);variables.push(name);seen.add(name);
    if(scope.cells.has(name)){meter.checkpoint(0,8);capturedParameters.push(name);}
    if(kind==="positional-only"){positionalCount++;positionalOnlyCount++;}
    else if(kind==="positional-or-keyword")positionalCount++;
    else if(kind==="keyword-only")keywordOnlyCount++;
    else if(kind==="var-positional")varPositional=true;
    else varKeyword=true;
  }
  for(const event of scope.scope.events){
    meter.checkpoint();
    if(event.kind==="annotation"||event.kind==="global"||event.kind==="nonlocal"||seen.has(event.name)||scope.cells.has(event.name)||scope.bindings.get(event.name)?.kind!=="local")continue;
    meter.checkpoint(0,48);variables.push(event.name);seen.add(event.name);
  }
  for(const name of scope.cells){meter.checkpoint();if(!seen.has(name)){meter.checkpoint(0,8);cells.push(name);}}
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
  for(const name of orderedCells){meter.checkpoint(1,8);capturedParameters.push(name);}
  const orderedFree=free.length>1?stableSort(free,order,meter):free;
  return Object.freeze({variableNames:Object.freeze(variables),cellNames:Object.freeze(capturedParameters),freeNames:Object.freeze(orderedFree),positionalCount,positionalOnlyCount,keywordOnlyCount,varPositional,varKeyword});
}
