import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const referenceRoot=fileURLToPath(new URL('../tiny-stdio-mcp-test-server/src/',import.meta.url)),native=fileURLToPath(new URL('./dist/index.js',import.meta.url)),cli=fileURLToPath(new URL('./dist/cli.js',import.meta.url));
export default defineConfig({
 root:fileURLToPath(new URL('../../',import.meta.url)),
 plugins:[{name:'rust-stdio-fixture-contracts',enforce:'pre',resolveId(source,importer){
  if(!importer?.startsWith(referenceRoot))return;
  if(source==='./index.js')return native;
  if(source==='./cli-support.js')return fileURLToPath(new URL('./dist/cli-support.js',import.meta.url));
 },transform(code,id){
  if(!id.startsWith(referenceRoot)||!id.endsWith('.test.ts'))return;
  if(id.endsWith('/cli.test.ts')){
   const file=ts.createSourceFile(id,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),result=ts.transform(file,[context=>root=>ts.visitNode(root,function visit(node){
    if(ts.isStringLiteral(node)&&node.text==='src/cli.ts')return ts.factory.createStringLiteral(cli);
    return ts.visitEachChild(node,visit,context);
   })]);
   try{return {code:ts.createPrinter().printFile(result.transformed[0]),map:null};}finally{result.dispose();}
  }
  return {code:code+`\nimport {createTestServer as nativeContract} from ${JSON.stringify(native)};\nif(createTestServer!==nativeContract)throw new Error('Fixture contracts must execute own native artifact');`,map:null};
 }}],
 test:{include:['packages/tiny-stdio-mcp-test-server/src/*.test.ts','packages/tiny-stdio-mcp-test-server-rust/tests/*.test.ts'],cache:false,testTimeout:2000}
});
