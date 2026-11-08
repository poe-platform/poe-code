import {native} from './native.js';
import {files,admit,selected} from './host.js';
export function writeCodexHooks(targetPath,entries,runId,opts){return files(callback=>native.hookWrite(targetPath,admit(entries.map(entry=>selected(entry,true))),runId,Boolean(opts?.preserveGenerated),callback));}
