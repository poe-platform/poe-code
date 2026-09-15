import type { Pattern } from "./pattern-ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { patternLiteralKey } from "./pattern-literal-keys.js";

/** Validate captures in depth-first order without using the host call stack. */
export function validatePattern(pattern: Pattern, cursor: TokenCursor): boolean {
  try {
  cursor.meter?.checkpoint(1,304);
  type Frame={pattern:Pattern;names:Set<string>;index:number;starred?:boolean;keys?:Set<string>;captures?:Set<string>;previous?:Set<string>;irrefutable?:boolean};
  const pending:Frame[]=[{pattern,names:new Set(),index:0}];
  let result=false;
  function bind(names:Set<string>,name:string):void {
    cursor.meter?.checkpoint(1+name.length);
    if(names.has(name)){
      cursor.meter?.checkpoint(0,128+2*name.length);
      throw cursor.error(`multiple assignments to name '${name}' in pattern`);
    }
    cursor.meter?.checkpoint(0,32);names.add(name);
  }
  while(pending.length){
    cursor.meter?.checkpoint();
    const frame=pending[pending.length-1],{pattern,names}=frame;
    switch(pattern.kind){
      case "capture":case "star":
        if(pattern.name)bind(names,pattern.name.name);
        result=true;pending.pop();break;
      case "value":case "singleton":
        result=false;pending.pop();break;
      case "as":
        if(frame.index===0){
          frame.index=1;cursor.meter?.checkpoint(0,128);
          pending.push({pattern:pattern.pattern,names,index:0});
        }else{bind(names,pattern.name.name);pending.pop();}
        break;
      case "or":{
        if(frame.captures){
          const captures=frame.captures,previous=frame.previous;
          if(previous){
            if(previous.size!==captures.size)throw cursor.error("alternative patterns bind different names");
            cursor.meter?.checkpoint(0,48);
            for(const name of previous){
              cursor.meter?.checkpoint(1+name.length);
              if(!captures.has(name))throw cursor.error("alternative patterns bind different names");
            }
          }
          frame.previous=captures;frame.captures=undefined;frame.irrefutable=result;
        }
        if(frame.index<pattern.patterns.length){
          if(frame.irrefutable)throw cursor.error("irrefutable pattern makes remaining alternatives unreachable");
          cursor.meter?.checkpoint(0,192);
          const captures=new Set<string>();frame.captures=captures;
          pending.push({pattern:pattern.patterns[frame.index++],names:captures,index:0});
        }else{
          if(frame.previous){cursor.meter?.checkpoint(0,48);for(const name of frame.previous)bind(names,name);}
          result=frame.irrefutable??false;pending.pop();
        }
        break;
      }
      case "sequence":
        if(frame.index<pattern.items.length){
          const item=pattern.items[frame.index++];
          if(item.kind==="star"){
            if(frame.starred)throw cursor.error("multiple starred names in sequence pattern");
            frame.starred=true;
          }
          cursor.meter?.checkpoint(0,128);pending.push({pattern:item,names,index:0});
        }else{result=false;pending.pop();}
        break;
      case "mapping":{
        if(!frame.keys){cursor.meter?.checkpoint(0,64);frame.keys=new Set();}
        if(frame.index<pattern.entries.length){
          const entry=pattern.entries[frame.index++],key=patternLiteralKey(entry.key,cursor.meter);
          if(key!==undefined){
            cursor.meter?.checkpoint(1+key.length);
            if(frame.keys.has(key))throw cursor.error("mapping pattern checks duplicate key");
            cursor.meter?.checkpoint(0,32);frame.keys.add(key);
          }
          cursor.meter?.checkpoint(0,128);pending.push({pattern:entry.pattern,names,index:0});
        }else{
          if(pattern.rest)bind(names,pattern.rest.name);
          result=false;pending.pop();
        }
        break;
      }
      case "class":
        if(frame.index<pattern.positional.length+pattern.keywords.length){
          const index=frame.index++,child=index<pattern.positional.length?pattern.positional[index]:pattern.keywords[index-pattern.positional.length].pattern;
          cursor.meter?.checkpoint(0,128);pending.push({pattern:child,names,index:0});
        }else{result=false;pending.pop();}
        break;
      default:{const exhaustive:never=pattern;throw new Error(`unknown pattern: ${exhaustive}`);}
    }
  }
  return result;
  } finally {cursor.meter?.checkpoint();}
}
