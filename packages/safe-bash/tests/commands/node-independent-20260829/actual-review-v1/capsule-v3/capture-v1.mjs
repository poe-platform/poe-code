import {openSync,closeSync,writeSync} from 'node:fs';
export const actualIO=Object.freeze({open:path=>openSync(path,'wx',0o600),close:descriptor=>closeSync(descriptor),write:(descriptor,bytes,offset,length)=>writeSync(descriptor,bytes,offset,length)});
export function acquireCapture(paths,io=actualIO){
  const descriptors=[];const cleanup=[];
  try{for(const path of paths)descriptors.push(io.open(path));}
  catch(value){for(const descriptor of descriptors)try{io.close(descriptor);}catch(value){cleanup.push({present:true,value});}return {ok:false,primary:{present:true,value},cleanup};}
  let closed=false;
  return {ok:true,write(index,bytes){if(closed||!Number.isInteger(index)||index<0||index>=descriptors.length||bytes.byteLength>65536)throw new Error('capture write admission');let offset=0;while(offset<bytes.byteLength){const written=io.write(descriptors[index],bytes,offset,bytes.byteLength-offset);if(!Number.isSafeInteger(written)||written<=0||written>bytes.byteLength-offset)throw new Error('capture zero/invalid short write');offset+=written;}return offset;},close(){if(closed)return cleanup;closed=true;for(const descriptor of descriptors)try{io.close(descriptor);}catch(value){cleanup.push({present:true,value});}return cleanup;}};
}
export function captureControls(){
 const results=[];const check=(id,condition)=>{results.push({id,pass:condition});if(!condition)throw new Error('capture control '+id);};
 let opened=0;let closed=[];let result=acquireCapture(['a','b'],{open(){opened++;throw undefined;},close:value=>closed.push(value),write(){return 1;}});check('C01',!result.ok&&result.primary.present&&result.primary.value===undefined&&opened===1&&closed.length===0);
 opened=0;closed=[];result=acquireCapture(['a','b'],{open(){if(++opened===2)throw false;return 1;},close:value=>closed.push(value),write(){return 1;}});check('C02',!result.ok&&result.primary.value===false&&closed.length===1&&closed[0]===1);
 opened=0;closed=[];result=acquireCapture(['a','b'],{open:()=>++opened,close(value){closed.push(value);throw value===1?undefined:false;},write(){return 1;}});const faults=result.close();check('C03',faults.length===2&&faults[0].present&&faults[0].value===undefined&&faults[1].value===false&&closed.length===2);
 let writes=0;result=acquireCapture(['a','b'],{open:()=>1,close(){},write(){writes++;return 1;}});check('C04',result.write(0,new Uint8Array(3))===3&&writes===3);result.close();
 result=acquireCapture(['a'],{open:()=>1,close(){},write(){return 0;}});let caught=false;try{result.write(0,new Uint8Array(1));}catch{caught=true;}check('C05',caught);result.close();
 const primary={tag:'capture'};result=acquireCapture(['a'],{open:()=>1,close(){},write(){throw primary;}});let observed;try{result.write(0,new Uint8Array(1));}catch(value){observed=value;}check('C06',observed===primary);result.close();
 opened=0;closed=[];result=acquireCapture(['a','b'],{open:()=>++opened,close:value=>closed.push(value),write:(descriptor,bytes,offset,length)=>length});check('C07',result.write(1,new Uint8Array(3))===3&&result.close().length===0&&closed.length===2&&closed[0]===1&&closed[1]===2);return results;
}
