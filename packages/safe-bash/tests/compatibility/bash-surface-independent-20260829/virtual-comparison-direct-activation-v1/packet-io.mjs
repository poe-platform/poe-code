import fs from 'node:fs';
import path from 'node:path';
import {readPinned,pinExecutable,hash,publish} from './profile/auth.mjs';
export function census(root,maximum){let bytes=0,entries=0;function visit(current){if(++entries>12000)throw Error('WORK_ENTRIES');const stat=fs.lstatSync(current);if(stat.isSymbolicLink())throw Error('WORK_SYMLINK');if(stat.isDirectory())for(const name of fs.readdirSync(current))visit(path.join(current,name));else if(stat.isFile()){bytes+=stat.size;if(bytes>maximum)throw Error('WORK_BYTES');}else throw Error('WORK_TYPE');}visit(root);return {bytes,entries,qualification:'sampled logical working bytes, not RSS or continuous disk quota'};}
export function checkShipping(root,members){for(const pin of members){const filename=path.join(root,pin.path);readPinned(filename,pin);if((fs.lstatSync(filename).mode&4095)!==pin.mode)throw Error('SHIPPING_MODE');}}
export function preflight(packet,seal){
  for(const [name,pin]of Object.entries(seal.files))readPinned(path.join(packet,name),pin);
  const tools=JSON.parse(readPinned(path.join(packet,'TOOLS.json'),seal.files['TOOLS.json']));pinExecutable(tools.node);
  pinExecutable(seal.envExecutable);
  for(const tool of tools.packages)for(const pin of tool.rows){const filename=path.join(tool.resolved,pin.path);readPinned(filename,pin);if((fs.lstatSync(filename).mode&4095)!==pin.mode)throw Error('TOOL_MODE');}
  const stat=fs.lstatSync(seal.archive.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==seal.archive.bytes)throw Error('ARCHIVE_PREFLIGHT_TYPE');readPinned(seal.archive.path,seal.archive,1048576);
  return tools;
}
export function retainFile(filename,bytes,deadline){return publish(filename,bytes,deadline);}
export function requirePublication(deadline,work){if(Date.now()>=deadline)throw Error('PUBLICATION_DEADLINE');return census(work,536870912);}
export {hash};
