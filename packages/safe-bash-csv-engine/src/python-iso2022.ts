import {PythonMultibyteDecoder} from './python-multibyte.js';
import {pythonMultibyteTables} from './python-multibyte-tables.js';
import {PythonTextDecodeError} from './python-codepages.js';
import {pythonFileCodepages} from './python-file-codepages.js';

// Charset designators are ISO-2022 wire values; bit 7 denotes a two-byte set.
export const pythonIso2022Charsets:Readonly<Record<string,readonly number[]>>={
 iso2022_jp:[0xc2,0x4a,0xc0],iso2022_jp_1:[0xc2,0xc4,0x4a,0xc0],
 iso2022_jp_2:[0xc2,0xc4,0xc3,0xc1,0x4a,0xc0,0x41,0x46],
 iso2022_jp_2004:[0xd1,0xc2,0xd0],iso2022_jp_3:[0xcf,0xc2,0xd0],
 iso2022_jp_ext:[0xc2,0xc4,0x4a,0x49,0xc0],iso2022_kr:[0xc3]
};
const escapeEnd=(byte:number)=>byte===64||byte>=65&&byte<=90;
export class PythonIso2022PendingError extends Error {
 constructor(){super('pending buffer overflow');}
}
/** Bounded ISO-2022 designation and shift state, with existing Python mappings. */
export class PythonIso2022Decoder {
 private readonly groups=[66,66,66];
 private shifted=false;
 private through=false;
 private pending:number[]=[];
 private readonly maps=new Map<string,PythonMultibyteDecoder>();
 constructor(private readonly encoding:string){}
 private invalid():never{throw new PythonTextDecodeError('Invalid ISO-2022 input');}
 private character(charset:number,bytes:readonly number[]):string{
  const a=bytes[0]!;
  if(charset===74)return String.fromCodePoint(a===92?165:a===126?8254:a);
  if(charset===73){if(a<33||a>95)return this.invalid();return String.fromCodePoint(a+0xff40);}
  if(charset===65||charset===70)return this.invalid();
  const b=bytes[1]!;
  if(a<33||a>126||b<33||b>126)return this.invalid();
  // EUC plane two also admits JIS X 0212 fallback rows; ISO-2022 does not.
  if(charset===0xd0&&a<110&&![33,35,36,37,40,44,45,46,47].includes(a))return this.invalid();
  if((charset===0xcf||charset===0xd1)&&a===34&&b===50)return '~';
  const mapping=charset===0xc1?'gb2312':charset===0xc3?'cp949':charset===0xcf?'euc_jisx0213':charset===0xd1?'euc_jis_2004':charset===0xd0?'euc_jis_2004':'euc_jp';
  let decoder=this.maps.get(mapping);
  if(!decoder){decoder=new PythonMultibyteDecoder(pythonMultibyteTables[mapping]!);this.maps.set(mapping,decoder);}
  return decoder.decode(Uint8Array.from(charset===0xc4||charset===0xd0?[143,a+128,b+128]:[a+128,b+128]));
 }
 private secondary(byte:number):string{
  const group=this.groups[2];
  if(group===66){if(byte>=128)return this.invalid();return String.fromCharCode(byte);}
  if(group===65){if(byte>=128)return this.invalid();return String.fromCharCode(byte+128);}
  if(group!==70)throw new Error('Invalid ISO-2022 secondary designation');
  const value=byte^128;
  // ISO-2022 uses the older Greek repertoire without the later currency additions.
  if(value===0xa4||value===0xa5||value===0xaa)return this.invalid();
  const point=pythonFileCodepages['iso8859-7']?.[value];
  if(point===undefined||point<0)return this.invalid();
  return String.fromCodePoint(point);
 }
 private escape(bytes:readonly number[]):number|undefined{
  let length=0;
  for(let i=1;i<16;i++){
   if(i>=bytes.length)return undefined;
   if(escapeEnd(bytes[i]!)){length=i+1;break;}
   if(this.encoding!=='iso2022_kr'&&bytes[i]===38&&bytes[i+1]===64)i+=2;
  }
  if(!length)return this.invalid();
  let group:number,charset:number;
  if(length===3){
   charset=bytes[2]!;
   if(bytes[1]===36){charset|=128;group=0;}
   else if(bytes[1]===40)group=0;
   else if(bytes[1]===41)group=1;
   else if(bytes[1]===46&&this.encoding==='iso2022_jp_2')group=2;
   else return this.invalid();
  }else if(length===4&&bytes[1]===36&&(bytes[2]===40||bytes[2]===41)){
   group=bytes[2]===40?0:1;charset=bytes[3]!|128;
  }else if(length===6&&this.encoding!=='iso2022_kr'&&bytes[3]===27&&bytes[4]===36&&bytes[5]===66){group=0;charset=194;}
  else return this.invalid();
  if(charset!==66&&!pythonIso2022Charsets[this.encoding]!.includes(charset))return this.invalid();
  this.groups[group]=charset;return length;
 }
 decode(bytes:Uint8Array=new Uint8Array(),options:{stream?:boolean}={}):string{
  const previous=this.pending,pending=[...previous];let output='';
  if(bytes.length)this.pending=[];
  for(const byte of bytes){
   pending.push(byte);
   while(pending.length){
    const first=pending[0]!;let consumed=1;
    if(this.through){output+=String.fromCharCode(first);if(escapeEnd(first))this.through=false;}
    else if(first===27){
     if(pending.length<2)break;
     if([40,41,36,46,38].includes(pending[1]!)){const length=this.escape(pending);if(length===undefined)break;consumed=length;}
     else if(this.encoding==='iso2022_jp_2'&&pending[1]===78){if(pending.length<3)break;output+=this.secondary(pending[2]!);consumed=3;}
     else{output+='\x1b';this.through=true;}
    }else if(this.encoding==='iso2022_kr'&&(first===14||first===15))this.shifted=first===14;
    else if(first===10){this.shifted=false;output+='\n';}
    else if(first<32)output+=String.fromCharCode(first);
    else if(first>=128)return this.invalid();
    else{
     const charset=this.groups[this.shifted?1:0]!;
     if(charset===66)output+=String.fromCharCode(first);
     else{consumed=charset&128?2:1;if(pending.length<consumed)break;output+=this.character(charset,pending);}
    }
    pending.splice(0,consumed);
   }
  }
  // Native final-incomplete errors restore the old byte buffer, while retaining
  // designation changes already consumed from this call. Other errors consume it.
  if(!options.stream&&pending.length){this.pending=previous;throw new PythonTextDecodeError('Incomplete ISO-2022 input');}
  if(pending.length>8)throw new PythonIso2022PendingError();
  this.pending=pending;return output;
 }
}
