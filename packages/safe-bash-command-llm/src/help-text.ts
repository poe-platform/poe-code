import {packedHelp, type LlmHelpName} from './help-data.js';

let catalog: Promise<Record<LlmHelpName,string>> | undefined;
/** Fixed, trusted help data stays compressed until help is requested. */
export async function loadLlmHelp(name:LlmHelpName):Promise<string> {
 catalog ??= new Response(new Blob([Uint8Array.from(atob(packedHelp),character=>character.charCodeAt(0))])
  .stream().pipeThrough(new DecompressionStream('gzip'))).json() as Promise<Record<LlmHelpName,string>>;
 return (await catalog)[name];
}
