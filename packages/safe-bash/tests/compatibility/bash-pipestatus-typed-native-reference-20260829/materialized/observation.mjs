import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const requireValue=(value,message)=>{if(!value)throw Error(message);};
export function validateEffects(id,before,after){
 requireValue(/^P(?:19|2[0-4])$/.test(id)&&Array.isArray(before)&&Array.isArray(after),'EFFECT_ROLE');
 requireValue(JSON.stringify(before)===JSON.stringify(after),'UNEXPECTED_EFFECT');return true;
}
export function encodeObservation(row){
 requireValue(/^P(?:19|2[0-4])$/.test(row.id)&&Number.isInteger(row.status)&&row.status>=0&&row.status<=255,'OBSERVATION_ID_STATUS');
 requireValue(Array.isArray(row.capture)&&row.capture.length===2&&row.filesVerified===true,'OBSERVATION_CAPTURE');
 const fields=['FNPIPEOBS1',row.id,String(row.status)];
 for(const name of ['stdout','stderr']){
  const capture=row.capture.find(item=>item.name===name);
  requireValue(capture&&capture.flush&&capture.size&&capture.hash&&capture.close&&typeof capture.base64==='string','OBSERVATION_CAPTURE');
  const bytes=Buffer.from(capture.base64,'base64');
  requireValue(bytes.length<=65536&&bytes.length===capture.bytes&&bytes.toString('base64')===capture.base64&&hash(bytes)===capture.sha256,'OBSERVATION_HASH');
  fields.push(String(bytes.length),capture.base64);
 }
 fields.push(Buffer.from(JSON.stringify({before:row.filesBefore,after:row.filesAfter})).toString('base64'));
 const bytes=Buffer.from(fields.join('\0')+'\0');requireValue(bytes.length<=262144,'FRAME_CAP');return bytes;
}
