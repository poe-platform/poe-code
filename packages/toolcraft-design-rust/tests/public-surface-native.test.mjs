import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,relative} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import test from "node:test";
import ts from "typescript";

const originalRoot=fileURLToPath(new URL("../../toolcraft-design/",import.meta.url));
const nativeRoot=fileURLToPath(new URL("../",import.meta.url));
const originalManifest=JSON.parse(readFileSync(resolve(originalRoot,"package.json"),"utf8"));
const nativeManifest=JSON.parse(readFileSync(resolve(nativeRoot,"package.json"),"utf8"));
const configPath=resolve(originalRoot,"tsconfig.json");
const config=ts.readConfigFile(configPath,ts.sys.readFile);
assert.equal(config.error,undefined);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,originalRoot);
assert.deepEqual(parsed.errors,[]);
const paths=[".",...parsed.fileNames.filter(file=>!file.endsWith(".d.ts")).map(file=>"./"+relative(resolve(originalRoot,"src"),file).slice(0,-3))];
function originalTarget(key,condition){
  const entry=originalManifest.exports[key];
  return resolve(originalRoot,entry?entry[condition]:originalManifest.exports["./*"][condition].replace("*",key.slice(2)));
}
// These modules execute scenarios on import; dedicated differential suites
// compare their empty namespaces and observable side effects with injected hosts.
const sideEffects=new Set(["./dashboard/testing/pipeline-scenario","./terminal-markdown/testing/theme-render-fixture"]);

test("every emitted design entry point retains runtime exports and function metadata",async()=>{
  for(const key of paths){
    assert.ok(nativeManifest.exports[key],`Missing native entry point ${key}`);
    if(sideEffects.has(key))continue;
    const original=await import(pathToFileURL(originalTarget(key,"import")));
    const native=await import(pathToFileURL(resolve(nativeRoot,nativeManifest.exports[key].import)));
    assert.deepEqual(Reflect.ownKeys(native),Reflect.ownKeys(original),key);
    for(const name of Object.keys(original)){
      assert.equal(typeof native[name],typeof original[name],`${key} ${name}`);
      if(typeof original[name]==="function"){
        assert.equal(native[name].name,original[name].name,`${key} ${name} name`);
        assert.equal(native[name].length,original[name].length,`${key} ${name} length`);
      }
    }
  }
});

test("every design declaration exposes exactly the reference's exported names",()=>{
  const pairs=paths.map(key=>{
    assert.ok(nativeManifest.exports[key],`Missing native entry point ${key}`);
    return [key,originalTarget(key,"types"),resolve(nativeRoot,nativeManifest.exports[key].types)];
  });
  const program=ts.createProgram(pairs.flatMap(([,a,b])=>[a,b]),{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,
    noEmit:true,skipLibCheck:true,types:[]
  });
  const checker=program.getTypeChecker();
  function exports(file){
    const source=program.getSourceFile(file);
    assert.ok(source,`Missing declaration ${file}`);
    const symbol=checker.getSymbolAtLocation(source);
    assert.ok(symbol,`Missing declaration module ${file}`);
    return checker.getExportsOfModule(symbol).map(value=>value.name).sort();
  }
  const mismatches=[];
  for(const [key,a,b] of pairs){
    const original=exports(a),native=exports(b);
    if(JSON.stringify(original)!==JSON.stringify(native))mismatches.push({key,original,native});
  }
  assert.deepEqual(mismatches,[]);
});
