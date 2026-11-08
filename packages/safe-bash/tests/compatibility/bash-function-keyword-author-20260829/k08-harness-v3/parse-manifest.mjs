import {createHash} from 'node:crypto';
export class TarAdmissionError extends Error {
 constructor(code,expectedMembers,actualMembers,decodedBytes,alignmentRemainder,memberIndex=-1){super(code);this.name='TarAdmissionError';this.code=code;this.expectedMembers=expectedMembers;this.actualMembers=actualMembers;this.decodedBytes=decodedBytes;this.alignmentRemainder=alignmentRemainder;this.memberIndex=memberIndex;}
}
export function archiveFailureRecord(reason){if(!(reason instanceof TarAdmissionError))return undefined;const row={name:reason.name,code:reason.code};for(const key of ['expectedMembers','actualMembers','decodedBytes','alignmentRemainder','memberIndex'])if(Number.isSafeInteger(reason[key])&&reason[key]>=-1)row[key]=reason[key];return row;}
export function validateTar(buffer,expected,expectedCount){
 const decodedBytes=Buffer.isBuffer(buffer)?buffer.length:-1,actualCount=Array.isArray(expected)?expected.length:-1,remainder=decodedBytes<0?-1:decodedBytes%512;
 const fail=(code,actual=actualCount,index=-1)=>{throw new TarAdmissionError(code,Number.isSafeInteger(expectedCount)?expectedCount:-1,actual,decodedBytes,remainder,index);};
 if(!Number.isSafeInteger(expectedCount)||expectedCount<1||expectedCount>2000||!Array.isArray(expected))fail('MANIFEST_SHAPE');
 if(actualCount!==expectedCount)fail('MANIFEST_COUNT');
 if(decodedBytes<0||remainder!==0)fail('TAR_ALIGNMENT');
 const inventory=new Map();
 for(const member of expected){if(!member||typeof member.path!=='string'||member.path.length<1||member.path.length>512||member.path.startsWith('/')||member.path.includes('\\')||member.path.includes('\0')||member.path.split('/').some(part=>part==='.'||part==='..'||part==='')||!Number.isSafeInteger(member.bytes)||member.bytes<0||!Number.isSafeInteger(member.mode)||member.mode<0||member.mode>511||typeof member.sha256!=='string'||!/^[a-f0-9]{64}$/.test(member.sha256))fail('MANIFEST_SHAPE');if(inventory.has(member.path))fail('MANIFEST_DUPLICATE');inventory.set(member.path,member);}
 const seen=new Set();let offset=0,payloadBytes=0,paddingBytes=0;
 const field=(header,start,length)=>{const bytes=header.subarray(start,start+length),zero=bytes.indexOf(0);try{return new TextDecoder('utf-8',{fatal:true}).decode(zero<0?bytes:bytes.subarray(0,zero));}catch{fail('TAR_FIELD_ENCODING',seen.size,seen.size);}};
 const octal=text=>{const value=text.trim();if(!/^[0-7]+$/.test(value))fail('TAR_OCTAL',seen.size,seen.size);const parsed=Number.parseInt(value,8);if(!Number.isSafeInteger(parsed))fail('TAR_OCTAL',seen.size,seen.size);return parsed;};
 while(offset+512<=buffer.length){
  const header=buffer.subarray(offset,offset+512);
  if(header.every(byte=>byte===0)){if(buffer.length-offset<1024||!buffer.subarray(offset).every(byte=>byte===0))fail('TAR_TERMINATOR',seen.size);if(seen.size!==expectedCount)fail('MEMBER_COUNT',seen.size);return {members:seen.size,expectedMembers:expectedCount,payloadBytes,decodedBytes,alignmentRemainder:remainder,format:'ustar-regular-v1',terminatorBytes:buffer.length-offset,paddingBytes,paddingZero:true,fullSetVerified:true,extractionCalls:0};}
  let checksum=0;for(let index=0;index<512;index++)checksum+=index>=148&&index<156?32:header[index];if(checksum!==octal(field(header,148,8)))fail('TAR_CHECKSUM',seen.size,seen.size);
  if(!header.subarray(257,263).equals(Buffer.from([117,115,116,97,114,0]))||!header.subarray(263,265).equals(Buffer.from('00')))fail('TAR_FORMAT',seen.size,seen.size);
  const prefix=field(header,345,155),name=(prefix?prefix+'/':'')+field(header,0,100);
  if(!name.startsWith('package/')||name.includes('\\')||name.includes('\0')||name.split('/').some(part=>part==='.'||part==='..'||part===''))fail('MEMBER_PATH',seen.size,seen.size);
  if(header[156]!==0&&header[156]!==48)fail('MEMBER_TYPE',seen.size,seen.size);if(field(header,157,100))fail('MEMBER_LINK',seen.size,seen.size);
  const size=octal(field(header,124,12)),mode=octal(field(header,100,8)),end=offset+512+size,next=offset+512+Math.ceil(size/512)*512;
  if(!Number.isSafeInteger(end)||!Number.isSafeInteger(next)||end>buffer.length||next>buffer.length)fail('TAR_TRUNCATED',seen.size,seen.size);
  const key=name.slice(8),member=inventory.get(key);if(!member)fail('MEMBER_UNEXPECTED',seen.size,seen.size);if(seen.has(key))fail('MEMBER_DUPLICATE',seen.size,seen.size);if(member.bytes!==size||member.mode!==mode)fail('MEMBER_METADATA',seen.size,seen.size);
  if(createHash('sha256').update(buffer.subarray(offset+512,end)).digest('hex')!==member.sha256)fail('MEMBER_HASH',seen.size,seen.size);
  if(!buffer.subarray(end,next).every(byte=>byte===0))fail('TAR_PADDING',seen.size,seen.size);
  seen.add(key);payloadBytes+=size;paddingBytes+=next-end;offset=next;
 }
 fail('TAR_TERMINATOR',seen.size);
}
