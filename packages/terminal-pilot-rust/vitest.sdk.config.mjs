import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const root=new URL('./',import.meta.url),path=name=>fileURLToPath(new URL(name,root));
const sources=['terminal-pilot-core','terminal-buffer-graphemes','terminal-session'].map(n=>path('../terminal-pilot/src/'+n+'.test.ts'));
const imports=new Set(['./index.js','./ansi.js','./keys.js','./terminal-buffer.js','./terminal-screen.js','./terminal-pilot.js','./terminal-session.js']);
const omitted=new Set(['ignores a missing node-pty spawn-helper','does not ignore spawn-helper chmod errors with inherited missing-file codes']);
export default defineConfig({
 plugins:[{
  name:'portable-terminal-pilot-reference',enforce:'pre',
  resolveId(name,importer){if(sources.includes(importer)&&imports.has(name))return path('dist/index.js');},
  transform(code,id){
   if(!sources.includes(id))return;
   const ast=ts.createSourceFile(id,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
   const result=ts.transform(ast,[context=>{
    const visit=node=>{
     if(ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)){
      const call=node.expression,first=call.arguments[0];
      if(ts.isIdentifier(call.expression)&&call.expression.text==='it'&&first&&ts.isStringLiteral(first)&&omitted.has(first.text))return undefined;
      if(ts.isPropertyAccessExpression(call.expression)&&call.expression.expression.getText(ast)==='vi'&&call.expression.name.text==='mock'&&first&&ts.isStringLiteral(first)){
       if(first.text==='node:fs')return undefined;
       if(first.text==='node-pty')return ts.factory.createExpressionStatement(ts.factory.createCallExpression(call.expression,undefined,[ts.factory.createStringLiteral(path('dist/pty-host.js')),ts.factory.createArrowFunction(undefined,undefined,[],undefined,ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),ts.factory.createParenthesizedExpression(ts.factory.createObjectLiteralExpression([ts.factory.createPropertyAssignment('createPty',ts.factory.createIdentifier('spawnMock'))])))]));
      }
     }
     return ts.visitEachChild(node,visit,context);
    };
    return node=>ts.visitNode(node,visit);
   }]);
   const output=ts.createPrinter().printFile(result.transformed[0]);result.dispose();return output;
  }
 }],
 test:{include:[...sources,path('tests/session-host.test.ts'),path('tests/session-conformance.test.ts')],environment:'node',globals:true,fileParallelism:false,maxWorkers:1,pool:'forks',testTimeout:3000,cache:false}
});
