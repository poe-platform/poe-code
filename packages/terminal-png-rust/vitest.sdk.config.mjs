import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
const root=new URL('./',import.meta.url),path=name=>fileURLToPath(new URL(name,root)),sources=['index','renderers','cli'].map(name=>path('../terminal-png/src/'+name+'.test.ts'));
export default defineConfig({plugins:[{name:'own-rust-terminal-oracle',enforce:'pre',resolveId(name,importer){if(sources.includes(importer)&&['./index.js','./ansi-parser.js','./svg-renderer.js','./png-renderer.js','./font.js','./cli.js'].includes(name))return path('dist/'+name.slice(2));}}],test:{include:sources,environment:'node',fileParallelism:false,maxWorkers:1,pool:'forks',testTimeout:3000,cache:false}});
