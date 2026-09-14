import {createStandardCodecErrors,standardCodecErrorDocumentation} from "./runtime-codec-errors.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {displayRuntimeEncodingName,normalizeRuntimeEncodingName} from "./runtime-encoding-name.js";
import {RuntimeRaisedException} from "./runtime-exception-execution.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import {runtimeTuplePayload} from "./runtime-tuple-payload.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {runtimeIntegerIndex} from "./runtime-integer-index.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";
import type {BuiltinInvocationContext,RuntimeValue,RuntimeValues} from "./runtime-values.js";
import {encodeUtf8} from "./utf8-encode.js";
import {throwRuntimeCodecFailure} from "./runtime-codec-failure.js";
import {decodeRuntimeCoreText,encodeRuntimeCoreText} from "./runtime-core-text-codec.js";
import {ImmutableBytes} from "./immutable-bytes.js";
import {CodePointString} from "./code-point-string.js";

/** Interpreter-owned search path, successful lookup cache, and error callbacks.
 * Calls reenter the owning interpreter through its ordinary invocation context.
 * Codec modules populate the search path; this object never imports host codecs.
 */
export class RuntimeCodecRegistry {
  readonly #search:RuntimeValue[]=[];
  readonly #cache=new Map<string,RuntimeValue>();
  readonly #errors:Map<string,RuntimeValue>;
  readonly #wideErrors=new Map<number,Map<string,RuntimeValue>>();
  readonly #unicodeUtf8=new WeakMap<RuntimeValue,ImmutableBytes>();
  #initialization:"pending"|"running"|"ready"="pending";

  constructor(readonly values:RuntimeValues,readonly meter:ExecutionMeter,private readonly initialize?:()=>void) {
    this.#errors=createStandardCodecErrors(values,meter);
  }

  /** PyUnicode_AsUTF8AndSize retains conversion bytes on the string identity,
   * including bytes supplied by a replaced strict handler. Registry search
   * invalidation does not invalidate that Unicode object's successful cache. */
  unicodeUtf8(source:RuntimeValue,context:BuiltinInvocationContext):ImmutableBytes {
    this.meter.checkpoint();
    const cached=this.#unicodeUtf8.get(source);
    if(cached!==undefined)return cached;
    const encoded=encodeRuntimeCoreText("utf_8",source,"strict",this,context);
    // Recovery can cancel or consume storage. Publish only after admitting
    // the immutable byte snapshot and weak cache entry; failures stay retryable.
    this.meter.checkpoint(0,128);
    const bytes=ImmutableBytes.copyOf(encoded,this.meter);
    this.#unicodeUtf8.set(source,bytes);
    return bytes;
  }

  cachedUnicodeUtf8(source:RuntimeValue):ImmutableBytes|undefined {
    this.meter.checkpoint();
    return this.#unicodeUtf8.get(source);
  }

  /** Native policy comparisons inspect ASCII bytes; arbitrary bytes remain
   * opaque until the consuming C API needs a Unicode name. */
  unicodeErrorPolicy(source:RuntimeValue,context:BuiltinInvocationContext):string|ImmutableBytes {
    this.meter.checkpoint();
    const text=runtimeStringPayload(source)!;
    let ordinary="",isAscii=true;
    for(const point of text.value){
      this.meter.checkpoint(1,4);
      if(point>127){isAscii=false;break;}
      ordinary+=String.fromCharCode(point);
    }
    // Compact ASCII already carries its UTF-8 storage in CPython. It cannot
    // invoke recovery, so no additional immutable snapshot is needed.
    if(isAscii){
      if(ordinary.includes("\0")){this.meter.checkpoint(0,240);throw new PythonRuntimeError("ValueError","embedded null character");}
      return ordinary;
    }
    const bytes=this.unicodeUtf8(source,context);
    let ascii="",nonAscii=false;
    for(const byte of bytes){
      this.meter.checkpoint(1,4);
      if(byte===0){this.meter.checkpoint(0,240);throw new PythonRuntimeError("ValueError","embedded null character");}
      if(byte>127)nonAscii=true;
      ascii+=String.fromCharCode(byte);
    }
    return nonAscii?bytes:ascii;
  }

  /** Validate the UTF-8 C-string boundary without allocating discarded encoded
   * storage. Surrogate faults still use the kernel's exact source/range error;
   * UTF-8 conversion precedes the embedded-NUL check. */
  #validateName(name:string):void {
    for(const character of name){
      const point=character.codePointAt(0)!;this.meter.checkpoint();
      if(point>=0xd800&&point<=0xdfff)encodeUtf8(this.values.string(name).value,"strict",this.meter);
    }
    if(name.includes("\0")){
      // Name scanning allocates no encoded buffer. A rejected name still
      // needs exception storage before a catchable ValueError can escape.
      this.meter.checkpoint(0,192);
      throw new PythonRuntimeError("ValueError","embedded null character");
    }
  }

  /** The session supplies guest library execution, never a host codec loader.
   * Registration during encodings initialization must not recursively import
   * it. A failed import remains retryable; a completed import is never repeated
   * after a guest unregisters the standard search function. */
  #ensureInitialized():void {
    this.meter.checkpoint();
    if(this.#initialization!=="pending")return;
    this.#initialization="running";
    try {
      this.initialize?.();
      // Loading the guest library can call explicit services. Observe their
      // cancellation before publishing readiness or allowing registry mutation.
      this.meter.checkpoint();
      this.#initialization="ready";
    } catch(error){
      this.#initialization="pending";
      if(!(error instanceof ExecutionLimitError))this.meter.checkpoint();
      throw error;
    }
  }

  get hasSearchFunctions():boolean {
    this.#ensureInitialized();
    this.meter.checkpoint();
    return this.#search.length!==0;
  }

  register(search:RuntimeValue,context:BuiltinInvocationContext):void {
    let fatal=false;
    try {
      this.meter.checkpoint(1,16);
      const callable=context.isCallable?.(search);
      this.meter.checkpoint();
      if(!callable){
        this.meter.checkpoint(0,192);
        throw new PythonRuntimeError("TypeError","argument must be callable");
      }
      this.#ensureInitialized();
      this.#search.push(search);
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally {if(!fatal)this.meter.checkpoint();}
  }

  unregister(search:RuntimeValue):void {
    this.#ensureInitialized();
    this.meter.checkpoint();
    for(let index=0;index<this.#search.length;index++){
      this.meter.checkpoint();
      if(this.#search[index]!==search)continue;
      this.meter.checkpoint(this.#search.length-index+this.#cache.size);
      this.#search.splice(index,1);
      this.#cache.clear();
      return;
    }
  }

  lookup(input:string|ImmutableBytes,context:BuiltinInvocationContext):RuntimeValue {
    let fatal=false;
    try {
      this.meter.checkpoint();
      // Native lookup receives a C byte string. Keep every recovered byte for
      // normalization; invalid UTF-8 is legal here and only rendered on a miss.
      let encoding="";
      if(typeof input==="string")encoding=input;
      else for(const byte of input){
        this.meter.checkpoint(1,4);
        encoding+=String.fromCharCode(byte);
      }
      // Cache keys are validated canonical ASCII names. An exact key can avoid
      // rebuilding UTF-8 and normalized storage. Initialization can reenter and
      // invalidate the cache, so read the value again after that boundary.
      if(this.#cache.has(encoding)){
        this.#ensureInitialized();
        const current=this.#cache.get(encoding);
        if(current!==undefined)return current;
      }
      this.#validateName(encoding);
      this.#ensureInitialized();
      const name=normalizeRuntimeEncodingName(encoding,this.meter),cached=this.#cache.get(name);
      if(cached!==undefined)return cached;
      const length=this.#search.length;
      if(length===0){
        this.meter.checkpoint(0,192);
        throw new PythonRuntimeError("LookupError","no codec search functions registered: can't find encoding");
      }
      // Search arguments are interned independently of successful codec hits.
      // A callback may retain a name after a miss or exception; unregistering
      // a search function invalidates codecs, not those string identities.
      const argument=this.values.internString(name);
      for(let index=0;index<length;index++){
        this.meter.checkpoint();
        const search=this.#search[index];
        if(search===undefined){
          // Initialization and earlier search callbacks may exhaust storage or
          // shrink the live path. Admit the exception after those boundaries.
          this.meter.checkpoint(0,192);
          throw new PythonRuntimeError("IndexError","list index out of range");
        }
        let result:RuntimeValue;
        try {result=context.call(search,[argument]);}
        catch(error){if(error instanceof ExecutionLimitError)fatal=true;throw error;}
        finally {if(!fatal)this.meter.checkpoint();}
        if(result.kind==="none")continue;
        if(runtimeTuplePayload(result)?.items.length!==4){
          this.meter.checkpoint(0,192);
          throw new PythonRuntimeError("TypeError","codec search functions must return 4-tuples");
        }
        this.meter.checkpoint(1,64+name.length*2);
        this.#cache.set(name,result);
        return result;
      }
      // Search callbacks may spend the remaining allocation allowance. Admit
      // the exception and its full original spelling after those callbacks,
      // before constructing a diagnostic that can escape to the caller.
      this.meter.checkpoint(0,192+2*encoding.length);
      if(typeof input!=="string")encoding=displayRuntimeEncodingName(input,this.meter);
      throw new PythonRuntimeError("LookupError",`unknown encoding: ${encoding}`);
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally {if(!fatal)this.meter.checkpoint();}
  }

  /** Text conversion rejects explicitly nontext CodecInfo values. Exact tuples
   * and tuple subtypes without the optional flag retain legacy text semantics. */
  lookupText(encoding:string|ImmutableBytes,alternateCommand:string|undefined,context:BuiltinInvocationContext):RuntimeValue {
    let fatal=false;
    try {
      const codec=this.lookup(encoding,context);
      if(codec.kind==="tuple")return codec;
      if(context.attribute===undefined)throw new Error("text codecs require the interpreter attribute protocol");
      let flag:RuntimeValue;
      try {flag=context.attribute(codec,"_is_text_encoding");}
      catch(error){
        if(error instanceof ExecutionLimitError)throw error;
        this.meter.checkpoint();
        if(runtimeExceptionMatches(error,"AttributeError",context))return codec;
        throw error;
      }
      this.meter.checkpoint();
      if(context.truth===undefined)throw new Error("text codecs require the interpreter truth protocol");
      const text=context.truth(flag);
      this.meter.checkpoint();
      if(!text){
        const name=displayRuntimeEncodingName(encoding,this.meter,400);
        this.meter.checkpoint(1,256+name.length*2+(alternateCommand?.length??0)*2);
        throw new PythonRuntimeError("LookupError",`'${name}' is not a text encoding${alternateCommand===undefined?"":`; use ${alternateCommand} to handle arbitrary codecs`}`);
      }
      return codec;
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally {if(!fatal)this.meter.checkpoint();}
  }

  /** General codecs.encode/decode dispatch. The second tuple entry is deliberately
   * neither inspected nor converted; text consumers validate the first entry. */
  transform(operation:"encode"|"decode",source:RuntimeValue,encoding:string|ImmutableBytes,errors:string|ImmutableBytes|undefined,context:BuiltinInvocationContext,text=false):RuntimeValue {
    let fatal=false;
    try {
      // Public codec arguments cross the C-string boundary before searching.
      for(const name of errors===undefined?[encoding]:[encoding,errors]){
        if(typeof name==="string")this.#validateName(name);
      }
      const codec=text?this.lookupText(encoding,`codecs.${operation}()`,context):this.lookup(encoding,context);
      const callback=runtimeTuplePayload(codec)!.items[operation==="encode"?0:1];
      this.meter.checkpoint(1,64);
      const args=errors===undefined?[source]:[source,this.values.stringPoints(this.errorName(errors,context),"canonical")];
      let result:RuntimeValue;
      try {result=context.call(callback,args);}
      catch(error){
        if(error instanceof ExecutionLimitError)throw error;
        throwRuntimeCodecFailure(error,operation,displayRuntimeEncodingName(encoding,this.meter),this.meter,context);
      }
      this.meter.checkpoint();
      const tuple=runtimeTuplePayload(result);
      if(tuple?.items.length!==2){
        // A codec can spend the remaining allowance before returning. Admit
        // the result diagnostic after that callback, before creating the error.
        this.meter.checkpoint(0,192);
        throw new PythonRuntimeError("TypeError",operation==="encode"?"encoder must return a tuple (object, integer)":"decoder must return a tuple (object,integer)");
      }
      return tuple.items[0];
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally {if(!fatal)this.meter.checkpoint();}
  }

  /** Resolve factories on the cached info object each time, including descriptors.
   * Factory objects and their state belong to the interpreter that calls them. */
  incremental(attribute:"incrementalencoder"|"incrementaldecoder",encoding:string,errors:string|undefined,context:BuiltinInvocationContext):RuntimeValue {
    let fatal=false;
    try {
      const codec=this.lookup(encoding,context);
      if(context.attribute===undefined)throw new Error("incremental codecs require the interpreter attribute protocol");
      const factory=context.attribute(codec,attribute);
      this.meter.checkpoint(1,48);
      return context.call(factory,errors===undefined?[]:[this.values.string(errors)]);
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally {if(!fatal)this.meter.checkpoint();}
  }

  /** Instantiate a codec stream adapter; ownership and I/O stay with the supplied
   * guest stream, never an ambient host file or process stream. */
  stream(direction:"reader"|"writer",source:RuntimeValue,encoding:string,errors:string|undefined,context:BuiltinInvocationContext):RuntimeValue {
    let fatal=false;
    try {
      const codec=this.lookup(encoding,context),factory=runtimeTuplePayload(codec)!.items[direction==="reader"?2:3];
      this.meter.checkpoint(1,64);
      return context.call(factory,errors===undefined?[source]:[source,this.values.string(errors)]);
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally {if(!fatal)this.meter.checkpoint();}
  }

  /** C API error names become Unicode dictionary keys only when consumed.
   * Decode with the owning interpreter's strict recovery, never a host codec.
   * Recovered Unicode can itself contain surrogates and is not re-encoded. */
  errorName(input:string|ImmutableBytes,context?:BuiltinInvocationContext):CodePointString {
    if(typeof input==="string"){this.#validateName(input);return CodePointString.fromString(input,this.meter);}
    return decodeRuntimeCoreText("utf_8",input.toUint8Array(this.meter),"strict",true,this,context,true).text;
  }

  /** Native Unicode dict equality includes storage kind. Wide keys serialize
   * code points independently, preserving surrogate pairs versus astral text. */
  #errorEntry(input:string|ImmutableBytes,context:BuiltinInvocationContext|undefined,create=false):{table:Map<string,RuntimeValue>|undefined;key:string} {
    if(typeof input==="string"){
      this.#validateName(input);
      let ascii=true;
      for(const character of input){this.meter.checkpoint();if(character.codePointAt(0)!>127){ascii=false;break;}}
      if(ascii){this.meter.checkpoint(0,48);return {table:this.#errors,key:input};}
    }
    const name=this.errorName(input,context),width=name.compactWidth(this.meter);
    let table=width===1?this.#errors:this.#wideErrors.get(width),key="";
    for(const point of name){
      this.meter.checkpoint(1,32);
      key+=width===1?String.fromCodePoint(point):`${point},`;
    }
    if(table===undefined&&create){
      this.meter.checkpoint(0,96);
      table=new Map();this.#wideErrors.set(width,table);
    }
    this.meter.checkpoint(0,48);
    return {table,key};
  }

  registerError(input:string|ImmutableBytes,handler:RuntimeValue,context:BuiltinInvocationContext):void {
    let fatal=false;
    try {
      if(typeof input==="string")this.#validateName(input);
      this.meter.checkpoint(1,64+input.length*2);
      const callable=context.isCallable?.(handler);
      this.meter.checkpoint();
      if(!callable){
        this.meter.checkpoint(0,192);
        throw new PythonRuntimeError("TypeError","handler must be callable");
      }
      // codecs publishes aliases of the original handlers during initialization.
      // Complete that initialization before guest registration can replace them,
      // just as search-path mutations first initialize the encodings package.
      this.#ensureInitialized();
      const {table,key}=this.#errorEntry(input,context,true);
      table!.set(key,handler);
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally {if(!fatal)this.meter.checkpoint();}
  }

  unregisterError(input:string|ImmutableBytes,context?:BuiltinInvocationContext):boolean {
    this.meter.checkpoint(1,96+input.length*2);
    // The protected-name strcmp occurs before PyDict_PopString decodes a key.
    // Recovery may turn an unprotected byte spelling into a built-in key.
    let raw="";
    if(typeof input==="string")raw=input;
    else for(const byte of input){this.meter.checkpoint(1,4);raw+=String.fromCharCode(byte);}
    if(Object.hasOwn(standardCodecErrorDocumentation,raw)){
      // Rejection owns an exception and formatted message in addition to the
      // removal lookup. Admit those before a catchable error can escape.
      this.meter.checkpoint(0,192+raw.length*2);
      throw new PythonRuntimeError("ValueError",`cannot un-register built-in error handler '${raw}'`);
    }
    const {table,key}=this.#errorEntry(input,context);
    return table?.delete(key)??false;
  }

  lookupError(input:string|ImmutableBytes,context?:BuiltinInvocationContext):RuntimeValue {
    const {table,key}=this.#errorEntry(input,context);
    this.meter.checkpoint(1,32+key.length*2);
    const handler=table?.get(key);
    if(handler===undefined){
      const diagnostic=displayRuntimeEncodingName(input,this.meter,400);
      // Successful lookups retain a handler; misses additionally allocate an
      // exception and its formatted message, even for the empty name.
      this.meter.checkpoint(0,192+2*diagnostic.length);
      throw new PythonRuntimeError("LookupError",`unknown error handler name '${diagnostic}'`);
    }
    return handler;
  }

  /** Validate a guest error callback result without coercing the replacement.
   * Length is in source code points for encoding and source bytes for decoding.
   */
  handleError(handler:string|RuntimeValue,error:RuntimeValue,operation:"encode"|"decode",length:number,context:BuiltinInvocationContext):{replacement:RuntimeValue;position:number;object?:RuntimeValue} {
    let fatal=false;
    try {
      // Retained callbacks bypass lookupError, including its entry checkpoint.
      // Observe termination before invoking either form of error handler.
      this.meter.checkpoint();
      const result=context.call(typeof handler==="string"?this.lookupError(handler):handler,[error]);
      this.meter.checkpoint();
      const tuple=runtimeTuplePayload(result),replacement=tuple?.items[0];
      const native=replacement?.kind==="instance"?replacement.native:replacement;
      if(tuple?.items.length!==2||replacement===undefined||
        (operation==="decode"&&runtimeStringPayload(replacement)===undefined)){
        this.meter.checkpoint(0,192);
        throw new PythonRuntimeError("TypeError",operation==="encode"?"encoding error handler must return (str/bytes, int) tuple":"decoding error handler must return (str, int) tuple");
      }
      let position=runtimeIntegerIndex(tuple.items[1],this.meter,context.integerIndex);
      if(position<-(1n<<63n)||position>=(1n<<63n)){
        this.meter.checkpoint(0,192);
        throw new PythonRuntimeError("OverflowError","Python int too large to convert to C ssize_t");
      }
      // Encoding parses (object, Py_ssize_t) before checking the replacement;
      // decoding parses (str, Py_ssize_t). Preserve __index__ effects and its
      // exception precedence even when an encoder returned an invalid object.
      if(operation==="encode"&&runtimeStringPayload(replacement)===undefined&&native?.kind!=="bytes"){
        this.meter.checkpoint(0,192);
        throw new PythonRuntimeError("TypeError","encoding error handler must return (str/bytes, int) tuple");
      }
      // Decode callbacks can replace the input, even from __index__. Encoding
      // keeps the caller's original input length. Read native exception storage
      // after tuple/index validation, as the Unicode decoder's C API does.
      let object:RuntimeValue|undefined;
      const state=operation==="decode"&&error.kind==="instance"&&context.isException?.(new RuntimeRaisedException(error,this.meter),"UnicodeDecodeError")?runtimeExceptionPayload(error):undefined;
      if(state!==undefined){
        object=state.member("object",this.meter);
        if(object===undefined){
          this.meter.checkpoint(0,192);
          throw new PythonRuntimeError("TypeError","UnicodeError 'object' attribute is not set");
        }
        const payload=object.kind==="instance"?object.native:object;
        if(payload?.kind!=="bytes"){
          this.meter.checkpoint(0,192);
          throw new PythonRuntimeError("TypeError","UnicodeError 'object' attribute must be a bytes");
        }
        length=payload.value.length;
      }
      if(position<0n)position+=BigInt(length);
      if(position<0n||position>BigInt(length)){
        // The callback (including __index__) may consume the remaining budget.
        // Admit the diagnostic before allocating its signed-size position text.
        this.meter.checkpoint(0,256);
        throw new PythonRuntimeError("IndexError",`position ${position} from error handler out of bounds`);
      }
      // A callback can reuse its tuple indefinitely, but every recovery creates
      // a fresh record. Charge that storage after guest validation, before it
      // can escape to the kernel or be retained by the caller.
      this.meter.checkpoint(0,48);
      return object===undefined?{replacement,position:Number(position)}:{replacement,position:Number(position),object};
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally {if(!fatal)this.meter.checkpoint();}
  }
}
