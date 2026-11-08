import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import * as root from 'toolcraft-design-rust';
import * as originalRoot from '../../toolcraft-design/dist/index.js';

const source=new URL('../../toolcraft-design/src/',import.meta.url);
test('root exports exactly match the original module',()=>{
  assert.deepEqual(Object.keys(root),Object.keys(originalRoot));
  for(const key of Object.keys(originalRoot)){
    const actual=Object.getOwnPropertyDescriptor(root,key),expected=Object.getOwnPropertyDescriptor(originalRoot,key);
    assert.deepEqual({...actual,value:typeof actual.value},{...expected,value:typeof expected.value},key);
  }
});

test('root declaration export names exactly match the original source',()=>{
  const files=[new URL('index.ts',source),new URL('../dist/index.d.ts',import.meta.url)].map(url=>fileURLToPath(url));
  const program=ts.createProgram(files,{module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,target:ts.ScriptTarget.ES2022,types:[]});
  const checker=program.getTypeChecker();
  const names=files.map(file=>checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(file))).map(symbol=>symbol.name).sort());
  assert.deepEqual(names[1],names[0]);
});

test('index subpath preserves the root module identity',async()=>{
  assert.equal(await import('toolcraft-design-rust/index'),root);
});

const flatModules=readdirSync(source).filter(name=>name.endsWith('.ts')&&!name.includes('.test.')&&name!=='index.ts').filter(name=>{
  const ast=ts.createSourceFile(name,readFileSync(new URL(name,source),'utf8'),ts.ScriptTarget.Latest,true);
  return ast.statements.length>0&&ast.statements.every(ts.isExportDeclaration);
}).map(name=>name.slice(0,-3));

test('every flat re-export subpath preserves its export set, descriptors and shared identities',async()=>{
  for(const name of flatModules){
    const expected=await import(`../../toolcraft-design/dist/${name}.js`);
    const actual=await import(`toolcraft-design-rust/${name}`);
    assert.deepEqual(Object.keys(actual),Object.keys(expected),name);
    for(const key of Object.keys(expected)){
      const descriptor=Object.getOwnPropertyDescriptor(actual,key),original=Object.getOwnPropertyDescriptor(expected,key);
      assert.deepEqual({...descriptor,value:typeof descriptor.value},{...original,value:typeof original.value},`${name}.${key}`);
      if(expected[key]===originalRoot[key])assert.equal(actual[key],root[key],`${name}.${key} root identity`);
      else if(expected[key]===originalRoot.helpFormatterPlain[key])assert.equal(actual[key],root.helpFormatterPlain[key],`${name}.${key} plain identity`);
      // This standalone helper has no second public export identity to compare.
      else assert.equal(name,'escape-terminal-text',`Unverified identity for ${name}.${key}`);
    }
  }
});
