import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const modules={
  'components/color':'color',
  'components/text':'text',
  'components/logger':'logging',
  'components/index':'index',
  'dashboard/line-buffer':'line-buffer',
  'dashboard/output-preview':'output-preview',
  'explorer/events':'explorer-events',
  'internal/color-support':'color-support',
  'internal/output-format':'logging',
  'internal/strip-ansi':'logging',
  'internal/theme-detect':'theme',
  'internal/theme-state':'theme-state',
  'prompts/interactive/index':null
};

test('nested utility subpaths preserve exact exports, descriptors and existing function identities',async()=>{
  for(const [path,implementation] of Object.entries(modules)){
    const expected=await import(`../../toolcraft-design/dist/${path}.js`);
    const actual=await import(`toolcraft-design-rust/${path}`);
    assert.deepEqual(Object.keys(actual),Object.keys(expected),path);
    const backing=implementation?await import(`../dist/${implementation}.js`):Object.assign({},...await Promise.all(['cancel-symbol','prompt-text','prompt-password','prompt-confirm','prompt-select','prompt-multiselect'].map(name=>import(`../dist/${name}.js`))));
    for(const key of Object.keys(expected)){
      const descriptor=Object.getOwnPropertyDescriptor(actual,key),reference=Object.getOwnPropertyDescriptor(expected,key);
      assert.deepEqual({...descriptor,value:typeof descriptor.value},{...reference,value:typeof reference.value},`${path}.${key}`);
      assert.equal(actual[key],backing[key],`${path}.${key} identity`);
    }
  }
});

test('nested utility declarations expose exactly the original names',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  const files=Object.keys(modules).flatMap(path=>[
    fileURLToPath(new URL(`../../toolcraft-design/src/${path}.ts`,import.meta.url)),
    fileURLToPath(new URL(`../${manifest.exports[`./${path}`].types}`,import.meta.url))
  ]);
  const program=ts.createProgram(files,{module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,target:ts.ScriptTarget.ES2022,types:[]});
  const checker=program.getTypeChecker();
  const names=files.map(file=>checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(file))).map(symbol=>symbol.name).sort());
  Object.keys(modules).forEach((path,index)=>assert.deepEqual(names[index*2+1],names[index*2],path));
});
