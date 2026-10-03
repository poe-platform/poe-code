import {PythonTextDecodeError} from './python-codepages.js';

import {multibytePool,multibytePoolLengths,cp949Hangul} from './python-multibyte-tables.js';
export interface PythonMultibyteTable {
 readonly nativeEncoding:string;
 readonly native:string;
 readonly ranges:string;
 readonly prefixes:string;
 readonly hangul?:boolean;
 readonly hangulRanges?:string;
 readonly johab?:boolean;
}
type Range=readonly [number,number,number];
interface ExpandedTable {prefixes:ReadonlySet<number>;native:Range[];ranges:Range[];hangul:Range[];}
const expandedTables=new WeakMap<PythonMultibyteTable,ExpandedTable>();
// Signed varints encode start deltas, flagged lengths, and distinct target deltas.
// These are fixed codec metadata, never buffers derived from caller payloads.
function unpack(encoded:string):Range[]{
 const bytes=Uint8Array.from(atob(encoded),char=>char.charCodeAt(0)),values:number[]=[];
 let value=0,factor=1;
 for(const byte of bytes){value+=(byte&127)*factor;if(byte&128){factor*=128;continue;}values.push(value&1?-(value+1)/2:value/2);value=0;factor=1;}
 const ranges:Range[]=[];let key=0,target=0;
 for(let i=0;i<values.length;){const delta=values[i++]!,length=values[i++]!;key+=delta;target+=length&1?values[i++]!:delta;ranges.push([key,key+(length>>>1),target]);}
 return ranges;
}
function lookup(ranges:readonly Range[],key:number):number|undefined{
 let lower=0,upper=ranges.length;
 while(lower<upper){const middle=(lower+upper)>>>1;if(ranges[middle]![0]<=key)lower=middle+1;else upper=middle;}
 const range=ranges[lower-1];return range&&key<=range[1]?range[2]+key-range[0]:undefined;
}
// Supplementary characters and decomposed pairs share a two-code-unit pool.
// The bitmap also preserves one-unit values without UTF-16 index ambiguity.
let pooledValues:string[]|undefined,extendedHangul:number[]|undefined;
function poolValue(index:number):string{
 if(!pooledValues){pooledValues=[];const lengths=atob(multibytePoolLengths),bytes=atob(multibytePool);let pool='';for(let i=0;i<bytes.length;i+=2)pool+=String.fromCharCode(bytes.charCodeAt(i)|(bytes.charCodeAt(i+1)<<8));let offset=0;
  for(let i=0;offset<pool.length;i++){const length=1+((lengths.charCodeAt(i>>>3)>>>(i&7))&1);pooledValues.push(pool.slice(offset,offset+length));offset+=length;}
 }
 return pooledValues[index]!;
}
function hangulPoint(index:number):number{
 if(!extendedHangul){extendedHangul=[];const bitmap=atob(cp949Hangul);for(let i=0;i<11172;i++)if((bitmap.charCodeAt(i>>>3)>>(i&7))&1)extendedHangul.push(0xac00+i);}
 return extendedHangul[index]!;
}
const johabMedial=[3,4,5,6,7,10,11,12,13,14,15,18,19,20,21,22,23,26,27,28,29];
function johabPoint(key:number):number|undefined{
 if(key<0x8000||key>=0xd400)return undefined;
 const initial=((key>>>10)&31)-2,medial=johabMedial.indexOf((key>>>5)&31),tail=key&31,final=tail<=17?tail-1:tail-2;
 return initial>=0&&initial<19&&medial>=0&&tail!==18&&final>=0&&final<28?0xac00+(initial*21+medial)*28+final:undefined;
}
// EUC-KR's eight-byte form encodes initial, medial and final compatibility Jamo.
const hangulInitial=[0xa1,0xa2,0xa4,0xa7,0xa8,0xa9,0xb1,0xb2,0xb3,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,0xbb,0xbc,0xbd,0xbe];
const hangulFinal=[0xd4,0xa1,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,0xa9,0xaa,0xab,0xac,0xad,0xae,0xaf,0xb0,0xb1,0xb2,0xb4,0xb5,0xb6,0xb7,0xb8,0xba,0xbb,0xbc,0xbd,0xbe];

/** Strict finite byte maps; only an unfinished character survives each call. */
export class PythonMultibyteDecoder {
 private pending:number[]=[];
 private readonly maps:ExpandedTable;
 private readonly native:TextDecoder;
 constructor(private readonly table:PythonMultibyteTable){
  let maps=expandedTables.get(table);
  if(!maps){maps={prefixes:new Set(unpack(table.prefixes).flatMap(([start,end])=>Array.from({length:end-start+1},(_,i)=>start+i))),native:unpack(table.native),ranges:unpack(table.ranges),hangul:unpack(table.hangulRanges??'')};expandedTables.set(table,maps);}
  this.maps=maps;this.native=new TextDecoder(table.nativeEncoding,{fatal:true,ignoreBOM:true});
 }
 decode(bytes:Uint8Array=new Uint8Array(),options:{stream?:boolean}={}):string{
  let pending=[...this.pending],output='';
  // CPython consumes its old buffer when new input arrives, even on failure;
  // a failed empty final flush retains that buffer for a subsequent call.
  if(bytes.length)this.pending=[];
  for(const byte of bytes){
   pending.push(byte);
   if(this.table.hangul&&pending.length>=2&&pending[0]===0xa4&&pending[1]===0xd4){
    // Python defers validation of all trailing bytes until the eighth arrives.
    if(pending.length<8)continue;
    const initial=hangulInitial.indexOf(pending[3]!),medial=pending[5]!-0xbf,final=hangulFinal.indexOf(pending[7]!);
    if(pending[2]!==0xa4||pending[4]!==0xa4||pending[6]!==0xa4||initial<0||medial<0||medial>=21||final<0)throw new PythonTextDecodeError('Invalid multibyte input');
    output+=String.fromCodePoint(0xac00+(initial*21+medial)*28+final);pending=[];continue;
   }
   let key=0;for(const value of pending)key=key*256+value;
   const native=lookup(this.maps.native,key),literal=lookup(this.maps.ranges,key),hangul=lookup(this.maps.hangul,key),johab=this.table.johab?johabPoint(key):undefined;
   if(johab!==undefined){output+=String.fromCodePoint(johab);pending=[];}
   else if(native!==undefined){
    const raw=native>65535?Uint8Array.of(native>>>16,native>>>8,native):native>255?Uint8Array.of(native>>>8,native):Uint8Array.of(native);
    output+=this.native.decode(raw);pending=[];
   }else if(literal!==undefined){output+=poolValue(literal);pending=[];}
   else if(hangul!==undefined){output+=String.fromCodePoint(hangulPoint(hangul));pending=[];}
   else if(!this.maps.prefixes.has(key))throw new PythonTextDecodeError('Invalid multibyte input');
  }
  if(!options.stream&&pending.length)throw new PythonTextDecodeError('Incomplete multibyte input');
  this.pending=pending;
  return output;
 }
}
