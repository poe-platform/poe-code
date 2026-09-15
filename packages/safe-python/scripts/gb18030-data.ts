import {readCjkMapping} from "./cjk-mapping-data.js";

/** Native GB18030 extensions have independent encode/decode directions. GBK
 * takes precedence at runtime; the four-byte BMP table retains its own gaps. */
export function compileGb18030Mappings(source:string):{decode:number[];encode:number[];ranges:number[]} {
  const decode=new Array<number>(128*256).fill(-1),encode:number[]=[],ranges:number[]=[];
  function pair(bytes:number):number {
    const first=bytes>>8,second=bytes&255;
    if(first<0x81||first>0xfe||second<0x40||second>0xfe||second===0x7f)throw Error("invalid GB18030 pair");
    return bytes;
  }
  function scalar(point:number):number {
    if(point<128||point>0xffff||point>=0xd800&&point<=0xdfff)throw Error("invalid GB18030 BMP scalar");
    return point;
  }
  for(const [bytes,point] of readCjkMapping(source,"gb18030ext_decmap","U"))decode[pair(bytes)-0x8000]=scalar(point);
  for(const [point,bytes] of readCjkMapping(source,"gb18030ext_encmap","N"))encode.push(scalar(point),pair(bytes));
  const marker=" gb18030_to_unibmp_ranges[]",start=source.indexOf(marker);
  if(start<0||source.indexOf(marker,start+marker.length)>=0)throw Error("missing or duplicate GB18030 ranges");
  let offset=start+marker.length;
  function skip():void {while(offset<source.length&&source[offset].trim()==="")offset++;}
  function take(expected:string):void {
    skip();
    if(source[offset]!==expected)throw Error(`invalid GB18030 ranges: expected ${expected}`);
    offset++;
  }
  function integer():number {
    skip();
    const begin=offset;
    while(offset<source.length&&source[offset]>="0"&&source[offset]<="9")offset++;
    if(offset===begin)throw Error("invalid GB18030 range integer");
    const result=Number(source.slice(begin,offset));
    if(!Number.isSafeInteger(result))throw Error("invalid GB18030 range integer");
    return result;
  }
  take("=");take("{");
  let previous=127,nextBase=0;
  for(;;){
    take("{");const first=integer();take(",");const last=integer();take(",");const base=integer();take("}");
    if(base!==nextBase)throw Error("discontinuous GB18030 indices");
    if(first===0){
      if(last!==0||ranges.length===0)throw Error("invalid GB18030 terminator");
      take("}");take(";");
      break;
    }
    scalar(first);scalar(last);
    if(first<=previous||last<first||first<0xd800&&last>0xdfff)throw Error("invalid GB18030 range order");
    ranges.push(first,last,base);
    previous=last;nextBase=base+last-first+1;
    take(",");
  }
  return {decode,encode,ranges};
}
