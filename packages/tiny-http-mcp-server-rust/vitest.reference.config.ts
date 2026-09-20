import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
const referenceRoot=fileURLToPath(new URL('../tiny-http-mcp-server/src/',import.meta.url));
export default defineConfig({
 root:fileURLToPath(new URL('../../',import.meta.url)),
 plugins:[{name:'rust-http-primitives-conformance',enforce:'pre',resolveId(source,importer){
  if(importer?.endsWith('/tiny-http-mcp-server/vitest.setup.ts')&&source==='./src/test-support.js')return fileURLToPath(new URL('./dist/test-support.js',import.meta.url));
  if(!importer?.startsWith(referenceRoot))return;
  if(source==='tiny-stdio-mcp-server')return fileURLToPath(new URL('./dist/stdio-server.js',import.meta.url));
  if(source==='./testing.js')return fileURLToPath(new URL('./dist/testing.js',import.meta.url));
  if(['./test-support.js','./parse-body.js','./modern-headers.js','./http-server.js','./index.js','./http-transport.js','./auth.js','./session.js','./sse.js','./express-middleware.js'].includes(source))return fileURLToPath(new URL(`./dist/${source.slice(2)}`,import.meta.url));
 },transform(code,id){
  if(!id.startsWith(referenceRoot)||!id.endsWith('.test.ts'))return;
  if(id.endsWith('/test-support.import-isolation.test.ts'))return {code:code+`\nimport {nodeFetch as nativeContract} from ${JSON.stringify(fileURLToPath(new URL('./dist/test-support.js',import.meta.url)))};\nimport {nodeFetch as contract} from './test-support.js';\nif(contract!==nativeContract)throw new Error('Test support contracts must execute own native artifact');`,map:null};
  if(id.endsWith('/testing.regression.test.ts'))return {code:code+`\nimport {createInMemoryTokenVerifier as nativeContract} from ${JSON.stringify(fileURLToPath(new URL('./dist/testing.js',import.meta.url)))};\nif(createInMemoryTokenVerifier!==nativeContract)throw new Error('Testing contracts must execute native artifact');`,map:null};
  if(id.endsWith('/testing.lifecycle.test.ts'))return {code:code+`\nimport {createHttpTestPair as nativeContract} from ${JSON.stringify(fileURLToPath(new URL('./dist/testing.js',import.meta.url)))};\nif(createHttpTestPair!==nativeContract)throw new Error('Testing pair lifecycle must execute own artifact');`,map:null};
  if(id.endsWith('/oauth.test.ts'))code+=`\nimport {createInMemoryTokenVerifier as nativeTokenVerifier} from ${JSON.stringify(fileURLToPath(new URL('./dist/testing.js',import.meta.url)))};\nif(createInMemoryTokenVerifier!==nativeTokenVerifier)throw new Error('OAuth fixture contracts must execute native test tokens');`;
  const fn=id.endsWith('/body-utf8.test.ts')?'readAndClassifyBody':id.endsWith('/modern-headers.test.ts')?'validateModernHeaders':id.endsWith('/modern-backpressure.test.ts')||id.endsWith('/response-size.test.ts')?'StreamableHttpTransport':'createHttpServer';
  const file=fn==='readAndClassifyBody'?'parse-body.js':fn==='validateModernHeaders'?'modern-headers.js':'index.js';
  const target=fileURLToPath(new URL(`./dist/${file}`,import.meta.url));
  return {code:code+`\nimport {${fn} as nativeContract} from ${JSON.stringify(target)};\nif(${fn}!==nativeContract)throw new Error('HTTP primitive contracts must execute Rust');`,map:null};
 }}],
 test:{include:['packages/tiny-http-mcp-server/src/{body-utf8,modern-headers,modern-http,modern-streams,modern-backpressure,parameter-headers,handler-context,notification-history-size,response-size,http-server.lifecycle,protocol-features,production-readiness,structured-output-interop,oauth,testing.regression,testing.lifecycle,test-support.import-isolation}.test.ts','packages/tiny-http-mcp-server-rust/tests/sdk-development-oracle.test.ts'],cache:false,testTimeout:2000}
});
