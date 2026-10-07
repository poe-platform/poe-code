import {readFile,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import ts from 'typescript';
const nativeSource=await readFile(new URL('../src/native-wheel.ts',import.meta.url),'utf8');
const tree=ts.createSourceFile('native-wheel.ts',nativeSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const declaration=tree.statements.filter(ts.isVariableStatement).flatMap(statement=>[...statement.declarationList.declarations]).find(declaration=>ts.isIdentifier(declaration.name)&&declaration.name.text==='pythonNativeWheel');
if(!declaration?.initializer||!ts.isNoSubstitutionTemplateLiteral(declaration.initializer))throw new Error('Native wheel program must be a static Python template');
for(const [name,source,variable] of [
 ['package-program',await readFile(new URL('../src/package-program.py',import.meta.url),'utf8'),'pythonPackageProgramGzip'],
 ['native-wheel',declaration.initializer.text,'pythonNativeWheelGzip'],
]){
 const encoded=gzipSync(source,{level:9}).toString('base64');
 const output=new URL('../src/'+name+'.generated.ts',import.meta.url);
 const contents='// Generated from '+name+(name==='native-wheel'?'.ts':'.py')+'. Run npm run build to regenerate.\nexport const '+variable+' = '+JSON.stringify(encoded)+';\n';
 if(process.argv.includes('--check')){
  if(await readFile(output,'utf8')!==contents)throw new Error(name+' is stale; run npm run build in safe-bash-command-python');
 }else await writeFile(output,contents);
}
