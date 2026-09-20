// Embed the additive Rust family host primitives in this standalone addon package.
import ts from 'typescript';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,readdirSync} from 'node:fs';
const root=new URL('../',import.meta.url),source=new URL('../../tiny-stdio-mcp-server-rust/src/',import.meta.url),dist=new URL('dist/',root);
mkdirSync(dist,{recursive:true});
for(const [from,to] of [['index.js','stdio-server.js'],['media.js','media.js'],['stdio.js','stdio.js']]){
 const text=readFileSync(new URL(from,source),'utf8').replaceAll('tiny-stdio-mcp-server-rust.node','tiny-http-mcp-server-rust.node');
 writeFileSync(new URL(to,dist),text);
}
const declaration=ts.createSourceFile('stdio-server.d.ts',readFileSync(new URL('index.d.ts',source),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const statements=declaration.statements.map(statement=>{
 if(!ts.isInterfaceDeclaration(statement))return statement;
 let members=statement.members;
 if(statement.name.text==='MessageSession')members=members.filter(member=>!member.name||!['handleLine','handleSDKMessage'].includes(member.name.getText(declaration)));
 if(statement.name.text==='Server')members=members.filter(member=>!(member.name?.getText(declaration)==='connectSDK'&&ts.isMethodSignature(member)&&member.parameters[0]?.type?.getText(declaration)==='SDKCompatibleTransport'));
 return ts.factory.updateInterfaceDeclaration(statement,statement.modifiers,statement.name,statement.typeParameters,statement.heritageClauses,members);
});
writeFileSync(new URL('stdio-server.d.ts',dist),ts.createPrinter().printFile(ts.factory.updateSourceFile(declaration,statements)));

for(const name of readdirSync(new URL('src/',root)))if(name.endsWith('.d.ts'))copyFileSync(new URL(`src/${name}`,root),new URL(name,dist));

const oauth=new URL('../../mcp-oauth-rust/src/',import.meta.url);
for(const name of ['jwks.js','http.js','resource.js'])writeFileSync(new URL(name,dist),readFileSync(new URL(name,oauth),'utf8').replaceAll('mcp-oauth-rust.node','tiny-http-mcp-server-rust.node'));
