import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const referenceRoot=fileURLToPath(new URL('../tiny-http-mcp-server/src/',import.meta.url));
export default defineConfig({
 root:fileURLToPath(new URL('../../',import.meta.url)),
 plugins:[{name:'rust-http-primitives-conformance',enforce:'pre',resolveId(source,importer){
  if(importer?.endsWith('/tiny-http-mcp-server/vitest.setup.ts')&&source==='./src/test-support.js')return fileURLToPath(new URL('./dist/test-support.js',import.meta.url));
  if(!importer?.startsWith(referenceRoot))return;
  if(source==='tiny-stdio-mcp-server')return fileURLToPath(new URL('./dist/stdio-server.js',import.meta.url));
  if(source==='./testing.js')return fileURLToPath(new URL('./dist/testing.js',import.meta.url));
  if(['./cli.js','./load-oauth-verifier.js','./test-support.js','./parse-body.js','./modern-headers.js','./http-server.js','./index.js','./http-transport.js','./auth.js','./session.js','./sse.js','./express-middleware.js'].includes(source))return fileURLToPath(new URL(`./dist/${source.slice(2)}`,import.meta.url));
 },transform(code,id){
  if(!id.startsWith(referenceRoot)||!id.endsWith('.test.ts'))return;
  if(id.endsWith('/tiny-http-mcp-server.test.ts')){
   // Only the advertised command name differs for the additive -rust binary.
   const file=ts.createSourceFile(id,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
   const transformed=ts.transform(file,[context=>root=>ts.visitNode(root,function visit(node){
    if(ts.isStringLiteral(node)&&node.text==='Usage: tiny-http-mcp-server [options]')return ts.factory.createStringLiteral('Usage: tiny-http-mcp-server-rust [options]');
    return ts.visitEachChild(node,visit,context);
   })]);
   try{code=ts.createPrinter().printFile(transformed.transformed[0]);}finally{transformed.dispose();}
   code+=`\nimport {runCli as nativeCli} from ${JSON.stringify(fileURLToPath(new URL('./dist/cli.js',import.meta.url)))};\nif(runCli!==nativeCli)throw new Error('CLI contracts must execute own native artifact');`;
  }
  if(id.endsWith('/load-oauth-verifier.test.ts'))return {code:code+`\nimport {loadOAuthVerifier as nativeContract} from ${JSON.stringify(fileURLToPath(new URL('./dist/load-oauth-verifier.js',import.meta.url)))};\nif(loadOAuthVerifier!==nativeContract)throw new Error('Verifier loader contracts must execute own artifact');`,map:null};
  if(id.endsWith('/path.regression.test.ts'))return {code:code+`\nimport {createTestMcpServer as nativeContract} from ${JSON.stringify(fileURLToPath(new URL('./dist/testing.js',import.meta.url)))};\nif(createTestMcpServer!==nativeContract)throw new Error('Path contracts must execute own native fixture');`,map:null};
  if(id.endsWith('/test-support.import-isolation.test.ts'))return {code:code+`\nimport {nodeFetch as nativeContract} from ${JSON.stringify(fileURLToPath(new URL('./dist/test-support.js',import.meta.url)))};\nimport {nodeFetch as contract} from './test-support.js';\nif(contract!==nativeContract)throw new Error('Test support contracts must execute own native artifact');`,map:null};
  if(id.endsWith('/testing.regression.test.ts'))return {code:code+`\nimport {createInMemoryTokenVerifier as nativeContract} from ${JSON.stringify(fileURLToPath(new URL('./dist/testing.js',import.meta.url)))};\nif(createInMemoryTokenVerifier!==nativeContract)throw new Error('Testing contracts must execute native artifact');`,map:null};
  if(id.endsWith('/testing.lifecycle.test.ts'))return {code:code+`\nimport {createHttpTestPair as nativeContract} from ${JSON.stringify(fileURLToPath(new URL('./dist/testing.js',import.meta.url)))};\nif(createHttpTestPair!==nativeContract)throw new Error('Testing pair lifecycle must execute own artifact');`,map:null};
  if(id.endsWith('/oauth.test.ts'))code+=`\nimport {createInMemoryTokenVerifier as nativeTokenVerifier} from ${JSON.stringify(fileURLToPath(new URL('./dist/testing.js',import.meta.url)))};\nif(createInMemoryTokenVerifier!==nativeTokenVerifier)throw new Error('OAuth fixture contracts must execute native test tokens');`;
  const fn=id.endsWith('/body-utf8.test.ts')?'readAndClassifyBody':id.endsWith('/modern-headers.test.ts')?'validateModernHeaders':id.endsWith('/modern-backpressure.test.ts')||id.endsWith('/response-size.test.ts')?'StreamableHttpTransport':'createHttpServer';
  const file=fn==='readAndClassifyBody'?'parse-body.js':fn==='validateModernHeaders'?'modern-headers.js':'index.js';
  const target=fileURLToPath(new URL(`./dist/${file}`,import.meta.url));
  return {code:code+`\nimport {${fn} as nativeContract} from ${JSON.stringify(target)};\nif(${fn}!==nativeContract)throw new Error('HTTP primitive contracts must execute Rust');`,map:null};
 }}],
 test:{include:['packages/tiny-http-mcp-server/src/{tiny-http-mcp-server,body-utf8,modern-headers,modern-http,modern-streams,modern-backpressure,parameter-headers,handler-context,notification-history-size,response-size,http-server.lifecycle,protocol-features,production-readiness,structured-output-interop,oauth,testing.regression,testing.lifecycle,test-support.import-isolation,path.regression,load-oauth-verifier}.test.ts','packages/tiny-http-mcp-server-rust/tests/sdk-development-oracle.test.ts'],cache:false,testTimeout:2000}
});
