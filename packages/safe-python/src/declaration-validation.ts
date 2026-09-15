import type { SymbolEvent, SymbolScope } from "./symbol-collection.js";
import { PythonSyntaxError, type SourceMeter } from "./source.js";

type History={kinds:Set<SymbolEvent["kind"]>;declaration?:SymbolEvent};

/** Check declaration ordering/conflicts before resolving lexical binding owners. */
export function validateDeclarations(scope: SymbolScope, filename = "<string>",meter?:SourceMeter): void {
  meter?.checkpoint(1,200);
  const pending=[{scope,index:0,eventIndex:0,previous:new Map<string,History>()}];
  const histories=[pending[0].previous];
  try {
  while(pending.length){
    meter?.checkpoint();
    const frame=pending[pending.length-1],current=frame.scope,child=current.children[frame.index];
    // Scope collection records the parent's event boundary at child entry.
    // Interleave those children so later parent errors cannot mask earlier ones.
    if(child&&(frame.eventIndex>=current.events.length||(child.parentEventIndex??current.events.length)<=frame.eventIndex)){
      frame.index++;meter?.checkpoint(0,136);
      const previous=new Map<string,History>();histories.push(previous);
      pending.push({scope:child,index:0,eventIndex:0,previous});continue;
    }
    if(frame.eventIndex===current.events.length){pending.pop();continue;}
    const event=current.events[frame.eventIndex++],previous=frame.previous;
    meter?.checkpoint(1+event.name.length);
    let history = previous.get(event.name);
    if(!history){meter?.checkpoint(0,144);history={kinds:new Set<SymbolEvent["kind"]>()};previous.set(event.name,history);}
    const kinds=history.kinds;
    if (event.kind === "parameter" && kinds.has("parameter")) throw declarationError(event,filename,"duplicate argument '","' in function definition",meter);
    if (event.kind === "global" || event.kind === "nonlocal") {
      if (event.kind === "nonlocal" && current.kind === "module") {meter?.checkpoint(0,352);throw new PythonSyntaxError("nonlocal declaration not allowed at module level",filename,event.start);}
      if (kinds.has("parameter")) throw declarationError(event,filename,"name '",`' is parameter and ${event.kind}`,meter);
      if (kinds.has("annotation")) throw declarationError(event,filename,"annotated name '",`' can't be ${event.kind}`,meter);
      if (kinds.has("write") || kinds.has("delete") || kinds.has("write-outer")) throw declarationError(event,filename,"name '",`' is assigned to before ${event.kind} declaration`,meter);
      if (kinds.has("read") || kinds.has("implicit-read")) throw declarationError(event,filename,"name '",`' is used prior to ${event.kind} declaration`,meter);
      history.declaration??=event;
    } else if (event.kind === "annotation" && (kinds.has("global") || kinds.has("nonlocal"))) {
      throw declarationError(event,filename,"annotated name '",kinds.has("global")?"' can't be global":"' can't be nonlocal",meter);
    }
    if(!kinds.has(event.kind)){meter?.checkpoint(0,32);kinds.add(event.kind);}
  }
  // Flag conflicts are a post-collection check; immediate ordering/annotation
  // errors anywhere in the collected tree take precedence.
  for(const history of histories){
    meter?.checkpoint(1,64);
    for(const entry of history.values()){
      meter?.checkpoint();
      if(entry.kinds.has("global")&&entry.kinds.has("nonlocal"))throw declarationError(entry.declaration!,filename,"name '","' is nonlocal and global",meter);
    }
  }
  } finally {meter?.checkpoint();}
}

function declarationError(event:SymbolEvent,filename:string,prefix:string,suffix:string,meter?:SourceMeter):PythonSyntaxError{
  meter?.checkpoint(1+event.name.length,256+2*(prefix.length+event.name.length+suffix.length));
  return new PythonSyntaxError(prefix+event.name+suffix,filename,event.start);
}
