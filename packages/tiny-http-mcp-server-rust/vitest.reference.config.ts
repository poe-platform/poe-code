import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
const referenceRoot=fileURLToPath(new URL('../tiny-http-mcp-server/src/',import.meta.url));
export default defineConfig({
 root:fileURLToPath(new URL('../../',import.meta.url)),
 plugins:[{name:'rust-http-primitives-conformance',enforce:'pre',resolveId(source,importer){
  if(!importer?.startsWith(referenceRoot))return;
  if(source==='./parse-body.js'||source==='./modern-headers.js')return fileURLToPath(new URL(`./dist/${source.slice(2)}`,import.meta.url));
 },transform(code,id){
  if(!id.startsWith(referenceRoot)||!id.endsWith('.test.ts'))return;
  const fn=id.endsWith('/body-utf8.test.ts')?'readAndClassifyBody':'validateModernHeaders';
  const file=fn==='readAndClassifyBody'?'parse-body.js':'modern-headers.js';
  const target=fileURLToPath(new URL(`./dist/${file}`,import.meta.url));
  return {code:code+`\nimport {${fn} as nativeContract} from ${JSON.stringify(target)};\nif(${fn}!==nativeContract)throw new Error('HTTP primitive contracts must execute Rust');`,map:null};
 }}],
 test:{include:['packages/tiny-http-mcp-server/src/body-utf8.test.ts','packages/tiny-http-mcp-server/src/modern-headers.test.ts'],cache:false,testTimeout:2000}
});
