import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import ts from "typescript";

const path=value=>fileURLToPath(new URL(value,import.meta.url));
const fixtures=["safe-bash", "safe-bash-capabilities"].map(name=>path(`../../toolcraft/src/${name}.compile-check.ts`));
const entries=new Map([
  ["./safe-bash.js",path("../dist/safe-bash.d.ts")],
  ["./index.js",path("../dist/index.d.ts")]
]);
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,strict:true,noEmit:true,skipLibCheck:true,types:["node"]};
const host=ts.createCompilerHost(options);
const redirected=new Set();
host.resolveModuleNames=(names,file)=>names.map(name=>{
  if(fixtures.includes(file)&&entries.has(name)){
    redirected.add(name);
    return {resolvedFileName:entries.get(name),extension:ts.Extension.Dts};
  }
  return ts.resolveModuleName(name,file,options,host).resolvedModule;
});
const program=ts.createProgram(fixtures,options,host);
const diagnostics=ts.getPreEmitDiagnostics(program);
assert.deepEqual(redirected,new Set(entries.keys()));
if(diagnostics.length){
  process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:name=>name,getCurrentDirectory:()=>process.cwd(),getNewLine:()=>"\n"}));
  process.exitCode=1;
}else process.stdout.write("Native Safe Bash declarations passed both original compile-check consumers\n");
