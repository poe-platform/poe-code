import {readFile,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import ts from 'typescript';
const origin=await readFile(new URL('../src/source-origin-program.py',import.meta.url),'utf8');
const originOutput=new URL('../src/source-origin-program.generated.ts',import.meta.url);
const originContents='// Generated from source-origin-program.py. Run npm run build to regenerate.\nexport const pythonSourceOriginProgram = '+JSON.stringify(origin)+';\n';
if(process.argv.includes('--check')){
 if(await readFile(originOutput,'utf8')!==originContents)throw new Error('Source origin program is stale; run npm run build');
}else await writeFile(originOutput,originContents);
const nativeSource=await readFile(new URL('../src/native-wheel.ts',import.meta.url),'utf8');
const tree=ts.createSourceFile('native-wheel.ts',nativeSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const declaration=tree.statements.filter(ts.isVariableStatement).flatMap(statement=>[...statement.declarationList.declarations]).find(declaration=>ts.isIdentifier(declaration.name)&&declaration.name.text==='pythonNativeWheel');
if(!declaration?.initializer||!ts.isNoSubstitutionTemplateLiteral(declaration.initializer))throw new Error('Native wheel program must be a static Python template');
async function rawProgram(filename,name,substitutions={}){
 const source=await readFile(new URL('../src/'+filename,import.meta.url),'utf8');
 const tree=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const declaration=tree.statements.filter(ts.isVariableStatement).flatMap(statement=>[...statement.declarationList.declarations]).find(declaration=>ts.isIdentifier(declaration.name)&&declaration.name.text===name);
 const templates=[];
 function visit(node){if(ts.isTaggedTemplateExpression(node))templates.push(node);else ts.forEachChild(node,visit);}
 if(declaration?.initializer)visit(declaration.initializer);
 if(templates.length!==1||templates[0].tag.getText(tree)!=='String.raw')throw new Error(name+' must use one static raw template');
 const template=templates[0].template;
 if(ts.isNoSubstitutionTemplateLiteral(template))return template.rawText;
 let result=template.head.rawText;
 for(const span of template.templateSpans){
  if(!ts.isIdentifier(span.expression)||!Object.hasOwn(substitutions,span.expression.text))throw new Error('Unknown program interpolation in '+name);
  result+=substitutions[span.expression.text]+span.literal.rawText;
 }
 return result;
}
const runtimeSource=await readFile(new URL('../src/runtime-scripts.ts',import.meta.url),'utf8');
const runtimeTree=ts.createSourceFile('runtime-scripts.ts',runtimeSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const runtimePrograms={};
for(const statement of runtimeTree.statements){
 if(!ts.isVariableStatement(statement))throw new Error('Runtime programs must be static declarations');
 for(const declaration of statement.declarationList.declarations){
  if(!ts.isIdentifier(declaration.name)||!declaration.initializer||!ts.isNoSubstitutionTemplateLiteral(declaration.initializer))throw new Error('Runtime programs must be static templates');
  runtimePrograms[declaration.name.text]=declaration.initializer.text;
 }
}
const buildProgram=await rawProgram('build-backend.ts','pythonBuildBackendProgram',{
 pythonSourceOriginProgram:origin,
 pythonDownloadFilenameProgram:await rawProgram('source-filename-program.ts','pythonDownloadFilenameProgram'),
});
for(const [name,source,variable] of [
 ['runtime-programs',JSON.stringify(runtimePrograms),'pythonRuntimeProgramsGzip'],
 ['package-program',origin+await readFile(new URL('../src/package-program.py',import.meta.url),'utf8'),'pythonPackageProgramGzip'],
 ['native-wheel',declaration.initializer.text,'pythonNativeWheelGzip'],
 ['build-backend',buildProgram,'pythonBuildBackendProgramGzip'],
]){
 const encoded=gzipSync(source,{level:9}).toString('base64');
 const output=new URL('../src/'+name+'.generated.ts',import.meta.url);
 const contents='// Generated from '+(name==='runtime-programs'?'runtime-scripts.ts':name+(name==='package-program'?'.py':'.ts'))+'. Run npm run build to regenerate.\nexport const '+variable+' = '+JSON.stringify(encoded)+';\n';
 if(process.argv.includes('--check')){
  if(await readFile(output,'utf8')!==contents)throw new Error(name+' is stale; run npm run build in safe-bash-command-python');
 }else await writeFile(output,contents);
}
