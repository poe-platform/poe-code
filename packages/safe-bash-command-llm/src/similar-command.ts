import {FsError} from 'safe-bash-contracts';
import {pathOf} from 'safe-bash-contracts/path';
import type {LlmCollectionCommands} from './collections-command-types.js';
import {withLlmCollections} from './collections.js';
import {LlmCollectionDoesNotExist} from './collections-errors.js';
import {createLlmConfiguration} from './configuration.js';
import {acquireEmbeddingInput} from './embed-source.js';
import {similarOutput} from './similar-output.js';
import type {LlmInputSource} from './types.js';

const usage='Usage: llm similar [OPTIONS] COLLECTION [ID]\n';
const help=usage+'\n  Return top N similar IDs from a collection using cosine similarity.\n\n  Example usage:\n\n      llm similar my-collection -c "I like cats"\n\n  Or to find content similar to a specific stored ID:\n\n      llm similar my-collection 1234\n\nOptions:\n  -i, --input PATH      File to embed for comparison\n  -c, --content TEXT    Content to embed for comparison\n  --binary              Treat input as binary data\n  -n, --number INTEGER  Number of results to return\n  -p, --plain           Output in plain text format\n  -d, --database FILE\n  --prefix TEXT         Just IDs with this prefix\n  -h, --help            Show this message and exit.\n';
export async function similarCommand(invocation:Parameters<LlmCollectionCommands['execute']>[0],limits:{maxFileBytes:number;maxIndexBytes:number;maxOpenFiles:number;now:()=>Date}):Promise<number>{
 const {context,tokens,write,diagnostic,step,admit,maxConfigurationBytes,maxInputBytes,service}=invocation;
 const fail=async(message:string,code=1,withUsage=false)=>{await diagnostic((withUsage?usage+"Try 'llm similar -h' for help.\n\n":'')+`Error: ${message}\n`);return code;};
 const values:Record<string,string>={},operands:string[]=[];
 const names:Record<string,string>={'-i':'input','--input':'input','-c':'content','--content':'content','-n':'number','--number':'number','-d':'database','--database':'database','--prefix':'prefix'};
 let ended=false,wantsHelp=false,binary=false,plain=false;
 for(let index=0;index<tokens.length;index++){
  await step();const token=tokens[index]!;
  if(!ended&&token==='--'){ended=true;continue;}
  if(ended||!token.startsWith('-')||token==='-'){operands.push(token);continue;}
  const long=token.startsWith('--'),equals=token.indexOf('=');
  for(let cursor=long?0:1;cursor<token.length;cursor++){
   const flag=long?token.slice(0,equals<0?undefined:equals):'-'+token[cursor];
   if(['--help','-h','--binary','--plain','-p'].includes(flag)){
    if(long&&equals>=0)return fail(`Option '${flag}' does not take a value.`,2);
    if(flag==='--binary')binary=true;else if(flag==='--plain'||flag==='-p')plain=true;else wantsHelp=true;
    if(long)break;continue;
   }
   const name=names[flag];if(!name)return fail(`No such option: ${flag}`,2,true);
   const attached=long?(equals<0?undefined:token.slice(equals+1)):(token.slice(cursor+1)||undefined),value=attached??tokens[++index];
   if(value===undefined)return fail(`Option '${flag}' requires an argument.`,2);
   values[name]=value;break;
  }
 }
 if(wantsHelp){await write(new TextEncoder().encode(help));return 0;}
 if(!operands.length)return fail("Missing argument 'COLLECTION'.",2,true);
 if(operands.length>2)return fail(`Got unexpected extra argument${operands.length>3?'s':''} (${operands.slice(2).join(' ')})`,2,true);
 const integer=(values.number??'10').trim(),digits=integer[0]==='+'||integer[0]==='-'?integer.slice(1):integer;
 const number=Number(integer);
 if(!digits||Array.from(digits).some(char=>char<'0'||char>'9')||!Number.isSafeInteger(number))return fail(`Invalid value for '-n' / '--number': '${values.number}' is not a valid integer.`,2,true);
 if(values.input&&values.input!=='-'){
  try{await context.fs.stat(pathOf(context,values.input),{signal:context.signal});}
  catch(error){if(error instanceof FsError&&error.code==='ENOENT')return fail(`Invalid value for '-i' / '--input': Path '${values.input}' does not exist.`,2,true);throw error;}
 }
 const id=operands[1];if(!id&&!values.content&&!values.input)return fail('Must provide content or an ID for the comparison');
 const config=createLlmConfiguration(context,maxConfigurationBytes),display=values.database||context.env.LLM_EMBEDDINGS_DB||config.directory+'/embeddings.db',path=pathOf(context,display);
 try{
  const stat=await context.fs.stat(path,{signal:context.signal});
  if(stat.type==='directory')return fail(`Invalid value for '-d' / '--database': File '${display}' is a directory.`,2,true);
 }catch(error){if(error instanceof FsError&&error.code==='ENOENT')return fail('No embeddings table found in database');throw error;}
 let input:LlmInputSource|undefined,found=false;
 try{
  const result=await withLlmCollections({...limits,fs:context.fs,path,signal:context.signal,create:false},async catalog=>{
   await catalog.collection(operands[0]!,{create:false});found=true;
   const visit=async(row:Parameters<typeof similarOutput>[0])=>{for await(const chunk of similarOutput(row,plain,context.signal)){await step();await write(chunk);}};
   const settings={number,prefix:values.prefix??''};
   if(id){await catalog.similarById(operands[0]!,id,settings,visit);return 0;}
   const binaryInput=binary&&!values.content;
   input=await acquireEmbeddingInput(context,values,binaryInput,admit);
   if(!input)return fail('No content provided');
   const owned=input;input=undefined;
   await catalog.similar(operands[0]!,{...settings,service,input:owned,maxInputBytes,binary:binaryInput},visit);return 0;
  });
  return result.value;
 }catch(error){
  context.signal.throwIfAborted();
  if(error instanceof LlmCollectionDoesNotExist)return fail(found?'ID not found in collection':'Collection does not exist');
  if(error instanceof FsError&&error.code==='ENOENT')return fail('No embeddings table found in database');
  throw error;
 }finally{await input?.dispose();}
}
