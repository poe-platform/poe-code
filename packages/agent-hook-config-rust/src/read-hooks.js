import {native} from './native.js';
import {files} from './host.js';
export function readClaudeHooks(cwd,homeDir,opts){
 const result=files(callback=>native.hookRead(cwd,homeDir,opts?.scope??'merged',callback));
 for(const entry of result.entries)if(!Object.hasOwn(entry,'matcher'))entry.matcher=undefined;
 return result;
}
