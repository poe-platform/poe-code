/** Serialize JSON data without retaining a complete encoded control payload. */
export function jsonValue(value: unknown, signal: AbortSignal): AsyncIterable<Uint8Array> {
 const ancestors=new Set<object>();
 const normalize=(input:unknown,key:string):unknown=>{
  if(input&&(typeof input==='object'||typeof input==='function')){
   const hook=(input as {toJSON?:unknown}).toJSON;
   if(typeof hook==='function')input=hook.call(input,key);
   if(input instanceof Number||input instanceof String||input instanceof Boolean)return input.valueOf();
   if(input&&typeof input==='object'&&Object.getPrototypeOf(input)===BigInt.prototype)return BigInt.prototype.valueOf.call(input);
  }
  return input;
 };
 function validate(input:unknown,key=""):void {
  input=normalize(input,key);
  signal.throwIfAborted();
  if(typeof input==='bigint')throw new TypeError('Do not know how to serialize a BigInt');
  if(!input||typeof input!=='object')return;
  if(ancestors.has(input))throw new TypeError('Converting circular structure to JSON');
  ancestors.add(input);
  try {
   if(Array.isArray(input)){for(let i=0;i<input.length;i++)validate(input[i],String(i));}
   else for(const key in input)if(Object.hasOwn(input,key))validate((input as Record<string,unknown>)[key],key);
  }finally{ancestors.delete(input);}
 }
 validate(value);
 const encoder=new TextEncoder();
 const ignored=(input:unknown)=>input===undefined||typeof input==='function'||typeof input==='symbol';
 async function* string(input:string):AsyncIterable<Uint8Array>{
  yield encoder.encode('"');
  for(let offset=0;offset<input.length;){
   signal.throwIfAborted();
   let end=Math.min(offset+1024,input.length);
   const last=input.charCodeAt(end-1);
   if(end<input.length&&last>=0xd800&&last<=0xdbff&&input.charCodeAt(end)>=0xdc00&&input.charCodeAt(end)<=0xdfff)end--;
   yield encoder.encode(JSON.stringify(input.slice(offset,end)).slice(1,-1));offset=end;
  }
  yield encoder.encode('"');
 }
 async function* encode(input:unknown):AsyncIterable<Uint8Array>{
  signal.throwIfAborted();
  if(typeof input==='string'){yield* string(input);return;}
  if(!input||typeof input!=='object'){yield encoder.encode(JSON.stringify(input)??'null');return;}
  if(Array.isArray(input)){
   yield encoder.encode('[');
   for(let i=0;i<input.length;i++){if(i)yield encoder.encode(',');yield* encode(normalize(input[i],String(i)));}
   yield encoder.encode(']');return;
  }
  yield encoder.encode('{');let first=true;
  for(const key in input)if(Object.hasOwn(input,key)){
   const item=normalize((input as Record<string,unknown>)[key],key);if(ignored(item))continue;
   if(!first)yield encoder.encode(',');first=false;
   yield* string(key);yield encoder.encode(':');yield* encode(item);
  }
  yield encoder.encode('}');
 }
 return encode(normalize(value,""));
}
