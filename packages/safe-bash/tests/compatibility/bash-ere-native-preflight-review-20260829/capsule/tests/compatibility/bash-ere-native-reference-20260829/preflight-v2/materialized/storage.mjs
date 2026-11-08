import fs from 'node:fs';
import path from 'node:path';
export class Storage{
 constructor(root,{capture=33554432,work=134217728,emergency=65536,deadline=Infinity}={}, {now=Date.now,terminalOperations=fs}={}){this.root=root;this.captureLimit=capture;this.workLimit=work;this.emergency=emergency;this.deadline=deadline;this.samples=[];this.emergencyUsed=false;this.now=now;this.terminalOperations=terminalOperations;this.terminalState=null;}
 checkTime(){if(this.now()>this.deadline)throw Error('FINALIZATION_DEADLINE');}
 scan(){let bytes=0,entries=0;const visit=directory=>{for(const name of fs.readdirSync(directory)){if(++entries>4096)throw Error('STORAGE_ENTRIES');const filename=path.join(directory,name),stat=fs.lstatSync(filename);if(stat.isSymbolicLink())throw Error('STORAGE_SYMLINK');if(stat.isDirectory())visit(filename);else{if(!stat.isFile())throw Error('STORAGE_FILE_TYPE');bytes+=stat.size;}}};visit(this.root);this.last={bytes,entries,at:this.now()};if(bytes>this.captureLimit||bytes>this.workLimit)throw Error('OBSERVED_STORAGE_CAP');return this.last;}
 admit(bytes){this.checkTime();const sample=this.scan();if(!Number.isSafeInteger(bytes)||bytes<0||bytes>262144||sample.bytes+bytes+this.emergency>this.captureLimit||sample.bytes+bytes+this.emergency>this.workLimit)throw Error('BEFORE_WRITE_STORAGE_CAP');}
 write(filename,value,{append=false}={}){const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);if(!filename.startsWith(this.root+'/'))throw Error('WRITE_SCOPE');this.admit(bytes.length);this.checkTime();const descriptor=fs.openSync(filename,append?fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW:fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);let primary;try{this.checkTime();fs.writeFileSync(descriptor,bytes);this.checkTime();fs.fsyncSync(descriptor);}catch(error){primary=error;}finally{try{fs.closeSync(descriptor);}catch(error){primary??=error;}}if(primary)throw primary;this.checkTime();this.scan();}
 record(value){this.write(path.join(this.root,'JOURNAL.jsonl'),JSON.stringify(value)+'\n',{append:true});}
 terminal(value){
  this.checkTime();
  if(this.emergencyUsed)return false;
  this.emergencyUsed=true;
  const state=this.terminalState={qualified:false,opened:false,wrote:false,flushed:false,closed:false,late:false,primary:null,secondary:[]};
  const operations=this.terminalOperations;
  let descriptor;
  const failure=(phase,error)=>{if(state.primary===null)state.primary={phase,error};else state.secondary.push({phase,error});};
  try{
   const bytes=Buffer.from(JSON.stringify(value)+'\n');
   if(bytes.length>this.emergency)throw Error('EMERGENCY_SIZE');
   this.checkTime();
   descriptor=operations.openSync(path.join(this.root,'TERMINAL-STOP.json'),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
   state.opened=true;
   this.checkTime();operations.writeFileSync(descriptor,bytes);state.wrote=true;
   this.checkTime();operations.fsyncSync(descriptor);state.flushed=true;
   this.checkTime();
  }catch(error){failure('PUBLICATION',error);}
  finally{
   if(descriptor!==undefined){
    try{operations.closeSync(descriptor);state.closed=true;}
    catch(error){failure('CLOSE',error);try{operations.closeSync(descriptor);state.closed=true;}catch(secondary){failure('CLOSE_CLEANUP',secondary);}}
   }
   state.late=this.now()>this.deadline;
   try{this.checkTime();}catch(error){failure('FINAL_DEADLINE',error);}
  }
  if(state.primary!==null)throw state.primary.error;
  state.qualified=true;
  return true;
 }
}
