import {createRetainedPageCopy,PdfFileSource,PdfRetainedDocument,PdfStagingStorage,PdfError,type PdfRetainedPageCopy,type PdfRect} from "@poe-code/pdf-ast";
import type {CommandContext} from "safe-bash-contracts/command";
import {readBytes,writeBytes,type ByteSink} from "safe-bash-contracts/io";
import {resolvePath} from "safe-bash-contracts/path";
import {yieldTurn} from "safe-bash-contracts/yield";
import type {PdftocairoPlan} from "./parse.js";
import {publish} from "./retained.js";

/** Cairo PDF output copies each selected page as its own source batch, matching
 * the convenience API's resource identities without retaining selected pages. */
export async function executeRetainedCairoPdf(context:CommandContext,plan:PdftocairoPlan,stdout:ByteSink,signal:AbortSignal,maximum:number):Promise<{exitCode:number}>{
 const directory=resolvePath(context.cwd,context.env.TMPDIR||"/tmp"),storage=new PdfStagingStorage({fs:context.fs,directory}),encoder=new TextEncoder();
 async function diagnostic(message:string,exitCode:number){if(!plan.quiet)await writeBytes(context.stderr,encoder.encode(message),signal);return {exitCode};}
 let source:PdfFileSource|undefined,document:PdfRetainedDocument|undefined,copy:PdfRetainedPageCopy|undefined,result:PdfFileSource|undefined,failed=false;
 try{
  await context.fs.mkdir(directory,{recursive:true,signal});const maxInputBytes=Math.min(maximum,context.inputBudget?.maxBytes??Infinity);
  try{
   if(plan.inputPath==="-"){
    async function* input(){let count=0;for await(const bytes of readBytes(context.stdin,signal)){count+=bytes.length;context.inputBudget?.check(count);yield bytes;}}
    source=await PdfFileSource.fromStream(storage.fs,directory,input(),{maxInputBytes,signal});
   }else{const path=resolvePath(context.cwd,plan.inputPath);context.inputBudget?.check((await context.fs.stat(path,{signal})).size);source=await PdfFileSource.open(context.fs,path,{maxInputBytes,signal});context.inputBudget?.check(source.size);}
  }catch(error){signal.throwIfAborted();if(error instanceof Error&&"code" in error&&error.code==="ENOENT")return await diagnostic(`I/O Error: Couldn't open file '${plan.inputPath}'\n`,1);throw error;}
  let count=0;
  try{document=await PdfRetainedDocument.open(source,storage,{signal,...(plan.password?{password:plan.password}:{})});for await(const ignored of document.pages()){void ignored;count++;await yieldTurn(signal);}}
  catch(error){signal.throwIfAborted();if(!(error instanceof PdfError)||error.code==="E_LIMIT"||error.code==="E_CANCELLED")throw error;return await diagnostic(`PDF Error: ${error.message}\n`,1);}
  const total=Math.max(1,count),last=plan.lastPage>0?Math.min(total,plan.lastPage):total;
  if(plan.firstPage>total||plan.firstPage>last)return await diagnostic(`Command Line Error: Wrong page range given: the first page (${plan.firstPage}) can not be after the last page (${last}).\n`,99);
  const retained=document;
  async function* selections(){for(let page=plan.firstPage;page<=last;page++){await yieldTurn(signal);if(plan.oddOnly&&page%2===0||plan.evenOnly&&page%2===1)continue;yield {document:retained,indices:[page-1]};}}
  const paper=!plan.origPageSizes&&plan.paperW>0&&plan.paperH>0;
  copy=await createRetainedPageCopy(selections(),storage,{signal,metadata:await document.info(),...(paper||plan.hasCrop?{pageBoxes:({width,height}:{width:number;height:number})=>{const box:PdfRect=[0,0,paper?plan.paperW:plan.cropW>0?plan.cropW:Math.max(1,width-plan.cropX),paper?plan.paperH:plan.cropH>0?plan.cropH:Math.max(1,height-plan.cropY)];return {mediaBox:box,cropBox:box};}}:{})});
  result=await PdfFileSource.fromStream(storage.fs,directory,copy.chunks(),{signal});
  const stem=plan.inputPath.toLowerCase().endsWith(".pdf")?plan.inputPath.slice(0,-4):plan.inputPath,raw=plan.positionals[1]??(plan.inputPath==="-"?"-":`${stem}.pdf`),output=raw==="-"||raw.toLowerCase().endsWith(".pdf")?raw:`${raw}.pdf`;
  if(output==="-"){for await(const bytes of result.stream(0,result.size,signal))await writeBytes(stdout,bytes,signal);}
  else try{await publish(context,resolvePath(context.cwd,output),result.stream(0,result.size,signal),signal);}
  catch(error){signal.throwIfAborted();if(!(error instanceof Error)||!("code" in error))throw error;await writeBytes(context.stderr,encoder.encode(`Error opening output file ${output}\n`),signal);return {exitCode:2};}
  return {exitCode:0};
 }catch(error){failed=true;throw error;}finally{const results=await Promise.allSettled([result?.close(),copy?.close(),document?.close(),source?.close()]);if(!failed)for(const result of results)if(result.status==="rejected")await Promise.reject(result.reason);}
}
