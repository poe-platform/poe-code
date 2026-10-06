import {formatLoaderDescription} from './loader-description.js';
import {commandArguments} from './command-arguments.js';
import type {LlmFragmentLoader} from './fragment-loaders.js';

export async function fragmentLoaderCommand(tokens:readonly string[],loaders:ReadonlyMap<string,LlmFragmentLoader>,output:(text:string)=>Promise<void>,diagnostic:(text:string)=>Promise<void>,step:()=>Promise<void>):Promise<number>{
 const parsed=await commandArguments('fragments loaders',tokens,[],output,diagnostic,step);
 if(typeof parsed==='number')return parsed;
 let found=false;
 for(const [prefix,loader]of loaders){
  if(found)await output('\n');found=true;await output(`${prefix}:\n`);
  for(const line of formatLoaderDescription(loader.description))await output(line+'\n');
 }
 if(!found)await output('No fragment loaders found\n');
 return 0;
}
