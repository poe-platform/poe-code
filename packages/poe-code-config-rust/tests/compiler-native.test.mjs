import test from 'node:test';
import assert from 'node:assert/strict';
import {compileConfigSchemaFromSourceTexts as original} from '@poe-code/poe-code-config';
import {compileConfigSchemaFromSourceTexts as own} from '../dist/index.js';
const prefix="import {defineScope as scope} from '@poe-code/poe-code-config/core'; ";
const cases=[
 "export const x=scope('s',{a:{type:'string',default:'v',doc:'d'}});",
 "const x=scope('s',{a:{type:'string',default:'v',doc:'d'}});export{x};",
 "const x=scope('s',{});export{x as y};",
 "export const a=scope('a',{}),b=scope('b',{});",
 "export const a=scope<{x:string}>('a',{x:{type:'string',default:'v',doc:'d'}});",
 "export const a=(scope('a',{}));",
 "export const a=scope('a',{}) as unknown;",
 "export const a=scope('version',{});",
 "export const a=scope('0',{'10':{type:'number',default:10,doc:'d'},'2':{type:'number',default:2,doc:'d'},other:{type:'number',default:3,doc:'d'}});",
 "export const a=scope('a',{x:{type:'number',default:0x10,doc:`d`}});",
 "export const a=scope('a',{x:{type:'number',default:1_000,doc:'d'}});",
 "export const a=scope('a',{x:{type:'number',default:-1,doc:'d'}});",
 "export const a=scope(`a`,{});",
 "export const a=scope('a',{x:{type:'string',default:'\\u{1f600}',doc:'d'}});",
 "export const a=scope('a',{x:{type:'string',default:'v',doc:`d${dynamic}`}});",
 "const t=`fake ${'export const a=scope(\"a\",{})'}`; export const real=scope('real',{});",
 "const r=/{export}/; export const real=scope('real',{});",
 "if(true) /{}/.test('x'); export const real=scope('real',{});",
 "export function f(){return './unreadable.js';} export const real=scope('real',{});",
 "export const a=scope('a',{x:{type:'string',default:dynamic,doc:'d'},__proto__:{type:'string',default:'v',doc:'d'}});",
 "export const a=scope('a',{x:{type:'boolean',default:true,doc:'d',type:'boolean'}});",
 "export const a=scope('a',{x:{type:'boolean',default:42,doc:[],env:1}});",
 "export const a=scope('a',{x:{type:'string',default:'v',doc:'d',env:{a:1,a:2}}});",
];

function result(fn,code,document){try{return{value:fn({entrypoints:['/root/index.ts'],files:{'/root/index.ts':prefix+code},document})};}catch(error){return{error:error.message};}}
for(const [index,code]of cases.entries())test('static compiler matches SDK literals and diagnostics '+index,()=>{
 for(const document of [undefined,{id:undefined,title:undefined,description:undefined},{schema:'urn:test',id:'urn:id'}])assert.deepEqual(result(own,code,document),result(original,code,document),code);
});

const moreCases=[
 "export\nconst a=scope('a',{});",
 "export const a=scope<Record<string,number>>('a',{});",
 "export const a:Record<string,number>=scope('a',{});",
 "export const a=scope('a',{})\nexport const b=scope('b',{});",
 "export const a=scope('a',{})\nconst b=scope('hidden',{});",
 "const a=scope('a',{})\nexport{a};",
 "export let a=scope('a',{});export var b=scope('b',{});",
 "import type {defineScope as t} from '@poe-code/poe-code-config';export const a=t('a',{});",
 "import {type defineScope as t} from '@poe-code/poe-code-config';export const a=t('a',{});",
 "export const a=scope('a',{x:{type:'string',default:'v',doc:'line\u2028separator'}});",
 "export const a=scope('a',{x:{type:'string',default:'v',doc:'line\u2029separator'}});",
 "export const a=scope('a',{x:{type:'number',default:1e400,doc:'d'}});",
 "export const a=scope('a',{x:{type:'number',default:.5,doc:'d'}});",
 "export const a=scope('a',{x:{type:'boolean',default:true,doc:'d',env:{a:dynamic,a:2}}});",
 "export const a=scope('a',{x:{type:'boolean',default:true,doc:'d',env:{__proto__:null}}});",
 "export const a=scope('a',{x:{type:'boolean',default:true,doc:'d',env:{a:1,a:2}}});",
 "export const a=scope('a',{...dynamic});",
 "export const a=scope('a',{x});",
 "export const a=scope('a',{['x']:{type:'number',default:1,doc:'d'}});",
 "export const a=scope('a',{1:{type:'number',default:1,doc:'d'}});",
 "export const a=scope('a',{x(){return {};}});",
 "export const a=scope('a',{x:{type:'number',default:1,doc:'d',get env(){return 'E';}}});",
 "if(true) /\\)/.test('x'); export const a=scope('a',{});",
 "if(true) /[\\]}]/.test('x'); export const a=scope('a',{});",
 "const a=1; if(a) /{export/.test('x'); export const b=scope('b',{});",
 "export const a=scope('a',{é:{type:'number',default:1,doc:'d'}});",
 "export const a=scope('a',{\\u0061:{type:'number',default:1,doc:'d'}});",
 "const x=`${`nested ${'quoted'}`} end`;export const a=scope('a',{});",
 "export const a=scope('a',{},'extra');",
 "export const a=scope();",
 "export const a=scope('a');",
 "export const a=scope('a',dynamic);",
 "export const a=scope('a',{x:{default:1,doc:'d'}});",
 "export const a=scope('a',{x:{type:'number',default:1}});",
 "export const a=scope('a',{x:{type:'number',default:1,doc:'d',env:1}});",
];
for(const [index,code]of moreCases.entries())test('static compiler matches SDK lexical boundaries and rejection priority '+index,()=>{
 assert.deepEqual(result(own,code),result(original,code),code);
});
test('compiler traverses cyclic static modules and preserves import-before-export error order',()=>{
 const field="import {defineScope} from '@poe-code/poe-code-config';export const s=defineScope('s',{x:{type:'number',default:1,doc:'d'}});";
 const options={entrypoints:['/root/index.ts'],files:{
  '/root/index.ts':"export{b} from './b.js';import './a.js';import type {X} from './absent.js';export type{Y} from './absent2.js';",
  '/root/a.ts':field+"export{root} from './index.js';",
  '/root/b.ts':field,
 }};
 function value(fn){try{return fn(options);}catch(error){return error.message;}}
 assert.equal(value(own),value(original));assert.match(value(own),/in \/root\/b.ts; first defined in \/root\/a.ts/);
 options.files['/root/b.ts']="export{c} from './c';";options.files['/root/c/index.ts']="import {defineScope} from '@poe-code/poe-code-config';export const c=defineScope('c',{});";
 assert.deepEqual(own(options),original(options));
});
test('compiler retains source-graph failures before schema extraction and document metadata hooks',()=>{
 const source=prefix+"export const a=scope(dynamic,{});import './other.js';";
 const options={entrypoints:['/root/index.ts'],files:{'/root/index.ts':source,'/root/other.ts':"import {defineScope} from '@poe-code/poe-code-config';export const b=defineScope('b',{});"}};
 let ownRead=0,sdkRead=0;
 Object.defineProperty(options,'document',{get(){ownRead++;return undefined;},configurable:true});
 assert.throws(()=>own(options),/scope name must be a string literal/);assert.equal(ownRead,1);
 Object.defineProperty(options,'document',{get(){sdkRead++;return undefined;},configurable:true});
 assert.throws(()=>original(options),/scope name must be a string literal/);assert.equal(sdkRead,1);
 const missing={entrypoints:['/absent.ts'],files:{}};
 assert.throws(()=>own(missing),{message:'Unable to read schema compilation entrypoint or import: /absent.ts'});
});
test('compiler resource admission is transactional across files',async()=>{
 const {native}=await import('../dist/native.js');const compiler=new native.NativeConfigSchemaCompiler();
 compiler.scan('/good.ts',prefix+"export const a=scope('a',{});");
 assert.throws(()=>compiler.scan('/bad.ts','('.repeat(600)),/nesting exceeded/);
 assert.ok(Object.hasOwn(compiler.finish().properties,'a'));
 const bounded=new native.NativeConfigSchemaCompiler();for(let n=0;n<2048;n++)bounded.scan('/empty-'+n+'.ts','');
 assert.throws(()=>bounded.scan('/overflow.ts',''),/graph budget exceeded/);assert.deepEqual(bounded.finish().properties,{version:{type:'number',default:1}});
});
test('compiler accepts scopes declared with the additive runtime package',()=>{
 for(const module of ['@poe-code/poe-code-config-rust','@poe-code/poe-code-config-rust/core']){
  const options={entrypoints:['/root/index.ts'],files:{'/root/index.ts':`import {defineScope} from '${module}';export const a=defineScope('a',{x:{type:'number',default:1,doc:'d'}});`}};
  assert.equal(own(options).properties.a.properties.x.default,1);
 }
});
test('entrypoint compiler reads the injected filesystem without writing files',async()=>{
 const {compileConfigSchemaFromEntrypoints:ownEntrypoints}=await import('../dist/index.js');
 const {compileConfigSchemaFromEntrypoints:sdkEntrypoints}=await import('@poe-code/poe-code-config');
 const {default:fs}=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module');
 const files=new Map([['/root/index.ts',"export{a} from './a.js';"],['/root/a.ts',prefix+"export const a=scope('a',{x:{type:'string',default:'v',doc:'d'}});"]]);
 const read=fs.readFileSync,exists=fs.existsSync;let reads=0;
 fs.existsSync=file=>files.has(file);fs.readFileSync=(file,encoding)=>{assert.equal(encoding,'utf8');reads++;if(!files.has(file))throw Object.assign(Error('absent'),{code:'ENOENT'});return files.get(file);};syncBuiltinESMExports();
 try{const options={entrypoints:['/root/index.ts']};assert.deepEqual(ownEntrypoints(options),sdkEntrypoints(options));assert.ok(reads>=4);}finally{fs.readFileSync=read;fs.existsSync=exists;syncBuiltinESMExports();}
});
const boundaryCases=[
 "export const a=scope('a',{})\nconsole.log(a)",
 "export const a=scope('a',{})\nvoid sideEffect()",
 "export const a=scope('a',{})\nthrow Error()",
 "export const a=scope('a',{})\n// c\nfunction f(){}",
 "const x=()=>/\\)/;export const a=scope('a',{});",
 "function f(){} /\\)/.test('x');export const a=scope('a',{});",
 "const x=typeof /\\)/;export const a=scope('a',{});",
];
for(const [index,code]of boundaryCases.entries())test('static compiler matches SDK statement and regular-expression boundaries '+index,()=>{
 assert.deepEqual(result(own,code),result(original,code),code);
});
const declarationCases=[
 "export const unused=1<2,a=scope('a',{});",
 "export const unused=x<y,z=q>w,a=scope('a',{});",
 "export const a=scope<Record<string,number>,()=>void>('a',{});",
 "export const a:(input:string)=>unknown=scope('a',{});",
 "export const a=scope('a',{}),uninitialized;",
];
for(const [index,code]of declarationCases.entries())test('static compiler matches SDK declaration and type-argument separators '+index,()=>{
 assert.deepEqual(result(own,code),result(original,code),code);
});
