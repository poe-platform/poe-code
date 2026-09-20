import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
const root=new URL('./',import.meta.url);
const sources=['configs','event-mapping','transform-hooks','read-hooks','write-hooks'].map(name=>fileURLToPath(new URL(`../agent-hook-config/src/${name}.test.ts`,root)));
export default defineConfig({plugins:[{name:'own-rust-hook-sdk-oracle',enforce:'pre',resolveId(name,importer){if(sources.includes(importer)&&['./index.js','./configs.js','./event-mapping.js','./transform-hooks.js','./read-hooks.js','./write-hooks.js'].includes(name))return fileURLToPath(new URL('dist/index.js',root));}}],test:{include:sources,environment:'node',fileParallelism:false,maxWorkers:1,pool:'forks',testTimeout:2000,cache:false}});
