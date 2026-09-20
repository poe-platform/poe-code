import {defineConfig} from 'vitest/config';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../agent-defs/src/',import.meta.url)),native=fileURLToPath(new URL('./dist/index.js',import.meta.url));
export default defineConfig({
 root:fileURLToPath(new URL('../../',import.meta.url)),
 plugins:[{name:'rust-agent-catalog-contracts',enforce:'pre',resolveId(source,importer){
  if(importer?.startsWith(root)&&['./index.js','./specifier.js','./gemini-cli.js'].includes(source))return native;
 },transform(code,id){if(id.startsWith(root)&&id.endsWith('/agent-defs.test.ts'))return {code:code+`\nimport {allAgents as nativeContract} from ${JSON.stringify(native)};if(allAgents!==nativeContract)throw new Error('Catalog contracts must execute own native artifact');`,map:null};}}],
 test:{include:['packages/agent-defs/src/**/*.test.ts'],cache:false,testTimeout:2000}
});
