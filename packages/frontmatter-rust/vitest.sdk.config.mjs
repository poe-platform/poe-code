import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
const root=new URL('./',import.meta.url),source=fileURLToPath(new URL('../frontmatter/src/frontmatter.test.ts',root)),native=fileURLToPath(new URL('dist/index.js',root));
export default defineConfig({plugins:[{name:'own-rust-frontmatter-sdk-oracle',enforce:'pre',resolveId(name,importer){if(importer===source&&name==='./index.js')return native;}}],test:{include:[source],environment:'node',fileParallelism:false,maxWorkers:1,pool:'forks',testTimeout:2000,cache:false}});
