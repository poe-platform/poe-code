import type { SymbolScope } from "./symbol-collection.js";
import { manglePrivateName } from "./private-names.js";
import type {SourceMeter} from "./source.js";

type CodeParent = { scope: SymbolScope; name: string; globals: ReadonlySet<string> };

/** Compile lexical code names from validated scopes, independent of runtime
 * rebinding. Python 3.14 list/set/dict comprehensions are inlined and therefore
 * have no code-name entry; their children belong to the containing code scope.
 * Generator expressions retain a code scope. Ignored type syntax creates none.
 * Returned names use normalized source spelling, not private storage mangling.
 */
export function collectQualifiedNames(root: SymbolScope,meter?:SourceMeter): ReadonlyMap<SymbolScope, string> {
  meter?.checkpoint(1,192);
  try {
  const names = new Map<SymbolScope, string>();
  const work: { scope: SymbolScope; parent?: CodeParent; current?:CodeParent;index:number }[] = [{ scope: root,index:-1 }];
  while (work.length) {
    meter?.checkpoint();
    const frame=work[work.length-1],{scope,parent}=frame;
    if(frame.index>=0){
      if(frame.index===scope.children.length){work.pop();continue;}
      meter?.checkpoint(0,96);work.push({scope:scope.children[frame.index++],parent:frame.current,index:-1});
      continue;
    }
    frame.index=0;
    const node = scope.node;
    const inlined = node.kind === "dictionary-comprehension" || node.kind === "comprehension" && node.collection !== "generator";
    let current = parent;
    if (!inlined) {
      const own = node.kind === "class" || node.kind === "function" ? node.name.name
        : node.kind === "lambda" ? "<lambda>" : node.kind === "comprehension" ? "<genexpr>" : "<module>";
      const forcedGlobal = parent !== undefined && (node.kind === "class" || node.kind === "function")
        && parent.globals.has(manglePrivateName(own, parent.scope.privateName,meter));
      const nested=parent!==undefined&&parent.scope.kind!=="module"&&!forcedGlobal;
      const prefix=nested?parent.name:"",separator=nested?(parent.scope.kind==="function"||parent.scope.kind==="lambda"?".<locals>.":"."):"";
      meter?.checkpoint(own.length+prefix.length,32+2*(prefix.length+separator.length+own.length));
      const name = prefix + separator + own;
      if(!names.has(scope))meter?.checkpoint(0,32);
      names.set(scope, name);
      meter?.checkpoint(0,64);
      const globals = new Set<string>();
      for (const event of scope.events) {
        meter?.checkpoint();
        if(event.kind==="global") {meter?.checkpoint(event.name.length);if(!globals.has(event.name))meter?.checkpoint(0,32);globals.add(event.name);}
      }
      meter?.checkpoint(0,48);
      current = { scope, name, globals };
    }
    frame.current=current;
  }
  return names;
  } finally {meter?.checkpoint();}
}
