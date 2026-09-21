// Package only our additive Rust family hosts, sharing a single native addon.
import ts from 'typescript';
import {mkdirSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
const root=new URL('../',import.meta.url),dist=new URL('dist/',root);
mkdirSync(dist,{recursive:true});
function embed(source,destination,binary,depth=0){
 mkdirSync(destination,{recursive:true});
 for(const entry of readdirSync(source,{withFileTypes:true})){
  if(entry.isDirectory()){embed(new URL(entry.name+'/',source),new URL(entry.name+'/',destination),binary,depth+1);continue;}
  if(!entry.name.endsWith('.js')&&!entry.name.endsWith('.d.ts')||entry.name==='native.d.ts')continue;
  if(depth===0&&['testing.js','testing.d.ts','cli.js','cli.d.ts'].includes(entry.name)){rmSync(new URL(entry.name,destination),{force:true});continue;}
  const file=ts.createSourceFile(entry.name,readFileSync(new URL(entry.name,source),'utf8'),ts.ScriptTarget.Latest,true,entry.name.endsWith('.d.ts')?ts.ScriptKind.TS:ts.ScriptKind.JS);
  const result=ts.transform(file,[context=>node=>{
   function visit(current){if(ts.isStringLiteral(current)&&current.text==='tiny-stdio-mcp-server-rust')return ts.factory.createStringLiteral((depth===0?'./':'../'.repeat(depth))+'stdio-server.js');if(ts.isStringLiteral(current)&&current.text.endsWith(binary))return ts.factory.createStringLiteral('../'.repeat(depth+1)+'tiny-http-mcp-oauth-test-server-rust.node');return ts.visitEachChild(current,visit,context);}
   return ts.visitNode(node,visit);
  }]);
  const content=ts.createPrinter().printFile(result.transformed[0]);result.dispose();
  writeFileSync(new URL(entry.name,destination),content);
 }
}
embed(new URL('../../tiny-http-mcp-server-rust/dist/',import.meta.url),new URL('http/',dist),'tiny-http-mcp-server-rust.node');
embed(new URL('../../tiny-oauth-test-server-rust/dist/',import.meta.url),new URL('oauth/',dist),'tiny-oauth-test-server-rust.node');
for(const name of readdirSync(new URL('src/',root)))if(name.endsWith('.d.ts'))writeFileSync(new URL(name,dist),readFileSync(new URL('src/'+name,root)));
