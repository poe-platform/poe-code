/** Parse bounded wire documents without duplicate-key ambiguity. Callers admit
 * byte length first. Container depth is checked before allocating decoded values;
 * JSON.parse remains authoritative for JSON syntax and primitive semantics. */
export function parseWireJson(text:string):unknown {
  const stack:{object:boolean;key:boolean;names:Set<string>}[]=[];
  for(let i=0;i<text.length;i++){
    const token=text[i];
    if(token==='"'){
      const start=i;
      for(i++;i<text.length;i++){
        if(text[i]==='\\'){i++;continue;}
        if(text[i]==='"')break;
      }
      if(i>=text.length)throw new SyntaxError('Unterminated wire JSON string');
      const container=stack.at(-1);
      if(container?.object&&container.key){
        const name=JSON.parse(text.slice(start,i+1)) as string;
        if(container.names.has(name))throw new SyntaxError('Duplicate wire JSON key');
        container.names.add(name);container.key=false;
      }
    }else if(token==='{'||token==='['){
      if(stack.length>=64)throw new SyntaxError('Wire JSON nesting bound');
      stack.push({object:token==='{',key:token==='{',names:new Set()});
    }else if(token==='}'||token===']'){
      const container=stack.pop();
      if(!container||container.object!==(token==='}'))throw new SyntaxError('Invalid wire JSON container');
    }else if(token===','&&stack.at(-1)?.object){
      stack.at(-1)!.key=true;
    }
  }
  return JSON.parse(text) as unknown;
}
