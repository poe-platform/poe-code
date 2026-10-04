import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {expect,it} from "vitest";
it.each(["sdk-rtf","sdk-odt","command-rtf","command-odt","sdk-html","command-html"].flatMap(mode => ["json", "rtf", "csv", "tsv"].map(from => [mode, from] as const)))("preserves Lua image resources with R2 storage (%s from %s)",async (mode,from)=>{
  const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL("../",import.meta.url)),contents:`
    export {convertToOutput,createLuaFilterCapability} from "./packages/safe-bash-command-pandoc/dist/index.js";
    export {createPandocCommand} from "./packages/safe-bash-command-pandoc/dist/command.js";
    export {MemoryFileSystem} from "./packages/safe-fs/src/core.ts";
    export {createR2PagedFixture} from "./scripts/pandoc-r2-storage.fixture.mjs";
  `},bundle:true,platform:"browser",conditions:["workerd"],format:"cjs",write:false,logLevel:"silent"});
  const runtime=new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,r2Buckets:["PAGES"],script:`
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request,env){
      const [mode,to]=new URL(request.url).pathname.slice(1).split('-'),encoder=new TextEncoder();
      const namespace=new api.MemoryFileSystem();for(const path of ['/spill','/doc','/cwd'])await namespace.mkdir(path);
      for(const path of ['/doc/a.jpg','/cwd/a.jpg','/filter.lua','/doc/input.json'])await namespace.writeFile(path,new Uint8Array());
      const {fs:backing,events}=api.createR2PagedFixture(namespace,env.PAGES);
      const segment=(marker,data)=>[255,marker,(data.length+2)>>>8,(data.length+2)&255,...data];
      const picture=new Uint8Array([255,216,...segment(219,[0,...Array(64).fill(1)]),...segment(192,[8,0,1,0,1,1,1,0x11,0]),...segment(196,[0,1,...Array(15).fill(0),0,16,1,...Array(15).fill(0),0]),...segment(218,[1,1,0,0,63,0]),0x3f,255,217]);
      const image=url=>({t:'Image',c:[['',[],[]],[],[url,'']]});
      const from=${JSON.stringify(from)}, slash=String.fromCharCode(92);
      const input=encoder.encode(from==='rtf'?'{'+slash+'rtf1{'+slash+'pict'+slash+'jpegblip '+Array.from(picture,byte=>byte.toString(16).padStart(2,'0')).join('')+'}}':from==='json'?JSON.stringify({'pandoc-api-version':[1,23,1,2],meta:{},blocks:[{t:'Para',c:[image('a.jpg'),image('b.jpg')]}]}):'head\\nvalue');
      const script=encoder.encode(from==='rtf'?"function Image(el) return {el,el} end":from==='json'?"function Image(el) if el.src=='b.jpg' then el.src='a.jpg' end; return el end":"function Pandoc(doc) doc.blocks={pandoc.Para({pandoc.Image({}, 'a.jpg')})}; return doc end");
      const files={'/doc/a.jpg':picture,'/cwd/a.jpg':picture,'/filter.lua':script,'/doc/input.json':input};
      for(const [path,bytes] of Object.entries(files))await env.PAGES.put(path,bytes);
      const reads=[];
      const fs=new Proxy(backing,{get(target,key){if(key==='readStream')return async function*(path){reads.push(path);const object=await env.PAGES.get(path);if(!object)throw new Error('Unexpected source '+path);yield* object.body;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
      let length=0,largest=0,closed=0;
      const output={async write(bytes){length+=bytes.length;largest=Math.max(largest,bytes.length);},async close(){closed++;},async abort(){}};
      const limits={text:100000,nodes:4096,depth:64,attributes:100,tableCells:20,resources:20,resourceBytes:1000000,glyphs:0,pages:0,objects:0,xmlDepth:0,xmlNodes:0,macros:0,directives:0,entities:0,entityBytes:0,yamlAliases:0,tableRows:2,tableColumns:1,tableFieldText:5,images:10,binaryBytes:100000,layoutWork:10000,parts:1000,compressedBytes:100000,expandedBytes:1000000};
      if(mode==='command') {
        const result=await api.createPandocCommand({limits}).execute({command:'pandoc',args:['-f'+from,'-t'+to,...(to==='html'?['--embed-resources']:[]),'-L','/filter.lua','/doc/input.json'],cwd:'/cwd',env:{TMPDIR:'/spill'},fs,signal:new AbortController().signal,stdin:(async function*(){})(),stdout:output,stderr:{async write(bytes){throw new Error(new TextDecoder().decode(bytes));}}});
        if(result.exitCode!==0)throw new Error('Command failed');closed++;
      } else {
        const filters=api.createLuaFilterCapability({readStream:(path,signal)=>fs.readStream(path,{signal})});
        filters.apply=async()=>{throw new Error('Resident Lua forbidden');};
        await api.convertToOutput([{base:'/doc',bytes:input}],{from,to,...(to==='html'?{embedResources:true}:{}),...(from==='json'?{metadata:{nested:{t:'MetaMap',c:{typed:{t:'MetaInlines',c:[image('a.jpg')]}}}}}:{}),filters:[{kind:'lua',path:'/filter.lua'}]},{limits,workingFiles:{fs,directory:'/spill',cacheBytes:1048576},resourceFiles:fs,resourceCwd:'/cwd',filters,output});
      }
      for(const path of Object.keys(files))await env.PAGES.delete(path);
      return Response.json({reads,length,largest,closed,events,remaining:(await env.PAGES.list({limit:1})).objects.length,namespace:await namespace.readdir('/spill')});
    }};
  `});
  try {
      const response=await runtime.dispatchFetch('https://lua.test/'+mode);
      expect(response.status,response.status===200?undefined:await response.text()).toBe(200);
      const result=await response.json() as {reads:string[];length:number;largest:number;events:{opened:number;closed:number;reads:number;writes:number}};
      expect(result).toMatchObject({closed:1,remaining:0,namespace:[]});
      expect(result.reads.filter(path=>path.endsWith('.jpg'))).toEqual(from === 'json' ? ['/doc/a.jpg','/cwd/a.jpg'] : from === 'rtf' ? [] : ['/cwd/a.jpg']);
      expect(result.length).toBeGreaterThan(100);expect(result.largest).toBeLessThanOrEqual(16384);
      expect(result.events.opened).toBeGreaterThan(0);expect(result.events.closed).toBe(result.events.opened);expect(result.events.reads).toBeGreaterThan(0);expect(result.events.writes).toBeGreaterThan(0);
  }finally{await runtime.dispose();}
},60_000);
