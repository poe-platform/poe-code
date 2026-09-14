/** Parse only the generated CPython integer/sentinel/array-offset table syntax.
 * The result is ordered by input key; no C or Python execution is involved. */
export function readCjkMapping(source:string,name:string,sentinel:string,special:Readonly<Record<string,number>>={},maximum=0xffff):Array<readonly [number,number]> {
  function table(name:string):{size:number;items:string[]} {
    const marker=` ${name}[`,start=source.indexOf(marker);
    if(start<0||source.indexOf(marker,start+marker.length)>=0)throw Error(`missing or duplicate table ${name}`);
    const bracket=source.indexOf("]",start),open=source.indexOf("{",bracket);
    if(bracket<0||open<0||source.slice(bracket+1,open).trim()!=="=")throw Error(`invalid declaration ${name}`);
    const size=integer(source.slice(start+marker.length,bracket));
    const items:string[]=[];
    let depth=0,begin=open+1,closed=false;
    for(let i=begin;i<source.length;i++){
      const char=source[i];
      if(char==="{")depth++;
      else if(char==="}"&&depth>0)depth--;
      else if(char==="}"||char===","&&depth===0){
        const item=source.slice(begin,i).trim();
        if(item)items.push(item);
        else if(char===",")throw Error(`empty table item ${name}`);
        begin=i+1;
        if(char==="}"){closed=true;break;}
      }
    }
    if(!closed||items.length!==size)throw Error(`invalid table length ${name}`);
    return {size,items};
  }
  function integer(token:string):number {
    const text=token.trim();
    if(!text||[...text].some(char=>char<"0"||char>"9"))throw Error(`invalid integer ${text}`);
    const value=Number(text);
    if(!Number.isSafeInteger(value))throw Error(`invalid integer ${text}`);
    return value;
  }
  const dataName=`__${name}`,data=table(dataName).items.map(item=>item===sentinel?-1:Object.hasOwn(special,item)?special[item]:integer(item));
  const rows=table(name);
  if(rows.size!==256)throw Error(`invalid index length ${name}`);
  const result:Array<readonly [number,number]>=[];
  rows.items.forEach((row,high)=>{
    if(!row.startsWith("{")||!row.endsWith("}"))throw Error(`invalid index row ${name}`);
    const fields=row.slice(1,-1).split(",").map(field=>field.trim());
    if(fields.length!==3)throw Error(`invalid index row ${name}`);
    const [pointer,firstText,lastText]=fields,first=integer(firstText),last=integer(lastText);
    if(pointer==="0"){
      if(first!==0||last!==0)throw Error(`invalid empty row ${name}`);
      return;
    }
    const parts=pointer.split("+").map(part=>part.trim());
    if(parts.length!==2||parts[0]!==dataName)throw Error(`invalid pointer ${pointer}`);
    const offset=integer(parts[1]);
    if(first>last||last>255||offset+last-first>=data.length)throw Error(`invalid range ${name}`);
    for(let low=first;low<=last;low++){
      const value=data[offset+low-first];
      if(value>maximum)throw Error(`invalid mapping ${name}`);
      if(value!==-1)result.push([high*256+low,value]);
    }
  });
  return result;
}
