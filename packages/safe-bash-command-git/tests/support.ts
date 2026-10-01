import type { FileSystem } from '@poe-code/safe-fs/core';
import { createGitCommand } from '../src/index.js';
import type { CommandContext } from 'safe-bash-contracts';

export function runner(fs: FileSystem, command=createGitCommand()) {
  return async (args: string[]) => {
    let stdout='', stderr='';
    const result=await command.execute({command:'git',args,cwd:'/repo',env:{},fs,
      signal:new AbortController().signal,stdin:(async function*(){})(),
      stdout:{write(bytes:Uint8Array){stdout+=new TextDecoder().decode(bytes);}},
      stderr:{write(bytes:Uint8Array){stderr+=new TextDecoder().decode(bytes);}}} as CommandContext);
    return {...result,stdout,stderr};
  };
}
