import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {expect,it} from 'vitest';
import {createStoredZipArchive,readZipArchiveEntries} from 'safe-bash-command-soffice';

it.each(['csv-sdk','csv-command','xlsx-sdk','cancel'])('retains ODS worksheets through external Worker storage (%s)',async mode=>{
  const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: `
    export * as soffice from "safe-bash-command-soffice";
    export { createCommandArguments } from "safe-bash-contracts/command";
    export { MemoryFileSystem } from "@poe-code/safe-fs/core";
    export { createR2PagedFixture } from "./scripts/pandoc-r2-storage.fixture.mjs";
  ` }, bundle: true, platform: "browser", conditions: ["workerd"], format: "cjs", write: false, metafile: true, logLevel: "silent" });
  expect(Object.keys(bundle.metafile!.inputs).filter(path => path.includes("/src/") || path.startsWith("node:"))).toEqual([]);
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-07-01", cf: false, r2Buckets: ["PAGES"], script: `
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request,env){
      const mode=new URL(request.url).pathname.slice(1),rewrite=mode.startsWith('xlsx'),cancel=mode==='cancel',namespace=new api.MemoryFileSystem();
      await namespace.mkdir('/spill');await namespace.mkdir('/out');
      const {fs:backing,events}=api.createR2PagedFixture(namespace,env.PAGES);
      const controller=new AbortController(),reason=new Error('cancelled'),stages=new WeakMap();
      let published,created=0,removed=0,closed=0,largestWrite=0,inputClosed=0,largestAllocation=0;
      const fs=new Proxy(backing,{get(target,key){
        if(key==='readStream')return async function*(path,options){
          if(path!=='/input.ods')throw new Error('Unexpected source');
          const meta=await env.PAGES.head('input');
          try{for(let position=0;position<meta.size;position+=16384){
            options?.signal?.throwIfAborted();const object=await env.PAGES.get('input',{range:{offset:position,length:Math.min(16384,meta.size-position)},onlyIf:{etagMatches:meta.etag}});
            if(!object?.body)throw new Error('Source identity changed');yield new Uint8Array(await object.arrayBuffer());
          }}finally{inputClosed++;}
        };
        if(key==='createStagedFile')return async(...args)=>{
          const receipt=await namespace.createStagedFile(...args),info={receipt,prefix:'output-'+crypto.randomUUID()+'/',count:0,size:0};created++;
          const cleanup={async remove(){removed++;try{await receipt.cleanup.remove();}finally{if(published!==info)for(let index=0;index<info.count;index++)await env.PAGES.delete(info.prefix+index);}},async close(){closed++;await receipt.cleanup.close();}};
          stages.set(cleanup,info);
          return {...receipt,cleanup,writer:{async write(bytes,options){
            options?.signal?.throwIfAborted();if(bytes.length>16384)throw new Error('Oversized publication write');largestWrite=Math.max(largestWrite,bytes.length);
            await env.PAGES.put(info.prefix+info.count++,bytes);info.size+=bytes.length;
            if(cancel)controller.abort(reason);
          },async finish(options){info.sealed=await receipt.writer.finish(options);return {...info.sealed,size:info.size};}}};
        };
        if(key==='publishStagedFile')return async(staging,path,options)=>{
          const info=stages.get(staging.cleanup);if(!info||!info.sealed||staging.file.stat.size!==info.size)throw new Error('Invalid retained publication receipt');
          // Namespace receipts retain zero payload bytes. The committed pointer
          // selects immutable external pages; no file contents enter MemoryFileSystem.
          await namespace.publishStagedFile({...info.receipt,file:{...info.receipt.file,stat:info.sealed}},path,options);published=info;
        };
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      const push=Array.prototype.push;Array.prototype.push=function(...items){if(this.length>=64&&items.some(item=>item&&typeof item==='object'&&'row' in item&&'column' in item&&'value' in item))throw new Error('Resident worksheet');return push.apply(this,items);};
      const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=args[0],length=typeof value==='number'?value:value?.byteLength??value?.length??0;largestAllocation=Math.max(largestAllocation,length);if(length>65536)throw new Error('Unbounded allocation');return Reflect.construct(target,args);}});
      const stdout={async write(bytes){if(bytes.length>65536)throw new Error('Oversized status');}},stderr={async write(bytes){throw new Error(new TextDecoder().decode(bytes));}};
      const args=['--convert-to',rewrite?'xlsx':'csv','--outdir','/out','/input.ods'];let result,cancelled=false;
      try{
        if(mode.endsWith('command'))result=await api.soffice.createSofficeCommand().execute({command:'soffice',...api.createCommandArguments(args),cwd:'/spill',env:{},fs,signal:controller.signal,stdout,stderr,stdin:(async function*(){})()});
        else result=await api.soffice.runSofficeFileCli(args,{filesystem:fs,cwd:'/spill',signal:controller.signal,stdout,stderr});
      }catch(error){if(!cancel||error!==reason)throw error;cancelled=true;}finally{globalThis.Uint8Array=Native;Array.prototype.push=push;}
      let length=0,hash=2166136261;
      if(published)for(let index=0;index<published.count;index++){
        const object=await env.PAGES.get(published.prefix+index),bytes=new Uint8Array(await object.arrayBuffer());
        for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;length+=bytes.length;if(!rewrite)await env.PAGES.delete(published.prefix+index);
      }
      const outputs=await namespace.readdir('/out');
      for(const entry of outputs)if((await namespace.stat('/out/'+entry.name)).size!==0)throw new Error('Resident output payload');
      await env.PAGES.delete('input');
      return Response.json({publication:rewrite?published:undefined,result,cancelled,length,hash,created,removed,closed,largestWrite,inputClosed,largestAllocation,events,
        remaining:(await env.PAGES.list({limit:1})).objects.length,scratch:await namespace.readdir('/spill'),outputs,hostGlobals:[typeof process,typeof Buffer,typeof require]});
    }};
  ` });
  try {
    const value='abé'.repeat(2800), count=128;
    const row='<table:table-row><table:table-cell office:value-type="string"><text:p>'+value+'</text:p></table:table-cell></table:table-row>';
    const xml='<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet><table:table table:name="Data">'+row.repeat(count)+'</table:table></office:spreadsheet></office:body></office:document-content>';
    const input=createStoredZipArchive({'content.xml':new TextEncoder().encode(xml)});
    expect(input.length).toBeGreaterThan(1000000);
    const bucket=await runtime.getR2Bucket('PAGES');await bucket.put('input',input);
    const response=await runtime.dispatchFetch('https://soffice.test/'+mode);expect(response.status).toBe(200);
    const result=await response.json() as {result?:{exitCode:number};cancelled:boolean;length:number;hash:number;created:number;removed:number;closed:number;largestWrite:number;inputClosed:number;largestAllocation:number;events:{opened:number;closed:number;reads:number;writes:number;largestTransfer:number};remaining:number;scratch:unknown[];outputs:{name:string}[];hostGlobals:string[];publication?:{prefix:string;count:number}};
    expect(result.hostGlobals).toEqual(['undefined','undefined','undefined']);expect(result.inputClosed).toBe(1);
    expect(result.largestWrite).toBeLessThanOrEqual(16384);expect(result.largestAllocation).toBeLessThanOrEqual(65536);expect(result.events.largestTransfer).toBeLessThanOrEqual(16384);
    expect(result.events.opened).toBeGreaterThan(0);expect(result.events.closed).toBe(result.events.opened);expect(result.created).toBe(result.removed);expect(result.created).toBe(result.closed);expect(result.scratch).toEqual([]);
    if(mode==='cancel'){expect(result.cancelled).toBe(true);expect(result.outputs).toEqual([]);expect(result.remaining).toBe(0);}
    else{
      expect(result.result?.exitCode).toBe(0);
      if(mode.startsWith('csv')){
        const bytes=new TextEncoder().encode((value+'\n').repeat(count));let hash=2166136261;for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;
        expect(result.length).toBe(bytes.length);expect(result.hash).toBe(hash);expect(result.remaining).toBe(0);
      }else{
        const chunks:Uint8Array[]=[];
        for(let index=0;index<result.publication!.count;index++){const key=result.publication!.prefix+index;chunks.push(new Uint8Array(await (await bucket.get(key))!.arrayBuffer()));await bucket.delete(key);}
        const entries=await readZipArchiveEntries(Buffer.concat(chunks));
        const sheet=new TextDecoder().decode(entries.get('xl/worksheets/sheet1.xml'));
        expect(sheet).toContain('<row r="128"');expect(sheet.match(/<row /g)?.length).toBe(count);
        expect(new TextDecoder().decode(entries.get('xl/sharedStrings.xml'))).toContain(value);
        expect((await bucket.list()).objects).toEqual([]);
      }
    }
  }finally{await runtime.dispose();}
},60000);
