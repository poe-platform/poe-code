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
