import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tomlFormat} from '../dist/toml.js';
import {createRequire} from 'node:module';
const sdk=createRequire(import.meta.url)('smol-toml');
function comparable(value){if(value instanceof Date)return {time:value.getTime(),iso:value.toISOString(),local:value.isLocal(),date:value.isDate(),clock:value.isTime(),datetime:value.isDateTime()};if(Array.isArray(value))return value.map(comparable);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,comparable(v)]));return value;}
test('native TOML parses tables, arrays, UTF-16 and safe own keys',()=>{
 for(const source of ["", " \u00A0\uFEFF", "# comment\n", "a = 'text'\n__proto__.safe = true\narr = [1, inf, nan, -0.0]\n", "[[server]]\nname='one'\n[server.env]\nKEY='value'\n[[server]]\nname='two'\n", "str = '\uD800'\ntext = \"\\x41\\e\\U0001F980\"\n"]){assert.deepEqual(comparable(tomlFormat.parse(source)),comparable(source.trim()?sdk.parse(source):{}));}
 const parsed=tomlFormat.parse('__proto__.safe = true\n');assert.equal(Object.getPrototypeOf(parsed),Object.prototype);assert.equal(Object.prototype.safe,undefined);
});
test('TOML dates retain authored offsets, local forms and mutable Date behavior',()=>{
 for(const literal of ['2026-08-26T12:34:56.789Z','2026-08-26T12:34:56.789+05:30','2026-08-26t12:34:56.789z','2026-08-26 12:34:56.789123','2026-08-26','12:34:56.789123','12:34','0000-01-01','9999-12-31T23:59:59.999-23:59']){
  const source='updated = '+literal;const actual=tomlFormat.parse(source).updated,expected=sdk.parse(source).updated;
  assert.ok(actual instanceof Date);assert.deepEqual(comparable(actual),comparable(expected));assert.equal(tomlFormat.serialize({updated:actual}),sdk.stringify({updated:expected}));
  actual.setTime(actual.getTime()+86400000);expected.setTime(expected.getTime()+86400000);assert.deepEqual(comparable(actual),comparable(expected));
  assert.equal(tomlFormat.merge({updated:new Date()},{updated:actual}).updated,actual);
 }
});
test('native serialization matches table/inline formatting and foreign scalar hooks',()=>{
 const date=new Date('2026-08-26T12:34:56.789Z');const customDate=new Date(date);let hooks=0;customDate.toISOString=()=>{hooks++;return 'custom-date';};
 for(const value of [{}, {scalar:'\uD800\u007F',n:Infinity,nan:NaN,zero:-0,unsafe:1000000000000000100,big:123n,date,missing:undefined,null:null}, {nested:{name:'agent',empty:{}},aot:[{name:'one'},{name:'two',env:{KEY:'value'}}],array:[1,{inline:true},'text']}, {inline:[{nested:[1,2]}]}, {customDate}]){
  const expected=sdk.stringify(value);assert.equal(tomlFormat.serialize(value),expected);
 }
 assert.equal(hooks,2);
 for(const value of [[],true,{fn(){}},{sym:Symbol('x')},{badDate:new Date(NaN)},{array:[undefined]},{array:[null]}]){
  let expected;try{sdk.stringify(value);}catch(error){expected=error;}
  assert.throws(()=>tomlFormat.serialize(value),{constructor:expected.constructor,message:expected.message});
 }
 const cycle={};cycle.self=cycle;assert.throws(()=>tomlFormat.serialize(cycle),{message:'Could not stringify the object: maximum object depth exceeded'});
});
test('serialization evaluates stable property getters as the development SDK does',()=>{
 function fixture(){const calls=[];const value={};for(const[key,entry]of Object.entries({scalar:'text',nested:{key:'value'},array:[1,2],tables:[{key:'value'}],date:new Date('2026-01-01Z'),null:null,undefined:undefined})){Object.defineProperty(value,key,{enumerable:true,get(){calls.push(key);return entry;}});}return {value,calls};}
 const expected=fixture(),actual=fixture();assert.equal(tomlFormat.serialize(actual.value),sdk.stringify(expected.value));assert.deepEqual(actual.calls,expected.calls);
});
test('serialization transfers snapshots without global JSON hooks or foreign toJSON calls',()=>{
 const value={name:'agent',nested:{enabled:true},date:new Date('2026-01-01Z'),array:[1,'\uD800']};
 let calls=0;Object.defineProperty(value.nested,'toJSON',{value(){calls++;throw Error('foreign hook');}});
 const expected=sdk.stringify(value),stringify=JSON.stringify;
 try{JSON.stringify=()=>{throw Error('global JSON hook');};assert.equal(tomlFormat.serialize(value),expected);assert.equal(calls,0);}
 finally{JSON.stringify=stringify;}
});
test('TOML parser errors retain full codeblocks and UTF-16 line/column diagnostics',()=>{
 for(const source of ['n = 01','n = 9007199254740992','a = 1\na = 2','x = {a = {},a.b = 1}', 'x = [1,2', 'x = "\\q"', '# preceding\r\nkey = "\uD800"\r\nn = 01\r\n']){
  let expected;try{sdk.parse(source);}catch(error){expected=error;}
  let actual;try{tomlFormat.parse(source);}catch(error){actual=error;}
  assert.equal(actual.message,expected.message);assert.equal(actual.line,expected.line);assert.equal(actual.column,expected.column);assert.equal(actual.codeblock,expected.codeblock);
 }
 assert.throws(()=>tomlFormat.parse('[[section]'),{message:/expected end of table declaration/});
});
