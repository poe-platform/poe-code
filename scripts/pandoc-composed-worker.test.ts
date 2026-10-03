import {fileURLToPath} from "node:url";
import {builtinModules} from "node:module";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {expect,it} from "vitest";

it.each(["sdk","command"])("shares external VFS across Sips, Shuf and Lua Pandoc in workerd (%s)",async mode=>{
  const builtins=new Set(builtinModules.flatMap(name=>[name,`node:${name}`]));
  const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL("../",import.meta.url)),contents:`
    export * as pandoc from "safe-bash-command-pandoc";
    export {createPandocCommand} from "safe-bash-command-pandoc/command";
    export * as sips from "safe-bash-command-sips";
    export * as shuf from "safe-bash-command-shuf";
    export {createCommandArguments} from "safe-bash-contracts/command";
    export {MemoryFileSystem} from "@poe-code/safe-fs/core";
    export {createR2PagedFixture} from "./scripts/pandoc-r2-storage.fixture.mjs";
  `},bundle:true,platform:"browser",conditions:["workerd"],format:"cjs",write:false,metafile:true,logLevel:"silent",
    plugins:[{name:"reject-node-builtins",setup(builder){builder.onResolve({filter:/.*/},args=>{
      if(builtins.has(args.path)||args.path.startsWith("node:"))return {errors:[{text:"Forbidden Node import: "+args.path}]};
      return undefined;
    });}}]});
  expect(Object.keys(bundle.metafile!.inputs).filter(path=>path.includes("/src/"))).toEqual([]);
  const runtime=new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,r2Buckets:["PAGES"],script:`
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request,env){
      const mode=new URL(request.url).pathname.slice(1),encoder=new TextEncoder(),decoder=new TextDecoder();
      const namespace=new api.MemoryFileSystem();await namespace.mkdir('/spill');
      const segment=(marker,data)=>[255,marker,(data.length+2)>>>8,(data.length+2)&255,...data];
      const image=new Uint8Array([255,216,...segment(219,[0,...Array(64).fill(1)]),...segment(192,[8,0,1,0,1,1,1,0x11,0]),...segment(196,[0,1,...Array(15).fill(0),0,16,1,...Array(15).fill(0),0]),...segment(218,[1,1,0,0,63,0]),0x3f,255,217]);
      const files={
        '/spill/image.jpg':image,
        '/documents.jsonl':encoder.encode(['alpha','beta','gamma'].map(word=>JSON.stringify({'pandoc-api-version':[1,23,1,2],meta:{},blocks:[{t:'Para',c:[{t:'Quoted',c:[{t:'DoubleQuote'},[{t:'Str',c:word}]]}]}]})).join(String.fromCharCode(10))+String.fromCharCode(10)),
        '/filter.lua':encoder.encode('function Str(el) el.text=string.upper(el.text); return el end; function Pandoc(doc) table.insert(doc.blocks,pandoc.Para({pandoc.Image({},"image.jpg")})); return doc end')
      };
      for(const [path,bytes] of Object.entries(files)){await namespace.writeFile(path,new Uint8Array());await env.PAGES.put(path,bytes);}
      const {fs:backing,events}=api.createR2PagedFixture(namespace,env.PAGES);
      const reads=[],opened=[],closed=[];let largestRead=0;
      const openRead=async(path,options)=>{
        options?.signal?.throwIfAborted();
        const object=await env.PAGES.head(path);if(!object)throw new Error('Unexpected external file '+path);
        const receipt=await namespace.openReadFile(path,options);opened.push(path);let closing;
        return {async stat(){return {...await receipt.stat(),size:object.size};},
          async read(position,length,options){
            options?.signal?.throwIfAborted();if(closing)throw new Error('Read after close');
            const count=Math.min(length,16384,Math.max(0,object.size-position));if(!count)return new Uint8Array();
            const part=await env.PAGES.get(path,{range:{offset:position,length:count},onlyIf:{etagMatches:object.etag}});
            if(!part?.body)throw new Error('Source identity changed');
            const bytes=new Uint8Array(await part.arrayBuffer());reads.push(path);largestRead=Math.max(largestRead,bytes.length);return bytes;
          },close(){return closing??=(async()=>{await receipt.close();closed.push(path);})();}};
      };
      const fs=new Proxy(backing,{get(target,key){
        if(key==='openReadFile')return openRead;
        if(key==='readStream')return async function*(path,options){const handle=await openRead(path,options);try{let position=0;for(;;){const bytes=await handle.read(position,16384,options);if(!bytes.length)return;position+=bytes.length;yield bytes;}}finally{await handle.close();}};
        if(key==='stat')return async(path,options)=>{const stat=await namespace.stat(path,options);const object=await env.PAGES.head(path);return object?{...stat,size:object.size}:stat;};
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      const controller=new AbortController();
      const commandContext=(name,args,stdout,stdin=(async function*(){})())=>{
        const values=api.createCommandArguments(args);
        return {command:name,args:values.args,argumentValues:values,cwd:'/spill',env:{TMPDIR:'/spill'},fs,signal:controller.signal,stdin,stdout,stderr:{async write(bytes){throw new Error(decoder.decode(bytes));}}};
      };
      let properties='';const propertyOutput={async write(bytes){properties+=decoder.decode(bytes);}};
      if(mode==='sdk'){
        const result=await api.sips.runSipsCli(['-g','pixelWidth','-g','pixelHeight','/spill/image.jpg'],{filesystem:fs,cwd:'/spill'},controller.signal);
        if(result.exitCode!==0||result.stderr)throw new Error('Sips failed');properties=result.stdout;
      }else if((await api.sips.createSipsCommand().execute(commandContext('sips',['-g','pixelWidth','-g','pixelHeight','/spill/image.jpg'],propertyOutput))).exitCode!==0)throw new Error('Sips failed');
      const pipe=new TransformStream(),writer=pipe.writable.getWriter();let pending=0,peakPending=0;
      const shuffle=(async()=>{
        try{const result=await api.shuf.createShufCommand().execute(commandContext('shuf',['-n','1','/documents.jsonl'],{async write(bytes){pending++;peakPending=Math.max(peakPending,pending);try{await writer.write(bytes.slice());}finally{pending--;}}}));
          if(result.exitCode!==0)throw new Error('Shuf failed');await writer.close();
        }catch(error){await writer.abort(error);throw error;}
      })();
      const input=(async function*(){const reader=pipe.readable.getReader();try{for(;;){const part=await reader.read();if(part.done)return;yield part.value;}}finally{await reader.cancel();reader.releaseLock();}})();
      let length=0,largest=0,output='';
      const sink={async write(bytes){await scheduler.wait(1);length+=bytes.length;largest=Math.max(largest,bytes.length);output+=decoder.decode(bytes);},async close(){},async abort(){}};
      const convert=(async()=>{
        if(mode==='sdk'){
          const filters=api.pandoc.createLuaFilterCapability({readStream:(path,signal)=>fs.readStream(path,{signal})});
          filters.apply=async()=>{throw new Error('Resident filter forbidden');};
          await api.pandoc.convertToOutput([{chunks:input}],{from:'json',to:'rtf',filters:[{kind:'lua',path:'/filter.lua'}]},{filters,workingFiles:{fs,directory:'/spill',cacheBytes:1048576},resourceFiles:fs,resourceCwd:'/spill',output:sink});
        }else if((await api.createPandocCommand().execute(commandContext('pandoc',['-fjson','-trtf','-L','/filter.lua'],sink,input))).exitCode!==0)throw new Error('Pandoc failed');
      })();
      await Promise.all([shuffle,convert]);
      for(const path of Object.keys(files)){await env.PAGES.delete(path);await namespace.unlink(path);}
      return Response.json({hostGlobals:[typeof process,typeof require,typeof Buffer],properties,length,largest,peakPending,hasSelectedDocument:['ALPHA','BETA','GAMMA'].filter(word=>output.includes(word)).length===1,hasImage:output.includes('\\\\jpegblip'),reads,opened,closed,largestRead,events,
        remaining:(await env.PAGES.list({limit:1})).objects.length,namespace:await namespace.readdir('/spill')});
    }};
  `});
  try {
    const response=await runtime.dispatchFetch('https://composed.test/'+mode);
    expect(response.status,response.status===200?undefined:await response.text()).toBe(200);
    const result=await response.json() as {properties:string;length:number;largest:number;reads:string[];opened:string[];closed:string[];largestRead:number;events:{opened:number;closed:number;writes:number}};
    expect(result).toMatchObject({hostGlobals:["undefined","undefined","undefined"],remaining:0,namespace:[],peakPending:1,hasSelectedDocument:true,hasImage:true});
    expect(result.properties).toContain('pixelWidth: 1');expect(result.properties).toContain('pixelHeight: 1');
    expect(new Set(result.reads)).toEqual(new Set(['/spill/image.jpg','/documents.jsonl','/filter.lua']));
    expect(result.opened.slice().sort()).toEqual(result.closed.slice().sort());
    expect(result.opened.filter(path=>path==='/spill/image.jpg').length).toBeGreaterThanOrEqual(2);
    expect(result.largestRead).toBeLessThanOrEqual(16384);expect(result.largest).toBeLessThanOrEqual(16384);expect(result.length).toBeGreaterThan(100);
    expect(result.events.opened).toBeGreaterThan(0);expect(result.events.closed).toBe(result.events.opened);expect(result.events.writes).toBeGreaterThan(0);
  }finally{await runtime.dispose();}
},60000);
