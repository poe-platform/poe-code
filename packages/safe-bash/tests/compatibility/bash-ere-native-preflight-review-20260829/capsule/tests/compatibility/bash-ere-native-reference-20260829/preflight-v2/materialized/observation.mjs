import {createHash} from 'node:crypto';
export function decodeObservation(row){
 const stdout=row.capture.find(item=>item.name==='stdout');
 if(!stdout||!stdout.hash||typeof stdout.base64!=='string')throw Error('OBSERVATION_CAPTURE');
 const bytes=Buffer.from(stdout.base64,'base64');
 if(createHash('sha256').update(bytes).digest('hex')!==stdout.sha256)throw Error('OBSERVATION_HASH');
 const fields=[];let start=0;
 for(let offset=0;offset<bytes.length;offset++)if(bytes[offset]===0){fields.push(bytes.subarray(start,offset));start=offset+1;}
 if(start!==bytes.length||fields.length!==16)throw Error('OBSERVATION_FRAMING');
 const text=index=>{if([...fields[index]].some(code=>code>127))throw Error('OBSERVATION_HEADER_ASCII');return fields[index].toString('ascii');};
 if(text(0)!=='EREOBS1'||text(1)!==row.id)throw Error('OBSERVATION_ID');
 if(!/^(0|[1-9][0-9]{0,2})$/.test(text(2))||!/^[0-4]$/.test(text(3)))throw Error('OBSERVATION_NUMERIC');
 const regexStatus=Number(text(2)),cardinality=Number(text(3));
 if(regexStatus>255||regexStatus!==row.status)throw Error('OBSERVATION_EXIT_STATUS');
 const slots=[];
 for(let index=0;index<4;index++){
  const base=4+index*3;if(text(base)!==String(index)||!['0','1'].includes(text(base+1)))throw Error('OBSERVATION_SLOT');
  const present=text(base+1)==='1',value=fields[base+2];
  if(!present&&value.length!==0)throw Error('OBSERVATION_UNSET_VALUE');
  slots.push({index,shellSlotPresent:present,bytes:value.length,base64:value.toString('base64')});
 }
 if(slots.filter(slot=>slot.shellSlotPresent).length!==cardinality)throw Error('OBSERVATION_CARDINALITY');
 return {regexStatus,cardinality,slots,stdoutSha256:stdout.sha256,hiddenNativeSpans:'UNOBSERVABLE',nativeParticipationFromEmptyString:'NOT_INFERRED'};
}
