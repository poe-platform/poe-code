import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
const root=new URL('./',import.meta.url),original=new URL('../config-mutations/src/',root);
const source=fileURLToPath(new URL('config-mutations.test.ts',original)),utilities=fileURLToPath(new URL('fs-utils.test.ts',original));
const replacements=new Map([
 ['./types.js','index.js'],['./formats/index.js','formats.js'],['./formats/json.js','json.js'],
 ['./execution/run-mutations.js','execution.js'],['./mutations/config-mutation.js','execution.js'],
 ['./mutations/file-mutation.js','execution.js'],['./mutations/template-mutation.js','execution.js'],
 ['./testing/mock-fs.js','testing.js'],['./testing/format-utils.js','testing.js'],['./fs-utils.js','fs-utils.js'],
].map(([name,target])=>[name,fileURLToPath(new URL('dist/'+target,root))]));
export default defineConfig({
 plugins:[{name:'own-rust-config-sdk-oracle',enforce:'pre',resolveId(name,importer){if(importer===source||importer===utilities)return replacements.get(name)??null;}}],
 test:{include:[source,utilities],environment:'node',fileParallelism:false,maxWorkers:1,pool:'forks',testTimeout:2000,cache:false},
});
