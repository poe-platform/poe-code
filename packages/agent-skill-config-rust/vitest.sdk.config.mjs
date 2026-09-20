import {defineConfig}from'vitest/config';import {fileURLToPath}from'node:url';
const root=new URL('./',import.meta.url),sources=['git-exclude','resolve-skill-reference','templates','agent-skill-config','bridge-active-skills'].map(name=>fileURLToPath(new URL(`../agent-skill-config/src/${name}.test.ts`,root)));
export default defineConfig({plugins:[{name:'own-rust-skill-sdk-oracle',enforce:'pre',resolveId(name,importer){if(sources.includes(importer)){if(name==='@poe-code/agent-skill-config')return fileURLToPath(new URL('dist/index.js',root));if(['./git-exclude.js','./resolve-skill-reference.js','./templates.js','./configs.js','./apply.js','./bridge-active-skills.js'].includes(name))return fileURLToPath(new URL('dist/'+name.slice(2),root));}},transform(code,id){
 // Preserve the SDK source location expected by its in-memory template fixture.
 if(id===fileURLToPath(new URL('dist/templates.js',root)))return code.replaceAll('import.meta.url',JSON.stringify(new URL('../agent-skill-config/src/templates.ts',root).href));
}}],test:{include:sources,environment:'node',fileParallelism:false,maxWorkers:1,pool:'forks',testTimeout:2000,cache:false}});
