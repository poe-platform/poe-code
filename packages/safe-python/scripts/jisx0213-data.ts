/** Parse the pinned generator's ordered hexadecimal pair encoder records.
 * Decode mappings remain independent; do not invert this table for decoding. */
export function readJisPairs(source:string,count:number):number[] {
  const marker=" jisx0213_pair_encmap[JISX0213_ENCPAIRS]",at=source.indexOf(marker);
  if(at<0||source.indexOf(marker,at+marker.length)>=0)throw Error("invalid JIS pair declaration");
  const open=source.indexOf("{",at),close=source.indexOf("};",open);
  if(open<0||close<0||source.slice(at+marker.length,open).trim()!=="=")throw Error("invalid JIS pair initializer");
  const input=source.slice(open+1,close),result:number[]=[];
  let position=0,previous=-1;
  const whitespace=()=>{while(position<input.length&&input[position].trim()==="")position++;};
  const token=(expected:string)=>{whitespace();if(input[position++]!==expected)throw Error("invalid JIS pair syntax");};
  const integer=()=>{
    whitespace();if(input.slice(position,position+2)!=="0x")throw Error("invalid JIS pair integer");
    position+=2;const start=position;
    while(position<input.length&&"0123456789abcdefABCDEF".includes(input[position]))position++;
    if(position===start)throw Error("empty JIS pair integer");
    const value=Number.parseInt(input.slice(start,position),16);
    if(!Number.isSafeInteger(value))throw Error("invalid JIS pair integer");
    return value;
  };
  while(true){
    whitespace();if(position===input.length)break;
    token("{");const pair=integer();token(",");const code=integer();token("}");token(",");
    if(pair<=previous||pair>0xffffffff||code>0xffff)throw Error("invalid JIS pair mapping");
    result.push(pair,code);previous=pair;
  }
  if(result.length!==count*2)throw Error("invalid JIS pair count");
  return result;
}
