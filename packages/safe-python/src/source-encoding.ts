import {PythonSyntaxError,type SourceMeter} from "./source.js";
import {decodeUtf8} from "./runtime/utf8-decode.js";
import {ExecutionLimitError} from "./runtime/execution-budget.js";

export interface SourceEncoding {
  readonly encoding:string;
  readonly bomLength:0|3;
}

/** Inspect byte-source headers only. Codec lookup/decoding belongs to the caller;
 * unknown names are retained, never silently replaced with UTF-8. Python str
 * sources must bypass this scanner because their coding comments are ignored.
 */
export function detectSourceEncoding(source:Uint8Array,options:{filename?:string;meter?:SourceMeter;mode?:"exec"|"eval"}={}):SourceEncoding {
  const {meter}=options;
  let fatal=false;
  try {
    meter?.checkpoint(1,64);
    const bomLength=source[0]===0xef&&source[1]===0xbb&&source[2]===0xbf?3:0;
    let start:number=bomLength;
    for(let line=1;line<=2&&start<source.length;line++){
      let end=start;
      while(end<source.length&&source[end]!==10&&source[end]!==13){meter?.checkpoint();end++;}
      // Expression input does not receive the tokenizer's implicit final LF.
      // Only completed physical lines participate in its cookie scan.
      if(end===source.length&&options.mode==="eval")break;
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
          const points=decodeUtf8(source.subarray(start,end),"replace",meter).text;
          let text="";
          for(const point of points){meter?.checkpoint(1,4);text+=String.fromCodePoint(point);}
          // The string tokenizer passes the second line's size including the
          // separating newline. Its explicit range is measured in bytes, even
          // though diagnostic text is decoded with replacement. The filename
          // is assigned only after constructing the original exception args.
          throw new PythonSyntaxError(`encoding problem: ${encoding} with BOM`,options.filename??"<string>",
            {offset:start,line,column:-1},{offset:end,line,column:end-start+line-2},null).withSourceLine(text,meter);
        }
        return Object.freeze({encoding,bomLength});
      }
      start=end+1;
      if(source[end]===13&&source[start]===10)start++;
    }
    return Object.freeze({encoding:"utf-8",bomLength});
  } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
  finally {if(!fatal)meter?.checkpoint();}
}
