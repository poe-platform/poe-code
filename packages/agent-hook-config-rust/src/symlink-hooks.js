import {native} from './native.js';
import {admit,files} from './host.js';
import {getAgentConfig} from './configs.js';
export const userAuthoredHookFileCode=native.USER_AUTHORED_HOOK_FILE_CODE;
export function symlinkHooks(sourceAgentId,targetAgentId,cwd,homeDir,scope){
 const source=getAgentConfig(sourceAgentId),target=getAgentConfig(targetAgentId);
 return files(callback=>native.hookSymlink(source===undefined?undefined:admit(source),target===undefined?undefined:admit(target),sourceAgentId,targetAgentId,cwd,homeDir,scope,callback));
}
