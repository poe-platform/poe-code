import {PythonSyntaxError,type SourceMeter} from "./source.js";

export interface SourceEncoding {
  readonly encoding:string;
  readonly bomLength:0|3;
}

/** Inspect byte-source headers only. Codec lookup/decoding belongs to the caller;
 * unknown names are retained, never silently replaced with UTF-8. Python str
 * sources must bypass this scanner because their coding comments are ignored.
 */
export function detectSourceEncoding(source:Uint8Array,options:{filename?:string;meter?:SourceMeter}={}):SourceEncoding {
  const {meter}=options;
  try {
    meter?.checkpoint(1,64);
    const bomLength=source[0]===0xef&&source[1]===0xbb&&source[2]===0xbf?3:0;
    let start:number=bomLength;
    for(let line=1;line<=2&&start<source.length;line++){
      let end=start;
      while(end<source.length&&source[end]!==10&&source[end]!==13){meter?.checkpoint();end++;}
      let offset=start;
      while(offset<end&&(source[offset]===32||source[offset]===9||source[offset]===12)){meter?.checkpoint();offset++;}
      if(offset<end&&source[offset]!==35)break;
      for(;offset+6<end;offset++){
        meter?.checkpoint();
        if(source[offset]!==99||source[offset+1]!==111||source[offset+2]!==100||source[offset+3]!==105||source[offset+4]!==110||source[offset+5]!==103)continue;
        if(source[offset+6]!==58&&source[offset+6]!==61)continue;
        let begin=offset+7;
        while(begin<end&&(source[begin]===32||source[begin]===9)){meter?.checkpoint();begin++;}
        let stop=begin;
        while(stop<end){
          meter?.checkpoint();
          const byte=source[stop];
          if(!((byte>=65&&byte<=90)||(byte>=97&&byte<=122)||(byte>=48&&byte<=57)||byte===45||byte===95||byte===46))break;
          stop++;
        }
        if(stop===begin)continue;
        meter?.checkpoint(1,128+66*(stop-begin));
        let encoding="";
        for(let index=begin;index<stop;index++){meter?.checkpoint();encoding+=String.fromCharCode(source[index]);}
        const normal=encoding.slice(0,12).toLowerCase().replaceAll("_","-");
        if(normal==="utf-8"||normal.startsWith("utf-8-"))encoding="utf-8";
        else if(normal==="latin-1"||normal==="iso-8859-1"||normal==="iso-latin-1"||normal.startsWith("latin-1-")||normal.startsWith("iso-8859-1-")||normal.startsWith("iso-latin-1-"))encoding="iso-8859-1";
        if(bomLength!==0&&encoding!=="utf-8"){
          meter?.checkpoint(1,320+2*encoding.length);
          throw new PythonSyntaxError(`encoding problem: ${encoding} with BOM`,options.filename??"<string>",{offset:start,line,column:0});
        }
        return Object.freeze({encoding,bomLength});
      }
      start=end+1;
      if(source[end]===13&&source[start]===10)start++;
    }
    return Object.freeze({encoding:"utf-8",bomLength});
  } finally {meter?.checkpoint();}
}
