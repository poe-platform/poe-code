import { openRetainedObjectExtraction, stageRetainedExtractionOutput } from 'safe-bash-presentation-engine/opaque-objects';
import { openPackageArchive } from 'safe-bash-presentation-engine/retained-package';
import { OfficeError } from 'safe-bash-presentation-engine/errors';
import type { AdmittedCommandEngineOptions, PptxCommandRequest, PptxStreamPublicationRequest } from './command-engine.js';

export async function prepareRetainedObjectExtraction(args: { readonly input?: string; readonly part?: string; readonly outputDir?: string; readonly json: boolean; readonly force?: boolean; readonly dryRun?: boolean; readonly allowPartialOutput?: boolean; readonly limits?: Readonly<Record<string, number>> },
  request: PptxCommandRequest & { readonly streaming: NonNullable<PptxCommandRequest['streaming']> }, options: AdmittedCommandEngineOptions) {
  const { streaming, signal }=request,context={...options.context,signal,workingStorage:streaming.workingStorage};
  const input=await streaming.openInput(args.input!,Math.min(context.limits.maxBytes,context.archiveLimits.maxArchiveBytes));
  const archive=await openPackageArchive(input,context);
  let extraction:Awaited<ReturnType<typeof openRetainedObjectExtraction>>|undefined,response:Awaited<ReturnType<typeof stageRetainedExtractionOutput>>|undefined,closing:Promise<void>|undefined;
  const close=()=>closing??=(async()=>{const results=await Promise.allSettled([response?.close(),extraction?.close(),archive.close()]);for(const result of results)if(result.status==='rejected')throw result.reason;})();
  try {
    extraction=await openRetainedObjectExtraction(archive,{part:args.part!},context);
    if(extraction.count>(args.limits?.maxOutputs??context.archiveLimits.maxMembers))throw new OfficeError('resource-limit','Opaque output count exceeds limit.','validate-intent');
    if(!args.dryRun&&!request.publishOutputStreams&&(!args.allowPartialOutput||!request.publishOutput))throw Object.assign(new Error('Object extraction requires atomic publication or explicit partial output.'),{code:'publication-unsupported'});
    response=await stageRetainedExtractionOutput(extraction,context,{directory:args.outputDir??'',json:args.json,maxOutputBytes:options.maxOutputBytes,allowPartialOutput:args.allowPartialOutput??false,operation:'objects.extract',dryRun:args.dryRun??false});
    async function* publications(dryRun:boolean):AsyncGenerator<PptxStreamPublicationRequest>{
      if(args.outputDir)for await(const member of extraction!.members()){signal.throwIfAborted();yield {inputPath:args.input!,outputPath:response!.path(member.name),bytes:member.bytes(),originalBytes:input,inPlace:false,force:args.force??false,dryRun};}
    }
    return {close,async publish(){
      let published=0,code:string|undefined;
      try {
        for await(const item of publications(true)){if(request.preflightOutputStream)await request.preflightOutputStream(item);else if(request.publishOutput)await request.publishOutput(item);}
        if(!args.dryRun){if(request.publishOutputStreams)await request.publishOutputStreams(publications(false));else for await(const item of publications(false)){await request.publishOutput!(item);published++;}}
      }catch(error){const raw=error&&typeof error==='object'&&'code' in error?error.code:undefined;code=signal.aborted?'cancelled':typeof raw==='string'&&['resource-limit','stale-input','publication-unsupported'].includes(raw)?raw:'io-failure';}
      await response!.write(!code||args.json?streaming.stdout:streaming.stderr,code?{code,published}:undefined);
      return {exitCode:!code?0:code==='cancelled'?130:code==='resource-limit'?4:code==='stale-input'?1:3,stdout:new Uint8Array(),stderr:new Uint8Array()};
    }};
  }catch(error){await close().catch(()=>{});throw error;}
}
