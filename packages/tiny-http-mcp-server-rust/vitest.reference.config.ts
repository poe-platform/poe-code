import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
const referenceRoot=fileURLToPath(new URL('../tiny-http-mcp-server/src/',import.meta.url));
export default defineConfig({
 root:fileURLToPath(new URL('../../',import.meta.url)),
 plugins:[{name:'rust-http-primitives-conformance',enforce:'pre',resolveId(source,importer){
  if(!importer?.startsWith(referenceRoot))return;
  if(source==='tiny-stdio-mcp-server')return fileURLToPath(new URL('./dist/stdio-server.js',import.meta.url));
  if(['./parse-body.js','./modern-headers.js','./http-server.js','./index.js','./http-transport.js','./auth.js','./session.js','./sse.js','./express-middleware.js'].includes(source))return fileURLToPath(new URL(`./dist/${source.slice(2)}`,import.meta.url));
 },transform(code,id){
  if(!id.startsWith(referenceRoot)||!id.endsWith('.test.ts'))return;
  const fn=id.endsWith('/body-utf8.test.ts')?'readAndClassifyBody':id.endsWith('/modern-headers.test.ts')?'validateModernHeaders':id.endsWith('/modern-backpressure.test.ts')||id.endsWith('/response-size.test.ts')?'StreamableHttpTransport':'createHttpServer';
  const file=fn==='readAndClassifyBody'?'parse-body.js':fn==='validateModernHeaders'?'modern-headers.js':'index.js';
  const target=fileURLToPath(new URL(`./dist/${file}`,import.meta.url));
  return {code:code+`\nimport {${fn} as nativeContract} from ${JSON.stringify(target)};\nif(${fn}!==nativeContract)throw new Error('HTTP primitive contracts must execute Rust');`,map:null};
 }}],
 test:{include:['packages/tiny-http-mcp-server/src/{body-utf8,modern-headers,modern-http,modern-streams,modern-backpressure,parameter-headers,handler-context,notification-history-size,response-size,http-server.lifecycle,protocol-features,production-readiness,structured-output-interop,oauth}.test.ts'],cache:false,testTimeout:2000}
});
