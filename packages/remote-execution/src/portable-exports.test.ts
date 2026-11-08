import{fileURLToPath}from'node:url';import{build}from'esbuild';import{expect,it}from'vitest';
it('bundles every portable public runtime export without Node/server/native launcher modules',async()=>{
 const result=await build({entryPoints:[fileURLToPath(new URL('./index.ts',import.meta.url))],platform:'browser',format:'esm',bundle:true,write:false,metafile:true,logLevel:'silent'});
 expect(Object.keys(result.metafile!.inputs).filter(path=>path.endsWith('/native-process.ts')||path.endsWith('/media-server.ts')||path.endsWith('/http-server.ts'))).toEqual([]);
 expect(result.outputFiles!.length).toBe(1);
});
