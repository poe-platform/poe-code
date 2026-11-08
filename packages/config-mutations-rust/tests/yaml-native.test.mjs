import assert from 'node:assert/strict';
import {test} from 'node:test';
import {yamlFormat as original} from '../../config-mutations/dist/formats/yaml.js';
import {yamlFormat} from '../dist/yaml.js';

test('YAML native codec preserves nested configuration and Date aliases',()=>{
 for(const source of ['', 'key: null\nargs: [one,two]\n', '%YAML 1.1\n---\nbase: &base {a: 1}\nserver: {<<: *base, b: 2}\n'])assert.deepEqual(yamlFormat.parse(source),original.parse(source));
 const result=yamlFormat.parse('one: &date !!timestamp 2026-08-26T12:34:56Z\ntwo: *date\nthree: !!timestamp 2026-08-26T12:34:56Z');
 assert.ok(result.one instanceof Date);assert.equal(result.one,result.two);assert.notEqual(result.one,result.three);
 assert.deepEqual(result,original.parse('one: &date !!timestamp 2026-08-26T12:34:56Z\ntwo: *date\nthree: !!timestamp 2026-08-26T12:34:56Z'));
});
test('YAML native serialization preserves shared refs, cycles, Maps and iterables',()=>{
 const shared={enabled:true},other={args:['one','two']},cycle={};cycle.self=cycle;
 for(const value of [{shared,other,again:other,last:shared},cycle,new Map([[null,1],[false,2],[['one','two'],3]]),new Set(['one','two']),{date:new Date('2026-08-26T12:34:56Z')},{key:'one\ntwo'},[undefined,null,-0,NaN,Infinity],{skip:undefined,enabled:true}])assert.equal(yamlFormat.serialize(value),original.serialize(value));
});
test('YAML native serialization mirrors host hooks and getter order',()=>{
 function fixture(events){
  const shared={get toJSON(){events.push('hook:get');return function(){events.push(['hook:call',arguments.length]);return {inside:'value'};};}};
  return {get first(){events.push('first:get');return shared;},get middle(){events.push('middle:get');return {get leaf(){events.push('leaf:get');return 1;}};},get last(){events.push('last:get');return shared;}};
 }
 const left=[],right=[];assert.equal(yamlFormat.serialize(fixture(left)),original.serialize(fixture(right)));assert.deepEqual(left,right);
 function iterable(events){return {get toJSON(){events.push('hook:get');return undefined;},*[Symbol.iterator](){events.push('iterator:start');yield {toJSON(){events.push('child');return 1;}};events.push('iterator:next');yield 2;}};}
 const a=[],b=[];assert.equal(yamlFormat.serialize(iterable(a)),original.serialize(iterable(b)));assert.deepEqual(a,b);
 const boxed=new String('null');boxed.toJSON=()=>{throw new Error('ignored');};assert.equal(yamlFormat.serialize({boxed}),original.serialize({boxed}));
 const date=new Date(NaN);assert.equal(yamlFormat.serialize({date}),original.serialize({date}));
});
test('YAML native dictionary Date keys use the host time zone',()=>{
 for(const source of ['? !!timestamp 2026-08-26T12:34:56Z\n: value','%YAML 1.1\n---\nbase: &base {!!timestamp 2026-08-26: date}\nserver: {<<: *base}'])assert.deepEqual(yamlFormat.parse(source),original.parse(source));
});

test('YAML native explicit merge scalar values retain Symbols and alias identity',()=>{
 const result=yamlFormat.parse('first: &a !!merge <<\nsecond: *a\nthird: !!merge <<');
 assert.equal(typeof result.first,'symbol');assert.equal(result.first.description,'<<');assert.equal(result.first,result.second);assert.notEqual(result.first,result.third);
});
test('YAML native closes active iterators when a child host hook throws',()=>{
 function fixture(events){return {*[Symbol.iterator](){try{events.push('start');yield {toJSON(){events.push('child');throw new Error('hook failure');}};}finally{events.push('close');}}};}
 const a=[],b=[];assert.throws(()=>original.serialize(fixture(a)),/hook failure/);assert.throws(()=>yamlFormat.serialize(fixture(b)),/hook failure/);assert.deepEqual(b,a);
});

test('YAML unsupported values retain constructor names and exact diagnostic text',()=>{
 for(const value of [Symbol('value'),()=>1,async()=>1,function*(){yield 1;}]){
  let expected;try{original.serialize([1,value]);}catch(error){expected=error;}
  assert.throws(()=>yamlFormat.serialize([1,value]),error=>error.name===expected.name&&error.message===expected.message);
 }
 for(const name of [undefined,null,'','Custom','\ud800',Symbol('name'),{toString(){return 'Named';}}]){
  const value=()=>1;Object.defineProperty(value,'constructor',{value:{name}});
  let expected;try{original.serialize(value);}catch(error){expected=error;}
  assert.throws(()=>yamlFormat.serialize(value),error=>error.name===expected.name&&error.message===expected.message);
 }
});

test('YAML resolves only the first unsupported type after all source hooks',()=>{
 function run(codec){
  const trace=[],failure={failure:true};
  const first=()=>1,second=()=>2;
  Object.defineProperty(first,'constructor',{get(){trace.push('first constructor');return {get name(){trace.push('first name');throw failure;}};}});
  Object.defineProperty(second,'constructor',{get(){trace.push('second constructor');throw new Error('must not reach second');}});
  const value=new Map([[{nested:first},second],['last',{toJSON(){trace.push('last toJSON');return 1;}}]]);
  let thrown;try{codec.serialize(value);}catch(error){thrown=error;}
  return {trace,sameFailure:thrown===failure};
 }
 assert.deepEqual(run(yamlFormat),run(original));
});

test('YAML source failures take precedence over unsupported scalar diagnostics',()=>{
 for(const codec of [original,yamlFormat])for(const failure of [undefined,null,false,17,Symbol('failure')]){
  const value=()=>1;
  Object.defineProperty(value,'constructor',{get(){throw new Error('name inspected before graph completion');}});
  assert.throws(()=>codec.serialize([value,{toJSON(){throw failure;}}]),error=>error===failure);
 }
});
