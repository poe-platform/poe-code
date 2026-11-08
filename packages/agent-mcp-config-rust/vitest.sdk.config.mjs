import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
const root=new URL('./',import.meta.url),source=fileURLToPath(new URL('../agent-mcp-config/src/agent-mcp-config.test.ts',root));
const replacements=new Map([
 ['./apply.js','apply.js'],['./configs.js','configs.js'],['./shapes.js','shapes.js'],['@poe-code/config-mutations/testing','config/testing.js'],
].map(([name,target])=>[name,fileURLToPath(new URL('dist/'+target,root))]));
export default defineConfig({
 plugins:[{name:'own-rust-agent-mcp-sdk-oracle',enforce:'pre',resolveId(name,importer){if(importer===source)return replacements.get(name)??null;}}],
 test:{include:[source],environment:'node',fileParallelism:false,maxWorkers:1,pool:'forks',testTimeout:2000,cache:false},
});
