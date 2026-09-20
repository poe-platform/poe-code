import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as original from '../../toolcraft-design/dist/components/template.js';
import * as rust from '../dist/index.js';
test('native template discovery and partial expansion match the original',()=>{
 for(const template of ['Hello {{name}}','{{> one}}{{#items}}{{> two}}{{/items}}','Start\n  {{> one}}\nEnd']){
  assert.deepEqual(rust.getTemplatePartialNames(template),original.getTemplatePartialNames(template));
  const partials={one:'Before\n  {{> two}}\nAfter',two:'{{name}}\n'};
  assert.equal(rust.resolveTemplatePartials(template,partials),original.resolveTemplatePartials(template,partials));
 }
});
test('native renderer supports scopes, scalar rules, escaping, partials, yield and validation',()=>{
 const cases=[
 ['Hello {{name}}',{name:'K'}],['{{name}} {{{name}}} {{&name}}',{name:'<K> & / ` = \"'}],
 ['{{#items}}[{{name}}/{{repo}}]{{/items}}',{repo:'acme-app',items:[{name:'one'},{name:'two'}]}],
 ['{{#issue}}{{title}}/{{repo}}{{/issue}}',{repo:'acme/app',issue:{title:'Bug'}}],
 ['{{^items}}none{{/items}}{{^missing}} missing{{/missing}}',{items:[]}],
 ['{{issue.title}}/{{issue.missing.value}}/{{repo.name}}',{issue:{title:'Bug'},repo:{name:'app'}}],
 ['{{#items}}[{{.}}]{{/items}}',{items:['a','b']}],
 ['A\n  {{#items}}\n  {{! comment }}\n- {{name}}\n  {{/items}}\nB\n',{items:[{name:'one'},{name:'two'}]}],
 ['{{#value}}YES{{/value}}{{^value}}NO{{/value}}',{value:0}],
 ['{{#value}}YES{{/value}}{{^value}}NO{{/value}}',{value:{}}],
 ['Items:\n  {{> items}}\nDone',{}, {partials:{items:'one\ntwo\n'}}],
 ['{{> layout}}',{name:'K'},{escape:'none',yield:'Hello {{name}}',partials:{layout:'Before\n{{yield}}\nAfter'}}],
 ['Read {{url}}. {{yield}}',{}, {escape:'none',yield:'Focus on {{repo}}.'}],
 ];
 for(const [template,view,options]of cases)assert.equal(rust.renderTemplate(template,view,options),original.renderTemplate(template,view,options));
 for(const [template,view,options]of [['{{#show}}{{name}}{{/show}}',{show:false},{validate:true}],['{{#show}}{{> missing}}{{/show}}',{show:false}],['{{> one}}',{}, {partials:{one:'{{> two}}',two:'{{> one}}'}}]]){
  let expected;try{original.renderTemplate(template,view,options);}catch(error){expected=error.message;}
  assert.throws(()=>rust.renderTemplate(template,view,options),error=>error.message===expected);
 }
});
test('native renderer keeps own-property lookup, getters, lambda receivers and iteration order',()=>{
 function fixture(events){const view=Object.assign(Object.create({inherited:'hidden'}),{repo:'parent',items:[{name:'one'},{name:'two'}],get name(){events.push('get');return 'K';},bold(){events.push(['first',this.repo]);return function(raw,render){events.push(['second',this.repo]);return `<b>${render(raw)}</b>`;}}});return view;}
 const a=[],b=[];const source='{{inherited}} {{name}} {{#bold}}Hi {{name}}{{/bold}} {{#items}}{{name}}/{{repo}};{{/items}}';
 assert.equal(rust.renderTemplate(source,fixture(a)),original.renderTemplate(source,fixture(b)));assert.deepEqual(a,b);
 function iterable(events){const array=[0,1];array[Symbol.iterator]=function*(){events.push('start');yield {get name(){events.push('first');return 'one';}};events.push('next');yield {get name(){events.push('second');return 'two';}};};return {items:array};}
 const c=[],d=[];assert.equal(rust.renderTemplate('{{#items}}{{name}}{{/items}}',iterable(c)),original.renderTemplate('{{#items}}{{name}}{{/items}}',iterable(d)));assert.deepEqual(c,d);
});
test('native renderer closes array iterators for child errors and preserves next errors',()=>{
 function fixture(events,failNext){const items=[1];items[Symbol.iterator]=()=>({next(){events.push('next');if(failNext)throw Error('next failed');return {done:false,value:{get name(){events.push('get');throw Error('lookup failed');}}};},return(){events.push('close');return {done:true};}});return {items};}
 for(const failNext of [false,true]){const a=[],b=[];assert.throws(()=>original.renderTemplate('{{#items}}{{name}}{{/items}}',fixture(a,failNext)));assert.throws(()=>rust.renderTemplate('{{#items}}{{name}}{{/items}}',fixture(b,failNext)));assert.deepEqual(b,a);}
});
test('native partial lookup ignores unused getters and preserves errors and UTF-16',()=>{
 for(const template of ['{{ name','first\n🦀 {{{ raw','{{#a}}{{/b}}','{{#a}}x','{{/a}}','{{= a b =}}']){
  let expected;try{original.getTemplatePartialNames(template);}catch(error){expected=error;}
  assert.throws(()=>rust.getTemplatePartialNames(template),error=>error.name===expected.name&&error.message===expected.message&&error.line===expected.line&&error.column===expected.column&&error.description===expected.description);
 }
 function partials(events){return {get one(){events.push('one');return '{{name}}';},get unused(){throw Error('unused');}};}
 for(const method of ['resolveTemplatePartials','renderTemplate']){const a=[],b=[];const args=method==='renderTemplate'?[{name:'K'},{partials:partials(a)}]:[partials(a)];const other=method==='renderTemplate'?[{name:'K'},{partials:partials(b)}]:[partials(b)];assert.equal(rust[method]('{{> one}}',...args),original[method]('{{> one}}',...other));assert.deepEqual(a,b);}
 assert.equal(rust.renderTemplate('raw \ud800 {{name}}',{name:'\udc00'}),original.renderTemplate('raw \ud800 {{name}}',{name:'\udc00'}));
});
test('native generated template cases match output and error precedence',()=>{
 const outcomes=action=>{try{return {value:action()};}catch(error){return {error:{name:error.name,message:error.message,description:error.description,line:error.line,column:error.column}};}};
 const views=[{}, {name:'K',flag:false}, {name:null,flag:true}, {name:0,flag:[]}, {name:'<>&',flag:[{name:'child'},{}]}, {name:['one','two'],flag:{name:'nested'}}, {name:NaN,flag:1}];
 const templates=['{{name}}','{{{name}}}','{{&name}}','{{#flag}}{{name}}/{{.}}{{/flag}}','{{^flag}}{{name}}{{/flag}}','{{#flag}}{{missing}}{{/flag}}','a\n {{! hidden }}\nb','{{> one}}','a\n \t{{> one}}\r\nb','{{#flag}}{{> one}}{{/flag}}'];
 const options=[{}, {escape:'none'},{validate:true},{yield:'{{name}}'},{escape:'none',yield:'{{missing}}'}];
 for(const template of templates)for(const view of views)for(const option of options){const config={...option,partials:{one:'{{name}}\n{{> two}}',two:'{{name}}'}};assert.deepEqual(outcomes(()=>rust.renderTemplate(template,view,config)),outcomes(()=>original.renderTemplate(template,view,config)),JSON.stringify({template,view,option}));}
 const source='Start\r\n \t{{#flag}}\n{{> one}}\n{{/flag}}\n{{{name}}}\nEnd';
 for(let index=0;index<source.length;index++)for(const text of [source.slice(0,index),source.slice(0,index)+source.slice(index+1)]){
  assert.deepEqual(outcomes(()=>rust.getTemplatePartialNames(text)),outcomes(()=>original.getTemplatePartialNames(text)));
  const partials={one:'value'};assert.deepEqual(outcomes(()=>rust.resolveTemplatePartials(text,partials)),outcomes(()=>original.resolveTemplatePartials(text,partials)));
 }
});
