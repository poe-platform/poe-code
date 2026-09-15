import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError,type DecodeErrorLocation} from "./decode-error.js";
import {PythonEncodeError,type EncodeErrorLocation} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";

/** These are the native multibyte codec's three fast policies. All other names
 * require the per-interpreter error registry. Its multibyte adapter must check
 * tuple/str/bytes/native-int payloads before returning these internal values;
 * unlike UTF codecs, __index__ is not a resume-position conversion protocol. */
export type MultibyteErrors="strict"|"ignore"|"replace";
export type MultibyteDecodeRecovery=(error:PythonDecodeError)=>{replacement:CodePointString;position:bigint};
export type MultibyteEncodeRecovery=(error:PythonEncodeError)=>{replacement:CodePointString|Uint8Array;position:bigint};

/** The native eight state bytes are shared with reentrant incremental calls. */
export interface MultibyteCodecState {value:bigint}
export interface MultibyteShiftCodec {
  readonly encoderInitialState?:bigint;
  readonly decoderInitialState?:bigint;
  resetDecoder?(state:MultibyteCodecState,meter:ExecutionMeter):void;
  read(input:Uint8Array,position:number,state:MultibyteCodecState,meter:ExecutionMeter):{width:number;points:readonly number[]}|{errorWidth:number}|"incomplete"|"invalid";
  write(point:number,state:MultibyteCodecState,meter:ExecutionMeter):readonly number[]|undefined;
  reset(state:MultibyteCodecState,meter:ExecutionMeter):readonly number[];
}

/** Shared native multibyte processing, optionally with a four-byte extension,
 * multi-character mappings or shift transitions over the eight native bytes.
 * Each codec supplies independent pinned decode/encode mappings and transitions.
 * Callbacks never replace active input; replacements precede position checks. */
export class DoubleByteCodec {
  constructor(
    readonly name:string,
    readonly lookupPair:(first:number,second:number,meter:ExecutionMeter)=>number|readonly number[]|undefined,
    readonly lookupCharacter:(point:number,meter:ExecutionMeter)=>number|undefined,
    readonly fourByte?:{
      readonly secondByteMin:number;
      readonly secondByteMax:number;
      readonly lookup:(first:number,second:number,third:number,fourth:number,meter:ExecutionMeter)=>number|undefined;
    },
    readonly sequences?:{
      readonly prefixes:readonly number[];
      readonly lookup:(first:number,second:number,meter:ExecutionMeter)=>number|undefined;
      readonly write?:(encoded:number,state:MultibyteCodecState,meter:ExecutionMeter)=>readonly number[];
    },
    readonly shift?:MultibyteShiftCodec
  ) {}

  readonly decode=(input:Uint8Array,errors:MultibyteErrors|MultibyteDecodeRecovery,meter:ExecutionMeter,final=true):{text:CodePointString;consumed:number} => {
    const buffer=new DoubleByteDecodeBuffer(this,input,meter);
    buffer.feed({errors},final);
    return {text:buffer.finish(),consumed:buffer.position};
  };

  readonly encode=(input:CodePointString,errors:MultibyteErrors|MultibyteEncodeRecovery,meter:ExecutionMeter,state:MultibyteCodecState={value:this.shift?.encoderInitialState??0n},reset=true):Uint8Array => {
    const buffer=new DoubleByteEncodeBuffer(this,input,meter,state);
    buffer.feed(errors,true,reset);
    return buffer.finish();
  };
}

/** Tracks unconsumed sequence prefixes without truncating error objects or
 * joining separately encoded chunks across a recovery boundary. */
export class DoubleByteEncodeBuffer {
  readonly #bytes:number[]=[];
  #initial:EncodeErrorLocation|undefined;
  position=0;

  constructor(readonly codec:DoubleByteCodec,readonly input:CodePointString,readonly meter:ExecutionMeter,readonly state:MultibyteCodecState={value:codec.shift?.encoderInitialState??0n}) {meter.checkpoint(1,64);}

  feed(errors:MultibyteErrors|MultibyteEncodeRecovery,final:boolean,reset=final):void {
    const {input,meter,codec}=this;
    let fatal=false;
    try{
      meter.checkpoint(1,32);
      const output=this.#bytes;
      for(;this.position<input.length;){
        const point=input.codePointAt(BigInt(this.position),meter);
        let width=1,encoded:number|undefined;
        // Sequence prefixes must be held before any singleton/shift encoder
        // consumes them. A failed pair lookup falls back to the singleton.
        if(codec.sequences?.prefixes.includes(point)){
          if(this.position+1===input.length&&!final)break;
          if(this.position+1<input.length){
            encoded=codec.sequences.lookup(point,input.codePointAt(BigInt(this.position+1),meter),meter);
            if(encoded!==undefined)width=2;
          }
        }
        if(encoded===undefined&&codec.shift!==undefined){
          const encoded=codec.shift.write(point,this.state,meter);
          if(encoded!==undefined){
            for(const byte of encoded){meter.checkpoint(1,8);output.push(byte);}
            this.position++;continue;
          }
        }
        if(codec.shift===undefined)encoded??=codec.lookupCharacter(point,meter);
        if(encoded!==undefined){
          if(codec.sequences?.write!==undefined){
            for(const byte of codec.sequences.write(encoded,this.state,meter)){meter.checkpoint(1,8);output.push(byte);}
            this.position+=width;continue;
          }
          meter.checkpoint(0,encoded<128?8:encoded<=0xffff?16:32);
          if(encoded>0xffff)output.push(Math.floor(encoded/0x1000000),Math.floor(encoded/0x10000)&255);
          if(encoded>=128)output.push(Math.floor(encoded/256)&255);
          output.push(encoded&255);
        }else if(errors==="replace"){
          const replacement=codec.shift?.write(63,this.state,meter)??[63];
          for(const byte of replacement){meter.checkpoint(1,8);output.push(byte);}
        }
        else if(errors!=="ignore"){
          // Each fault retains its own record and bounded diagnostic, including
          // faults from strict replacement encoding. Admit before recovery.
          meter.checkpoint(0,512+2*codec.name.length);
          const error=new PythonEncodeError(codec.name,input,this.position,this.position+1,"illegal multibyte sequence",this.#initial);
          if(errors==="strict")throw error;
          // Native multibyte operations cache their first exception arguments.
          // Reentrant encodes and replacement encodes own separate buffers.
          if(this.#initial===undefined){
            meter.checkpoint(0,40);
            this.#initial={start:error.start,end:error.end,reason:error.reason};
          }
          const result=errors(error);
          meter.checkpoint();
          const replacement=result.replacement instanceof Uint8Array?result.replacement:codec.encode(result.replacement,"strict",meter,this.state,false);
          for(const byte of replacement){meter.checkpoint(1,8);output.push(byte);}
          this.position=multibyteResumePosition(result.position,input.length,meter);
          continue;
        }
        this.position+=width;
      }
      if(reset&&codec.shift!==undefined){
        for(const byte of codec.shift.reset(this.state,meter)){meter.checkpoint(1,8);output.push(byte);}
      }

    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{if(!fatal)meter.checkpoint();}
  }

  finish():Uint8Array {
    // An empty result still owns a typed-array object. Finishing may be
    // repeated, so admit each result independently before it can escape.
    this.meter.checkpoint(this.#bytes.length+1,64+this.#bytes.length);
    return Uint8Array.from(this.#bytes);
  }
}

/** Shared operation buffer. Incremental decoding feeds without flushing, then
 * recovers an incomplete tail exactly once; one-shot decoding keeps feeding
 * after any callback resume. Keeping those steps separate preserves CPython's
 * distinct pending-buffer transitions on feed failures and flush failures. */
export class DoubleByteDecodeBuffer {
  readonly #points:number[]=[];
  #initial:DecodeErrorLocation|undefined;
  position=0;

  constructor(readonly codec:DoubleByteCodec,readonly input:Uint8Array,readonly meter:ExecutionMeter,readonly state:MultibyteCodecState={value:codec.shift?.decoderInitialState??0n}){meter.checkpoint(1,64);}

  feed(policy:{readonly errors:MultibyteErrors|MultibyteDecodeRecovery},final:boolean):void {
    const {input,meter}=this;
    while(this.position<input.length){
      meter.checkpoint();
      if(this.codec.shift!==undefined){
        const result=this.codec.shift.read(input,this.position,this.state,meter);
        if(result==="incomplete"&&!final)break;
        if(typeof result==="string")this.recover(policy.errors,result==="incomplete");
        else if("errorWidth" in result)this.recover(policy.errors,false,result.errorWidth);
        else{
          for(const point of result.points){meter.checkpoint(1,8);this.#points.push(point);}
          this.position+=result.width;
        }
        continue;
      }
      const byte=input[this.position];
      if(byte<128){meter.checkpoint(0,8);this.#points.push(byte);this.position++;continue;}
      const second=input[this.position+1],extension=this.codec.fourByte;
      const quad=extension!==undefined&&second>=extension.secondByteMin&&second<=extension.secondByteMax;
      const width=quad?4:2,incomplete=this.position+width>input.length;
      if(incomplete&&!final)break;
      const point=incomplete?undefined:quad?extension.lookup(byte,second,input[this.position+2],input[this.position+3],meter):this.codec.lookupPair(byte,second,meter);
      if(point!==undefined){
        if(typeof point==="number"){meter.checkpoint(0,8);this.#points.push(point);}
        else for(const item of point){meter.checkpoint(1,8);this.#points.push(item);}
        this.position+=width;continue;
      }
      this.recover(policy.errors,incomplete);
    }
  }

  recover(errors:MultibyteErrors|MultibyteDecodeRecovery,incomplete:boolean,errorWidth=1):void {
    const {input,meter}=this;
    let fatal=false;
    try{
      meter.checkpoint();
      if(errors==="replace"){meter.checkpoint(0,8);this.#points.push(0xfffd);}
      else if(errors!=="ignore"){
        const error=new PythonDecodeError(this.codec.name,input,this.position,incomplete?input.length:this.position+errorWidth,incomplete?"incomplete multibyte sequence":"illegal multibyte sequence",meter,this.#initial);
        if(errors==="strict")throw error;
        // A live incremental errors policy can switch to strict after recovery.
        // The final native fault must retain the first exception's args while
        // exposing its current span/reason. Cache per operation buffer so nested
        // calls and later chunks cannot replace that initial location.
        if(this.#initial===undefined){
          meter.checkpoint(0,48);
          this.#initial={start:error.start,end:error.end,reason:error.reason};
        }
        const result=errors(error);
        meter.checkpoint();
        for(const replacement of result.replacement){meter.checkpoint(1,8);this.#points.push(replacement);}
        this.position=multibyteResumePosition(result.position,input.length,meter);
        return;
      }
      this.position=incomplete?input.length:this.position+errorWidth;
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{if(!fatal)meter.checkpoint();}
  }

  finish():CodePointString {
    // Account for the result object and temporary typed-array header as well
    // as its payload. CodePointString separately charges its owned point copy.
    this.meter.checkpoint(this.#points.length+1,96+this.#points.length*4);
    return new CodePointString(Uint32Array.from(this.#points),this.meter);
  }
}

function multibyteResumePosition(position:bigint,length:number,meter:ExecutionMeter):number {
  // Pinned reference platform uses signed 64-bit Py_ssize_t. On overflow the
  // native multibyte handler reports the conversion sentinel (-1) unchanged.
  if(position<-(1n<<63n)||position>=(1n<<63n))position=-1n;
  else if(position<0n)position+=BigInt(length);
  if(position<0n||position>BigInt(length)){
    // Recovery and replacement encoding can exhaust the remaining allowance.
    // Admit the exception before formatting the bounded signed-size position.
    meter.checkpoint(0,256);
    throw new PythonRuntimeError("IndexError",`position ${position} from error handler out of bounds`);
  }
  return Number(position);
}
