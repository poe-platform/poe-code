import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {expect,it} from "vitest";

it.each(["json", "rtf"])("runs shipped %s Lua SDK with caller R2 pages and no Node compatibility",async from=>{
  const input = from === "rtf" ? String.raw`{\rtf1 hello}` : JSON.stringify({"pandoc-api-version":[1,23,1,2],meta:{},blocks:[{t:"Para",c:[{t:"Str",c:"hello"}]}]});
  const root=fileURLToPath(new URL("../",import.meta.url));
  const bundle=await build({stdin:{resolveDir:root,contents:`
    export {convertToOutput,createLuaFilterCapability} from "./packages/safe-bash-command-pandoc/dist/index.js";
    export {createPandocCommand} from "./packages/safe-bash-command-pandoc/dist/command.js";
    export {MemoryFileSystem} from "./packages/safe-fs/src/core.ts";
    export {createR2PagedFixture} from "./scripts/pandoc-r2-storage.fixture.mjs";
  `},bundle:true,platform:"browser",conditions:["workerd"],format:"cjs",write:false,logLevel:"silent"});
  const runtime=new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,r2Buckets:["PAGES"],script:`
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request,env){
      const namespace=new api.MemoryFileSystem();await namespace.mkdir('/spill');
      const {fs,events}=api.createR2PagedFixture(namespace,env.PAGES),encoder=new TextEncoder();
      const command=new URL(request.url).pathname==='/command';
      const failure=new URL(request.url).pathname==='/error',borrowed=new URL(request.url).pathname==='/borrowed';
      let text="",length=0,largest=0,errorBytes=0,delivered,code,closed=0,reused=false;
      const filters=api.createLuaFilterCapability({...borrowed?{readFile(){const source=encoder.encode("function Str(el) return pandoc.Str(string.upper(el.text)) end");queueMicrotask(()=>queueMicrotask(()=>{source.fill(0);reused=true;}));return Promise.resolve(source);}}:{readStream:async function*(){yield encoder.encode(failure?"error(string.rep('x',17003),0)":"function Str(el) return pandoc.Str(string.upper(el.text)) end");}},async onError(error,message){delivered=error;for await(const bytes of message){errorBytes+=bytes.length;largest=Math.max(largest,bytes.length);}}});
      filters.apply=async()=>{throw new Error('Resident Lua forbidden');};
      if(command) {
        await namespace.writeFile('/filter.lua',new Uint8Array());
        await env.PAGES.put('source',encoder.encode("function Str(el) return pandoc.Str(string.upper(el.text)) end"));
        const supplied=new Proxy(fs,{get(target,key){if(key==='readStream')return async function*(path){if(path!=='/filter.lua')throw new Error('Unexpected read');const source=await env.PAGES.get('source');yield* source.body;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
        const result=await api.createPandocCommand().execute({command:'pandoc',args:['-f${from}','-tplain','-L','/filter.lua'],cwd:'/',env:{TMPDIR:'/spill'},fs:supplied,signal:new AbortController().signal,stdin:(async function*(){yield encoder.encode(${JSON.stringify(input)});})(),stdout:{async write(bytes){text+=new TextDecoder().decode(bytes);length+=bytes.length;largest=Math.max(largest,bytes.length);}},stderr:{async write(bytes){throw new Error(new TextDecoder().decode(bytes));}}});
        if(result.exitCode!==0)throw new Error('Command failed');closed++;
        await env.PAGES.delete('source');
      } else try {await api.convertToOutput([{bytes:encoder.encode(${JSON.stringify(input)})}],{from:'${from}',to:'plain',filters:[{kind:'lua',path:'/filter.lua'}]},{workingFiles:{fs,directory:'/spill',cacheBytes:1048576},filters,output:{async write(bytes){length+=bytes.length;largest=Math.max(largest,bytes.length);text+=new TextDecoder().decode(bytes);},async close(){closed++;},async abort(){}}});}
      catch(error){code=error.code;if(error!==delivered)throw error;}
      return Response.json({text,length,largest,errorBytes,code,closed,reused,events,remaining:(await env.PAGES.list({limit:1})).objects.length,namespace:await namespace.readdir('/spill')});
    }};
  `});
  try {
    for(const mode of ['success','error','command','borrowed']) {
      const response=await runtime.dispatchFetch('https://lua.test/'+mode);
      expect(response.status, response.status===200 ? undefined : await response.text()).toBe(200);
      const result=await response.json() as {events:{opened:number;closed:number;reads:number;writes:number};largest:number};
      expect(result).toMatchObject({remaining:0,namespace:[],reused:mode==='borrowed',...(mode!=='error'?{text:"HELLO\n",length:6,closed:1,errorBytes:0}:{length:0,closed:0,errorBytes:17003,code:'E_AST'})});
      expect(result.events.opened).toBeGreaterThan(0);expect(result.events.closed).toBe(result.events.opened);
      expect(result.events.reads).toBeGreaterThan(0);expect(result.events.writes).toBeGreaterThan(0);expect(result.largest).toBeLessThanOrEqual(8192);
    }
  }finally{await runtime.dispose();}
},60_000);
