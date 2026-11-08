import ts from 'typescript';
import {mkdirSync,readFileSync,writeFileSync,readdirSync,copyFileSync} from 'node:fs';
const root=new URL('../',import.meta.url),dist=new URL('dist/',root);
mkdirSync(dist,{recursive:true});
for(const library of ['terminal-pilot-rust','tiny-stdio-mcp-server-rust']){
 const source=new URL('../'+library+'/src/',root);
 for(const name of readdirSync(source)){
  if(!name.endsWith('.js')&&!name.endsWith('.d.ts'))continue;
  const target=name.startsWith('index.')?(library==='terminal-pilot-rust'?'pilot':'stdio-server')+name.slice(5):name;
  const ast=ts.createSourceFile(target,readFileSync(new URL(name,source),'utf8'),ts.ScriptTarget.Latest,true,name.endsWith('.d.ts')?ts.ScriptKind.TS:ts.ScriptKind.JS);
  const result=ts.transform(ast,[context=>node=>{
   const visit=current=>{
    if(ts.isStringLiteral(current)){
     if(current.text==='./'+library+'.node')return ts.factory.createStringLiteral('./terminal-pilot-mcp-rust.node');
     if(library==='terminal-pilot-rust'&&current.text==='./index.js')return ts.factory.createStringLiteral('./pilot.js');
    }
    return ts.visitEachChild(current,visit,context);
   };
   return ts.visitNode(node,visit);
  }]);
  writeFileSync(new URL(target,dist),ts.createPrinter().printFile(result.transformed[0]));result.dispose();
 }
}
for(const name of readdirSync(new URL('src/',root)))if(name.endsWith('.d.ts'))copyFileSync(new URL('src/'+name,root),new URL(name,dist));
for(const name of ['LICENSE','LICENSE.FONT','LICENSE.UNICODE'])copyFileSync(new URL('../terminal-pilot-rust/'+name,root),new URL(name,root));
