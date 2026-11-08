/** Build-time preparation for the pinned native SQLite artifact. The Worker
 * imports these outputs as compiled modules; it never compiles Wasm at runtime. */
export function reserveSqliteCallbackSlots(binary:Uint8Array,slots:number):Uint8Array<ArrayBuffer>{
 if(!Number.isSafeInteger(slots)||slots<1||slots>0xffffffff)throw new RangeError('Invalid SQLite callback capacity');
 const header=[0,97,115,109,1,0,0,0];
 if(!(binary instanceof Uint8Array)||binary.length<8||header.some((value,index)=>binary[index]!==value))throw new TypeError('Invalid native SQLite Wasm header');
 let cursor=8,tableStart=-1,tableEnd=-1,replacement:Uint8Array|undefined;
 const uint=(end:number):number=>{
  let value=0;
  for(let index=0;index<5;index++){
   if(cursor>=end)throw new RangeError('Truncated Wasm integer');
   const byte=binary[cursor++]!;value+=(byte&127)*2**(index*7);
   if(value>0xffffffff)throw new RangeError('Wasm integer overflow');
   if(byte<128)return value;
  }
  throw new RangeError('Invalid Wasm integer');
 };
 while(cursor<binary.length){
  const start=cursor,id=binary[cursor++]!,size=uint(binary.length);
  if(size>binary.length-cursor)throw new RangeError('Truncated Wasm section');
  const end=cursor+size;
  if(id===4){
   if(tableStart!==-1)throw new TypeError('Duplicate native SQLite table');
   const count=uint(end),type=binary[cursor++],flags=uint(end),minimum=uint(end),maximum=uint(end);
   if(count!==1||type!==112||flags!==1||minimum!==maximum||cursor!==end)throw new TypeError('Expected one fixed native SQLite function table');
   if(maximum+slots>0xffffffff)throw new RangeError('SQLite callback capacity overflow');
   const body=[1,112,1,...leb(minimum),...leb(maximum+slots)];
   replacement=Uint8Array.from([4,...leb(body.length),...body]);tableStart=start;tableEnd=end;
  }
  cursor=end;
 }
 if(!replacement)throw new TypeError('Missing native SQLite function table');
 const result=new Uint8Array(binary.length-(tableEnd-tableStart)+replacement.length);
 result.set(binary.subarray(0,tableStart));result.set(replacement,tableStart);result.set(binary.subarray(tableEnd),tableStart+replacement.length);return result;
}
function leb(value:number):number[]{
 const bytes:number[]=[];
 do{const byte=value%128;value=Math.floor(value/128);bytes.push(byte|(value?128:0));}while(value);
 return bytes;
}
/** Import/re-export wrapper for the native unicode61 six-i32 callback. */
export function sqliteUnicodeCallback():Uint8Array<ArrayBuffer>{
 return Uint8Array.of(0,97,115,109,1,0,0,0,1,11,1,96,6,127,127,127,127,127,127,1,127,2,7,1,1,101,1,102,0,0,7,5,1,1,102,0,0);
}
