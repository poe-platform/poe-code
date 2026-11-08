import {copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import ts from 'typescript';
const source=new URL('../../tiny-stdio-mcp-server-rust/src/',import.meta.url),root=new URL('../',import.meta.url),dist=new URL('dist/',root);
mkdirSync(dist,{recursive:true});
for(const [from,to] of [['index.js','server.js'],['media.js','media.js'],['stdio.js','stdio.js']]){
 writeFileSync(new URL(to,dist),readFileSync(new URL(from,source),'utf8').replaceAll('tiny-stdio-mcp-server-rust.node','tiny-stdio-mcp-test-server-rust.node'));
}
const declaration=ts.createSourceFile('server.d.ts',readFileSync(new URL('index.d.ts',source),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const statements=declaration.statements.map(statement=>{
 if(!ts.isInterfaceDeclaration(statement))return statement;
 let members=statement.members;
 if(statement.name.text==='MessageSession')members=members.filter(member=>!member.name||!['handleLine','handleSDKMessage'].includes(member.name.getText(declaration)));
 if(statement.name.text==='Server')members=members.filter(member=>!(member.name?.getText(declaration)==='connectSDK'&&ts.isMethodSignature(member)&&member.parameters[0]?.type?.getText(declaration)==='SDKCompatibleTransport'));
 return ts.factory.updateInterfaceDeclaration(statement,statement.modifiers,statement.name,statement.typeParameters,statement.heritageClauses,members);
});
writeFileSync(new URL('server.d.ts',dist),ts.createPrinter().printFile(ts.factory.updateSourceFile(declaration,statements)));
for(const name of ['index.d.ts','cli.d.ts','cli-support.d.ts'])copyFileSync(new URL(`src/${name}`,root),new URL(name,dist));
