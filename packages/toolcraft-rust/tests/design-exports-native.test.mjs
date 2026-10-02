import assert from "node:assert/strict";
import {readdirSync,readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import test from "node:test";
import ts from "typescript";

const sourceRoot=new URL("../../toolcraft/src/",import.meta.url);
const paths=["design",...readdirSync(new URL("design/",sourceRoot)).filter(name=>name.endsWith(".ts")&&!name.endsWith(".test.ts")).map(name=>`design/${name.slice(0,-3)}`)];
function source(path){return ts.createSourceFile(path,readFileSync(new URL(`${path}.ts`,sourceRoot),"utf8"),ts.ScriptTarget.Latest,true);}
function nativeSpecifier(specifier){
  assert.ok(specifier==="toolcraft-design"||specifier.startsWith("toolcraft-design/"));
  return specifier.replace("toolcraft-design","toolcraft-design-rust");
}

test("Toolcraft design entry points preserve the original namespaces and native identities",async()=>{
  for(const path of paths){
    const original=await import(`toolcraft/${path}`);
    const native=await import(`toolcraft-rust/${path}`);
    assert.deepEqual(Object.keys(native),Object.keys(original),path);
    for(const name of Object.keys(original)){
      assert.equal(typeof native[name],typeof original[name],`${path} ${name}`);
      if(typeof original[name]==="function"){
        assert.equal(native[name].name,original[name].name,`${path} ${name} name`);
        assert.equal(native[name].length,original[name].length,`${path} ${name} length`);
      }
    }
    const statements=source(path).statements;
    const explicit=new Set(statements.flatMap(statement=>{
      if(statement.isTypeOnly||!statement.exportClause)return [];
      return ts.isNamespaceExport(statement.exportClause)?[statement.exportClause.name.text]:statement.exportClause.elements.filter(item=>!item.isTypeOnly).map(item=>item.name.text);
    }));
    for(const statement of statements){
      assert.ok(ts.isExportDeclaration(statement),`${path} remains a declarative re-export`);
      if(statement.isTypeOnly)continue;
      const dependency=await import(nativeSpecifier(statement.moduleSpecifier.text));
      if(!statement.exportClause){
        for(const name of Object.keys(dependency))if(!explicit.has(name))assert.equal(native[name],dependency[name],`${path} ${name} identity`);
      }else if(ts.isNamespaceExport(statement.exportClause)){
        assert.equal(native[statement.exportClause.name.text],dependency,`${path} namespace identity`);
      }else{
        for(const item of statement.exportClause.elements)if(!item.isTypeOnly)assert.equal(native[item.name.text],dependency[(item.propertyName??item.name).text],`${path} ${item.name.text} identity`);
      }
    }
  }
});

test("Toolcraft design declarations preserve every exported type and value name",()=>{
  const nativeManifest=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
  const pairs=paths.map(path=>{
    const target=nativeManifest.exports[`./${path}`];
    assert.ok(target,`Missing native export ./${path}`);
    return [path,fileURLToPath(new URL(`../../toolcraft/dist/${path}.d.ts`,import.meta.url)),fileURLToPath(new URL(`../${target.types}`,import.meta.url))];
  });
  const program=ts.createProgram(pairs.flatMap(([,a,b])=>[a,b]),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,noEmit:true,skipLibCheck:true,types:[]});
  const checker=program.getTypeChecker();
  function names(file){
    const source=program.getSourceFile(file);assert.ok(source,`Missing declaration ${file}`);
    const symbol=checker.getSymbolAtLocation(source);assert.ok(symbol,`Missing module ${file}`);
    return checker.getExportsOfModule(symbol).map(item=>item.name).sort();
  }
  for(const [path,a,b] of pairs)assert.deepEqual(names(b),names(a),path);
});
