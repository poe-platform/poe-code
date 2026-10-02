import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readdirSync,readFileSync} from 'node:fs';
import ts from 'typescript';
import * as root from 'toolcraft-design-rust';
import * as originalRoot from '../../toolcraft-design/dist/index.js';

const source=new URL('../../toolcraft-design/src/',import.meta.url);
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
