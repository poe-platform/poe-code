import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
const root=new URL('./',import.meta.url),sources=['parse','merge','discover','resolve','prompt-document'].map(name=>fileURLToPath(new URL(`../config-extends/src/${name}.test.ts`,root))),native=fileURLToPath(new URL('dist/index.js',root));
export default defineConfig({plugins:[{name:'own-rust-config-extends-sdk-oracle',enforce:'pre',resolveId(name,importer){if(sources.includes(importer)&&['./parse.js','./merge.js','./discover.js','./resolve.js','./prompt-document.js'].includes(name))return native;}}],test:{include:sources,environment:'node',fileParallelism:false,maxWorkers:1,pool:'forks',testTimeout:2000,cache:false}});
