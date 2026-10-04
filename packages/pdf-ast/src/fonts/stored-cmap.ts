import { StoredNumberRangeTree as RangeTree } from "./stored-range-tree.js";
import type {PdfPixelStorage} from "../ast.js";
import type {CosToken} from "../cos/lexer.js";
import {decodeCMapDestination,parseCMapActions} from "./cmap.js";
import {PdfFontAllocation,type PdfFontAllocationOptions} from "./memory.js";


function numericRamp(base:number,offset:number):number{
  if(!offset)return base;
  // The native interpreter increments repeatedly; beyond exact integers this
  // can stop advancing, unlike adding the final offset in a single operation.
  if(Math.abs(base)>2**53){const next=base+1;return next===base?base:numericRamp(next,offset-1);}
  return Math.min(base+offset,2**53);
}
function stringRamp(base:string,offset:number):string{
  if(!offset)return base;
  if(!base.length)return "\0";
  const last=base.length-1,initial=base.charCodeAt(last);
  if(last===0){const value=(Math.min(initial,255)+offset)%256;return value?String.fromCharCode(value):"\0\0";}
  const total=Math.min(initial,255)+offset;
  return base.slice(0,last-1)+String.fromCharCode((base.charCodeAt(last-1)+Math.floor(total/256))%65536,total%256);
}

export class StoredCMap {
  readonly storedCMap=true;
  readonly mappings:RangeTree;
  readonly spaces:RangeTree[];
  constructor(readonly storage:PdfPixelStorage,readonly unicode:boolean,readonly signal?:AbortSignal){
    this.mappings=new RangeTree(storage,signal);this.spaces=Array.from({length:4},()=>new RangeTree(storage,signal));
  }
  async descriptor(value:number|string,low:number,ramp=false):Promise<number>{
    this.signal?.throwIfAborted();const string=typeof value==="string",length=string?value.length:0;
    const at=this.storage.allocate(32+length*2),header=new Uint8Array(32),view=new DataView(header.buffer);
    view.setFloat64(0,(string?2:0)+(ramp?1:0));view.setFloat64(8,low);view.setFloat64(16,string?length:value);view.setFloat64(24,0);
    await this.storage.write(at,header,this.signal?{signal:this.signal}:undefined);
    if(string)for(let offset=0;offset<length;offset+=256){this.signal?.throwIfAborted();const bytes=new Uint8Array(Math.min(256,length-offset)*2),data=new DataView(bytes.buffer);for(let i=0;i<bytes.length/2;i++)data.setUint16(i*2,value.charCodeAt(offset+i));await this.storage.write(at+32+offset*2,bytes,this.signal?{signal:this.signal}:undefined);}
    return at+1;
  }
  private async value(pointer:number,code:number):Promise<number|string>{
    const header=await this.storage.read(pointer-1,32,this.signal?{signal:this.signal}:undefined),view=new DataView(header.buffer,header.byteOffset,header.byteLength);
    const kind=view.getFloat64(0),low=view.getFloat64(8),number=view.getFloat64(16);
    if(kind<2)return kind===1?numericRamp(number,code-low):number;
    let string="";
    for(let offset=0;offset<number;offset+=256){this.signal?.throwIfAborted();const bytes=await this.storage.read(pointer-1+32+offset*2,Math.min(256,number-offset)*2,this.signal?{signal:this.signal}:undefined),data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);for(let i=0;i<bytes.length;i+=2)string+=String.fromCharCode(data.getUint16(i));}
    return kind===3?stringRamp(string,code-low):string;
  }
  async lookup(code:number):Promise<number|string|undefined>{
    this.signal?.throwIfAborted();if(!Number.isInteger(code)||code<0||code>0xffffffff)return undefined;
    const pointer=await this.mappings.lookup(code);if(!pointer)return undefined;
    const value=await this.value(pointer,code);return this.unicode?decodeCMapDestination(value):value;
  }
  async readCharCode(bytes:Uint8Array,offset:number):Promise<{charcode:number;length:number}>{
    let code=0;for(let i=0;i<4;i++){code=((code<<8)|(bytes[offset+i]??0))>>>0;if(await this.spaces[i]!.lookup(code))return {charcode:code,length:i+1};}
    return {charcode:0,length:1};
  }
  async validateUnicode():Promise<void>{
    if(!this.unicode)return;let count=0;for await(const leaf of this.mappings.leaves()){
      if(++count%256===0){await new Promise<void>(resolve=>setTimeout(resolve,0));this.signal?.throwIfAborted();}
      // Numeric ramps are monotone; endpoints validate every surviving value.
      decodeCMapDestination(await this.value(leaf.value,leaf.low));decodeCMapDestination(await this.value(leaf.value,leaf.high));
    }
  }
}

export async function parseStoredCMap(nextToken:()=>Promise<CosToken|undefined>,storage:PdfPixelStorage,
  options:PdfFontAllocationOptions&{unicode?:boolean;signal?:AbortSignal}={}):Promise<StoredCMap>{
  const {signal}=options;signal?.throwIfAborted();new PdfFontAllocation(options).admit(8192);
  const map=new StoredCMap(storage,options.unicode??false,signal),program=parseCMapActions();
  let step=program.next(),ranges=0,requests=0,arrayHead=0,arrayTail=0,arrayCount=0,arrayLow=0,arrayHigh=0;
  const admitRange=(count:number)=>{if(count<=0)return true;if(ranges+count>2**24-1)return false;ranges+=count;return true;};
  try{while(!step.done){signal?.throwIfAborted();if(++requests%256===0){await new Promise<void>(resolve=>setTimeout(resolve,0));signal?.throwIfAborted();}
    const action=step.value;
    if(action.kind==="token"){step=program.next(await nextToken());continue;}
    if(action.kind==="codespace")await map.spaces[action.length-1]!.assign(action.low,action.high,1);
    else if(action.kind==="one")await map.mappings.assign(action.low,action.low,await map.descriptor(action.value,action.low));
    else if(action.kind==="range"){if(admitRange(action.high-action.low+1))await map.mappings.assign(action.low,action.high,await map.descriptor(action.value,action.low,true));}
    else if(action.kind==="array-start"){arrayHead=0;arrayTail=0;arrayCount=0;arrayLow=action.low;arrayHigh=action.high;}
    else if(action.kind==="array-item"){
      const pointer=await map.descriptor(action.value,0),at=storage.allocate(16),bytes=new Uint8Array(16),view=new DataView(bytes.buffer);view.setFloat64(8,pointer);
      await storage.write(at,bytes,signal?{signal}:undefined);
      if(arrayTail){const link=new Uint8Array(8);new DataView(link.buffer).setFloat64(0,at+1);await storage.write(arrayTail-1,link,signal?{signal}:undefined);}else arrayHead=at+1;
      arrayTail=at+1;arrayCount++;
    }else if(admitRange(Math.min(arrayHigh-arrayLow+1,arrayCount))){
      let pointer=arrayHead,code=arrayLow;
      while(pointer&&code<=arrayHigh){signal?.throwIfAborted();const bytes=await storage.read(pointer-1,16,signal?{signal}:undefined),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);const next=view.getFloat64(0),value=view.getFloat64(8);await map.mappings.assign(code,code,value);pointer=next;code++;if(code%256===0)await new Promise<void>(resolve=>setTimeout(resolve,0));}
    }
    step=program.next();
  }
  await map.validateUnicode();signal?.throwIfAborted();return map;
  }finally{program.return();}
}
