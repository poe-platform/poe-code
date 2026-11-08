import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const root=new URL('./',import.meta.url),path=name=>fileURLToPath(new URL(name,root));
const tools=path('../terminal-pilot-mcp/src/mcp-tools.test.ts'),cli=path('../terminal-pilot-mcp/src/cli.test.ts');
export default defineConfig({plugins:[{
 name:'rust-terminal-pilot-mcp-oracle',enforce:'pre',
 resolveId(name,importer){
  if([tools,cli].includes(importer)&&['./index.js','./cli.js'].includes(name))return path('dist/'+name.slice(2));
 },
 transform(code,id){
  if(![tools,cli].includes(id))return;
  const ast=ts.createSourceFile(id,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const transformed=ts.transform(ast,[context=>node=>{
   const visit=current=>{
    if(id===tools&&ts.isImportDeclaration(current)&&ts.isStringLiteral(current.moduleSpecifier)&&current.moduleSpecifier.text==='toolcraft/mcp'){
     const clause=ts.factory.createImportClause(false,undefined,ts.factory.createNamedImports([ts.factory.createImportSpecifier(false,ts.factory.createIdentifier('createTerminalPilotMcpServer'),ts.factory.createIdentifier('createMCPServer'))]));
     return ts.factory.updateImportDeclaration(current,current.modifiers,clause,ts.factory.createStringLiteral(path('dist/index.js')),current.attributes);
    }
    if(id===tools&&ts.isCallExpression(current)&&ts.isIdentifier(current.expression)&&current.expression.text==='createMCPServer'){
     const services=current.arguments[1].properties.find(property=>property.name?.getText(ast)==='services').initializer;
     return ts.factory.updateCallExpression(current,current.expression,current.typeArguments,[services]);
    }
    if(id===cli&&ts.isStringLiteralLike(current)){
     if(current.text==='./cli.ts')return ts.factory.createStringLiteral('../../terminal-pilot-mcp-rust/dist/cli.js');
     if(current.text.includes('terminal-pilot-mcp'))return ts.factory.createStringLiteral(current.text.replaceAll('terminal-pilot-mcp','terminal-pilot-mcp-rust'));
    }
    return ts.visitEachChild(current,visit,context);
   };
   return ts.visitNode(node,visit);
  }]);
  const result=ts.createPrinter().printFile(transformed.transformed[0]);transformed.dispose();return result;
 }
}],test:{include:[tools,cli],environment:'node',fileParallelism:false,maxWorkers:1,pool:'forks',testTimeout:3000,cache:false}});
