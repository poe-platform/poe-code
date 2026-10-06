import {formatLoaderDescription} from './loader-description.js';
import {loadLlmHelp} from './help-text.js';
import type {LlmFragmentLoader} from './fragment-loaders.js';

export async function fragmentLoaderCommand(tokens:readonly string[],loaders:ReadonlyMap<string,LlmFragmentLoader>,output:(text:string)=>Promise<void>,diagnostic:(text:string)=>Promise<void>):Promise<number>{
 const usage='Usage: llm fragments loaders [OPTIONS]\n';
 let failure:string|undefined,help=false,ended=false;const operands:string[]=[];
 for(const token of tokens){
  if(!ended&&token==='--')ended=true;
  else if(!ended&&(token==='--help'||token==='-h'))help=true;
  else if(!ended&&token.startsWith('-')&&token!=='-'){failure=`No such option: ${token.split('=')[0]}`;break;}
  else operands.push(token);
 }
 if(help&&!failure){await output(await loadLlmHelp('fragments-loaders'));return 0;}
 failure??=operands.length?`Got unexpected extra argument (${operands[0]})`:undefined;
 if(failure){await diagnostic(usage+"Try 'llm fragments loaders --help' for help.\n\nError: "+failure+'\n');return 2;}
 let found=false;
 for(const [prefix,loader]of loaders){
  if(found)await output('\n');found=true;await output(`${prefix}:\n`);
  for(const line of formatLoaderDescription(loader.description))await output(line+'\n');
 }
 if(!found)await output('No fragment loaders found\n');
 return 0;
}
