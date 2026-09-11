import type { Expression } from "./ast.js";
import type { Pattern } from "./pattern-ast.js";
import type {SourceMeter} from "./source.js";

export function* patternExpressions(pattern: Pattern,meter?:SourceMeter): Generator<Expression> {
  meter?.checkpoint(1,96);
  const pending=[{pattern,index:0}];
  try {
  while(pending.length){
    meter?.checkpoint();
    const frame=pending[pending.length-1],current=frame.pattern,index=frame.index++;
    let child:Pattern|undefined;
    switch (current.kind) {
      case "capture": case "star": pending.pop();break;
      case "value": case "singleton": pending.pop();yield current.value;break;
      case "as": frame.pattern=current.pattern;frame.index=0;break;
      case "or": child=current.patterns[index];if(!child)pending.pop();break;
      case "sequence": child=current.items[index];if(!child)pending.pop();break;
      case "mapping": {
        const entry=current.entries[Math.floor(index/2)];
        if(!entry)pending.pop();else if(index%2===0)yield entry.key;else child=entry.pattern;
        break;
      }
      case "class":
        if(index===0)yield current.class;
        else {child=index<=current.positional.length?current.positional[index-1]:current.keywords[index-current.positional.length-1]?.pattern;if(!child)pending.pop();}
        break;
      default: { const exhaustive: never = current; throw new Error(`unknown pattern: ${exhaustive}`); }
    }
    if(child){meter?.checkpoint(0,64);pending.push({pattern:child,index:0});}
  }
  } finally {meter?.checkpoint();}
}
