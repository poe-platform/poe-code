import assert from "node:assert/strict";
import {test} from "node:test";
import * as native from "../dist/index.js";
import {renderPlaintext as reference} from "../../toolcraft-design/dist/terminal-markdown/plaintext-renderer.js";
import {parse} from "../../toolcraft-design/dist/terminal-markdown/parser.js";
const text=value=>({type:"text",value});
const paragraph=value=>({type:"paragraph",children:[text(value)]});
const outcome=fn=>{try{return {value:fn()};}catch(error){return {error:[error?.constructor?.name,error?.message]};}};

test("plaintext AST rendering preserves blocks, announcements and option combinations",()=>{
  assert.equal(typeof native.renderPlaintext,"function");
  // The JavaScript parser supplies fixtures only; this test qualifies the AST renderer.
  const fixtures=["","# Title\n\n## Sub\n\n### Deep\n\nHello **world** and ~~omit~~.","> quoted\n\n> [!WARNING]\n> watch out","- one\n- two\n- three\n- four","1. one\n2. two\n3. three\n4. four","- [x] done\n- [ ] todo","```js\nconst x=1;\n```","| Name | Age |\n|---|---|\n| Alice | 30 |\n| Bob | |","B[^b] then A[^a].\n\n[^a]: Alpha.\n\n[^b]: Beta.","[site](https://example.com) ![cat](cat.png) <b>omit</b>","---\ntitle: Example\n---\nText"];
  for(const markdown of fixtures){const {ast}=parse(markdown);for(const options of [undefined,{}, {announceHeadings:false,announceCode:false,announceAlerts:false},{showLinks:true},{expandLinks:true,showLinks:true,includeFrontmatter:true}])assert.equal(native.renderPlaintext(ast,options),reference(ast,options));}
});

test("plaintext AST rendering preserves unknown nodes, Unicode and standalone node behavior",()=>{
  const nodes=[text("hello"),{type:"inlineCode",value:"code"},{type:"image",alt:"cat"},{type:"break"},{type:"html",value:"ignored"},{type:"unknown"},{type:"code",value:""},{type:"frontmatter",data:{title:"x",list:[1,2],nested:{a:1}}},...Array.from({length:6},(_,index)=>({type:"heading",depth:index+1,children:[text("界 e\u0301 👩‍💻\ud800")]})),{type:"table",children:[]},{type:"tableRow",children:[]},{type:"tableCell",children:[]}];
  for(const node of nodes)for(const options of [undefined,{includeFrontmatter:true,announceCode:false}])assert.deepEqual(outcome(()=>native.renderPlaintext(node,options)),outcome(()=>reference(node,options)));
  const ast={type:"root",children:[{type:"paragraph",children:[text("\x1b[31mred\x1b[0m\x1b]8;;url\x07link\x1b]8;;\x07")]},paragraph("next")]};assert.equal(native.renderPlaintext(ast),reference(ast));
});

test("plaintext options and node getters preserve observable evaluation order",()=>{
  function run(render){
    const trace=[],options=new Proxy({announceHeadings:true,announceAlerts:true,showLinks:true},{get(target,key){trace.push(`option:${key}`);return target[key];}});
    const child=new Proxy({type:"heading",depth:2,children:[text("title")]},{get(target,key){trace.push(`child:${key}`);return target[key];},has(target,key){trace.push(`has:${key}`);return key in target;}});
    const ast=new Proxy({type:"root",children:[child]},{get(target,key){trace.push(`root:${key}`);return target[key];}});
    return [render(ast,options),trace];
  }
  assert.deepEqual(run(native.renderPlaintext),run(reference));
  const thrown={};assert.throws(()=>native.renderPlaintext({get type(){throw thrown;}}),error=>error===thrown);
});

test("plaintext footnote collection retains nested definitions, ordering and callback receivers",()=>{
  const ast={type:"root",children:[{type:"blockquote",children:[{type:"footnoteDefinition",label:"a",children:[paragraph("Alpha")]}]},{type:"paragraph",children:[{type:"footnoteReference",label:"missing"},{type:"footnoteReference",label:"a"},{type:"footnoteReference",label:"a"}]}]};
  assert.equal(native.renderPlaintext(ast),reference(ast));
  function run(render){const trace=[],children=[paragraph("x")];children.map=function(fn){trace.push(["map",this===children]);return Array.prototype.map.call(this,fn);};return [render({type:"root",children}),trace];}
  assert.deepEqual(run(native.renderPlaintext),run(reference));
});

test("plaintext table policies preserve malformed child filtering and sparse arrays",()=>{
  const cell=value=>({type:"tableCell",children:[text(value)]});
  const header={type:"tableRow",children:[cell("A"),{type:"text",value:"ignored"},cell("C")]};
  const row={type:"tableRow",children:[cell("one"),cell(""),cell("three"),cell("extra")]};
  const ast={type:"root",children:[{type:"table",children:[{type:"text",value:"ignored"},header,row]}]};
  assert.equal(native.renderPlaintext(ast),reference(ast));
  const sparse=new Array(3);sparse[1]=paragraph("middle");assert.equal(native.renderPlaintext({type:"list",ordered:false,children:sparse}),reference({type:"list",ordered:false,children:sparse}));
});

test("plaintext collection closes nested iterators when a getter throws",()=>{
  const thrown={};
  function run(render){const trace=[];const inner={*[Symbol.iterator](){try{yield {get type(){throw thrown;}};}finally{trace.push("inner closed");}}};const children={*[Symbol.iterator](){try{yield {type:"paragraph",children:inner};}finally{trace.push("outer closed");}}};assert.throws(()=>render({type:"root",children}),error=>error===thrown);return trace;}
  assert.deepEqual(run(native.renderPlaintext),run(reference));
});

test("plaintext list join lookup and changing code values retain evaluation order",()=>{
  function run(render){const trace=[],join=Array.prototype.join;Object.defineProperty(Array.prototype,"join",{configurable:true,get(){trace.push("join lookup");return join;}});
    let reads=0;const node={type:"list",get ordered(){trace.push("ordered");return true;},children:[{type:"listItem",checked:false,children:[{type:"code",get value(){trace.push(["value",++reads]);return reads===1?"":"body";}}]}]};
    try{return [render(node),trace];}finally{Object.defineProperty(Array.prototype,"join",{value:join,writable:true,configurable:true});}}
  assert.deepEqual(run(native.renderPlaintext),run(reference));
  assert.equal(native.renderPlaintext.name,reference.name);assert.equal(native.renderPlaintext.length,reference.length);
});
