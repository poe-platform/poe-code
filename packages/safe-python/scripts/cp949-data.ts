import {readCjkMapping} from "./cjk-mapping-data.js";

/** CPython's CP949 decoder tries KS X 1001 before the UHC extension. Its
 * encoder has a separate table with the high bit selecting UHC byte spelling;
 * inverting either decoder table would lose this contract. */
export function compileCp949Mappings(source:string):{decode:number[];encode:number[]} {
  const decode=new Array<number>(128*256).fill(-1);
  function ksxPair(bytes:number):number {
    const first=bytes>>8,second=bytes&255;
    if(first<0x21||first>0x7e||second<0x21||second>0x7e)throw Error("invalid KS X 1001 pair");
    return bytes|0x8080;
  }
  function extensionPair(bytes:number):number {
    const first=bytes>>8,second=bytes&255;
    if(first<0x81||first>0xfe||!(second>=0x41&&second<=0x5a||second>=0x61&&second<=0x7a||second>=0x81&&second<=0xfe))throw Error("invalid CP949 extension pair");
    return bytes;
  }
  for(const [bytes,point] of readCjkMapping(source,"cp949ext_decmap","U"))decode[extensionPair(bytes)-0x8000]=point;
  for(const [bytes,point] of readCjkMapping(source,"ksx1001_decmap","U"))decode[ksxPair(bytes)-0x8000]=point;
  const encode=readCjkMapping(source,"cp949_encmap","N").flatMap(([point,bytes])=>[point,bytes&0x8000?extensionPair(bytes):ksxPair(bytes)]);
  return {decode,encode};
}
