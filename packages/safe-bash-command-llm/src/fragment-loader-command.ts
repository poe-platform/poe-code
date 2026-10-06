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
  const lines=(loader.description||'Undocumented').split('\n');let common:string|undefined;
  for(const line of lines){
   if(!line.trim())continue;
   let width=0;while(line[width]===' '||line[width]==='\t')width++;
   const indent=line.slice(0,width);
   if(common===undefined)common=indent;else{let i=0;while(i<common.length&&common[i]===indent[i])i++;common=common.slice(0,i);}
  }
  const description=lines.map(line=>line.trim()?line.slice(common?.length??0):'').join('\n').trim();
  for(const line of description.split('\n'))await output((line.trim()?`  ${line}`:line)+'\n');
 }
 if(!found)await output('No fragment loaders found\n');
 return 0;
}
