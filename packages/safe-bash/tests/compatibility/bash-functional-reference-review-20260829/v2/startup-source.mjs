import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.dirname(new URL(import.meta.url).pathname);
const capture=fs.openSync(root+'/STARTUP-SOURCE.capture.data','wx',0o600);
const record=row=>fs.writeSync(capture,JSON.stringify(row)+'\n');
try{
 record({event:'START',role:'PUBLIC_SYSTEM_MANUAL_SOURCE_ONLY',children:0});
 const rows=[];
 for(const [index,filename] of ['/usr/share/man/man1/zsh.1','/usr/share/man/man1/zshfiles.1'].entries()){
  let stat;try{stat=fs.lstatSync(filename);}catch(error){rows.push({path:filename,status:'UNAVAILABLE',code:error.code});continue;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1048576){rows.push({path:filename,status:'NOT_ADMITTED',bytes:stat.size});continue;}
  const bytes=fs.readFileSync(filename);const after=fs.lstatSync(filename);
  if(bytes.length!==stat.size||after.ino!==stat.ino||after.mtimeMs!==stat.mtimeMs)throw Error('MANUAL_INTEGRITY_STOP');
  const sha256=createHash('sha256').update(bytes).digest('hex');fs.writeFileSync(root+`/MANUAL-${index}.data`,bytes,{flag:'wx',mode:0o600});
  const lines=bytes.toString('utf8').split('\n');const selected=new Set();for(let line=0;line<lines.length;line++)if(/zshenv|RCS|STARTUP|ZDOTDIR/.test(lines[line]))for(let offset=Math.max(0,line-3);offset<Math.min(lines.length,line+9);offset++)selected.add(offset);
  const excerpts=[...selected].sort((left,right)=>left-right).map(line=>`${line+1}: ${lines[line]}`);
  const row={path:filename,status:'ADMITTED_PUBLIC_MANUAL',bytes:bytes.length,mode:stat.mode&511,sha256,excerpts};rows.push(row);console.log(JSON.stringify(row));
 }
 fs.writeFileSync(root+'/STARTUP-SOURCE.json',JSON.stringify({role:'SOURCE_NOT_RUNTIME',rows,children:0},null,2)+'\n',{flag:'wx'});record({event:'COMPLETE',rows:rows.length,children:0});
}catch(error){record({event:'STOP',message:error.message});process.exitCode=1;}finally{fs.closeSync(capture);}
