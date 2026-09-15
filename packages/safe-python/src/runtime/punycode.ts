import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";

// RFC 3492 parameters and CPython 3.14.7 encodings.punycode error semantics.
// Integer arithmetic is exact, including malformed inputs exceeding 64 bits.
const digits="abcdefghijklmnopqrstuvwxyz0123456789";

function threshold(round:bigint,bias:bigint):bigint {
  const value=36n*(round+1n)-bias;
  return value<1n?1n:value>26n?26n:value;
}

function adapt(delta:bigint,first:boolean,count:number,meter?:ExecutionMeter):bigint {
  delta/=first?700n:2n;
  delta+=delta/BigInt(count);
  let divisions=0n;
  while(delta>455n){meter?.checkpoint();delta/=35n;divisions+=36n;}
  return divisions+36n*delta/(delta+38n);
}

/** Stateless Punycode encoding, including lone surrogates and ASCII controls.
 * This operates on guest code points, never host UTF-16 or an IDNA service. */
export function encodePunycode(input:CodePointString,meter?:ExecutionMeter):Uint8Array {
  meter?.checkpoint(1,64);
  const output:number[]=[],extended=new Set<number>();
  for(const point of input){
    meter?.checkpoint(1,40);
    if(point<128)output.push(point);else extended.add(point);
  }
  const basic=output.length;
  if(basic){meter?.checkpoint(0,8);output.push(45);}
  meter?.checkpoint(extended.size,extended.size*8);
  const sorted=[...extended].sort((a,b)=>{meter?.checkpoint();return a-b;});
  let previous=128,previousIndex=-1,bias=72n,encoded=0;
  for(const point of sorted){
    let below=0;
    for(const item of input){meter?.checkpoint();if(item<point)below++;}
    let delta=BigInt(below+1)*BigInt(point-previous),index=-1;
    for(const item of input){
      meter?.checkpoint();
      if(item>point)continue;
      index++;
      if(item!==point)continue;
      delta+=BigInt(index-previousIndex-1);
      let remaining=delta,round=0n;
      while(true){
        meter?.checkpoint(1,40);
        const t=threshold(round,bias);
        if(remaining<t){output.push(digits.charCodeAt(Number(remaining)));break;}
        output.push(digits.charCodeAt(Number(t+(remaining-t)%(36n-t))));
        remaining=(remaining-t)/(36n-t);round++;
      }
      bias=adapt(delta,encoded===0,basic+encoded+1,meter);
      encoded++;previousIndex=index;delta=0n;
    }
    previous=point;
  }
  // The result owns typed-array metadata even when no bytes were emitted.
  meter?.checkpoint(output.length,64+output.length);
  return Uint8Array.from(output);
}

/** Codec-level decode policy is deliberately limited by CPython itself to
 * strict/replace/ignore. Loss of synchronization returns the decoded prefix;
 * an out-of-range scalar instead inserts '?' and continues for both policies.
 * The optional ASCII service supplies interpreter-owned prefix recovery and
 * exception rewriting. Guest wrappers own source types and incremental classes. */
export function decodePunycode(input:Uint8Array,errors="strict",meter?:ExecutionMeter,decodeAscii?:(prefix:Uint8Array)=>CodePointString):CodePointString {
  meter?.checkpoint(1,64);
  if(errors!=="strict"&&errors!=="replace"&&errors!=="ignore"){
    // Policy rejection precedes prefix decoding, but still owns an exception
    // and a diagnostic containing the entire policy name.
    meter?.checkpoint(0,320+errors.length*4);
    throw new PythonRuntimeError("UnicodeError",`Unsupported error handling: ${errors}`);
  }
  let delimiter=-1;
  for(let index=0;index<input.length;index++){meter?.checkpoint();if(input[index]===45)delimiter=index;}
  const output:number[]=[];
  if(delimiter>=0&&decodeAscii!==undefined){
    let base:CodePointString,fatal=false;
    try{
      // A borrowed prefix has its own view metadata. Admit it before any
      // service side effects, including when the prefix has zero length.
      meter?.checkpoint(0,64);
      base=decodeAscii(input.subarray(0,delimiter));
    }
    catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{if(!fatal)meter?.checkpoint();}
    for(const point of base){meter?.checkpoint(1,8);output.push(point);}
  }else for(let index=0;index<delimiter;index++){
    meter?.checkpoint(1,8);
    const byte=input[index];
    if(byte<128)output.push(byte);
    else if(errors==="strict"){
      const context=new PythonDecodeError("ascii",input.subarray(0,delimiter),index,index+1,"ordinal not in range(128)",meter);
      throw new PythonDecodeError("ascii",input,index,index+1,context.reason,meter,undefined,{context,suppressContext:true});
    }
    else if(errors==="replace")output.push(0xfffd);
  }
  let point=128n,position=-1n,bias=72n,index=delimiter+1;
  const fault=(start:bigint,end:bigint,reason:string,incomplete=false):never=>{
    // The Python codec rewrites a fault in the uppercased suffix using the
    // original input and offset, while retaining the inner error from None.
    const offset=BigInt(delimiter+1),length=input.length-delimiter-1;
    if(start-offset<-(1n<<63n)||start-offset>=(1n<<63n)||end-offset<-(1n<<63n)||end-offset>=(1n<<63n)){
      meter?.checkpoint(0,320);
      throw new PythonRuntimeError("OverflowError","Python int too large to convert to C ssize_t");
    }
    meter?.checkpoint(length,64+length);
    const extended=input.slice(delimiter+1);
    for(let index=0;index<extended.length;index++){
      meter?.checkpoint();
      if(extended[index]>=97&&extended[index]<=122)extended[index]-=32;
    }
    // Incomplete input retains an IndexError independently of the two Unicode
    // faults. Admit it before constructing the chained exception graph.
    if(incomplete)meter?.checkpoint(0,256);
    const context=new PythonDecodeError("punycode",extended,start-offset,end-offset,reason,meter,undefined,
      incomplete?{context:new PythonRuntimeError("IndexError","index out of range")}:undefined);
    // Constructor failure while adding the prefix offset is raised inside the
    // inner UnicodeDecodeError handler, before `raise ... from None` executes.
    if(start<-(1n<<63n)||start>=(1n<<63n)||end<-(1n<<63n)||end>=(1n<<63n)){
      meter?.checkpoint(0,320);
      throw new PythonRuntimeError("OverflowError","Python int too large to convert to C ssize_t",{context});
    }
    // Keep exact Py_ssize_t values without changing ordinary kernel locations.
    if(start>BigInt(Number.MAX_SAFE_INTEGER)||end>BigInt(Number.MAX_SAFE_INTEGER))throw new PythonDecodeError("punycode",input,start,end,reason,meter,undefined,{context,suppressContext:true});
    throw new PythonDecodeError("punycode",input,Number(start),Number(end),reason,meter,undefined,{context,suppressContext:true});
  };
  while(index<input.length){
    const first=index===delimiter+1;
    let delta=0n,weight=1n,round=0n,integerBytes=1,complete=false;
    while(true){
      // Each digit multiplies the weight by at most 35 (< 2**6).
      // Charge a conservative byte per digit before allocating big integers.
      meter?.checkpoint(1,64+integerBytes*4);
      if(index===input.length){
        if(errors==="strict")fault(BigInt(index),BigInt(index+1),"incomplete punycode string",true);
        break;
      }
      const byte=input[index++],upper=byte>=97&&byte<=122?byte-32:byte;
      let digit:number;
      if(upper>=65&&upper<=90)digit=upper-65;
      else if(upper>=48&&upper<=57)digit=upper-22;
      else{
        if(errors==="strict")fault(BigInt(index-1),BigInt(index),`Invalid extended code point '${upper}'`);
        break;
      }
      const t=threshold(round,bias);
      delta+=BigInt(digit)*weight;
      if(BigInt(digit)<t){complete=true;break;}
      weight*=36n-t;round++;integerBytes++;
    }
    if(!complete)break;
    position+=delta+1n;
    point+=position/BigInt(output.length+1);
    if(point>0x10ffffn){
      if(errors==="strict")fault(BigInt(delimiter+1)+position-1n,BigInt(delimiter+1)+position,`Invalid character U+${point.toString(16)}`);
      point=63n;
    }
    position%=BigInt(output.length+1);
    meter?.checkpoint(output.length-Number(position)+1,8);
    output.splice(Number(position),0,Number(point));
    bias=adapt(delta,first,output.length,meter);
  }
  // Admit the string wrapper and both typed-array headers. The copying
  // constructor charges its payload; this charge owns the temporary payload.
  meter?.checkpoint(output.length,192+output.length*4);
  return new CodePointString(Uint32Array.from(output),meter);
}
