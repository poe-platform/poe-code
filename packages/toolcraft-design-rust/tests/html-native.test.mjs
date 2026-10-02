import assert from "node:assert/strict";
import {test} from "node:test";
import * as native from "../dist/index.js";
import {renderHtml as reference} from "../../toolcraft-design/dist/terminal-markdown/html-renderer.js";
import {parse} from "../../toolcraft-design/dist/terminal-markdown/parser.js";
const text=value=>({type:"text",value});
const paragraph=value=>({type:"paragraph",children:[text(value)]});
const outcome=fn=>{try{return {value:fn()};}catch(error){return {error:[error?.constructor?.name,error?.message]};}};

test("HTML AST rendering covers every block, inline node and option combination",()=>{
  assert.equal(typeof native.renderHtml,"function");
  // The reference parser supplies AST fixtures, not runtime functionality.
  const fixtures=["","# Status\n\n**Strong**, *emphasis*, ~~old~~, `code` and <b>html</b>.","> Quote\n\n> [!WARNING]\n> Beware\n\n---","[Docs](https://example.com \"Read docs\") and ![Diagram](/diagram.png \"System\")\nline one  \nline two","```ts\nconst x = \"<safe>\";\n```","- [x] Done\n- [ ] Todo\n  - Nested\n\n3. Third\n4. Fourth","| Left | Center | Right |\n|:---|:---:|---:|\n| a | b | c |","B[^b] then A[^a] again B[^b].\n\n[^a]: Alpha\n\n[^b]: Beta","---\ntitle: Demo\ncount: 3\n---\nText"];
  for(const markdown of fixtures){
    const {ast}=parse(markdown);
    for(let flags=0;flags<8;flags++){
      const options={showFrontmatter:!!(flags&1),allowRawHtml:!!(flags&2),syntaxHighlight:!!(flags&4)};
      assert.equal(native.renderHtml(ast,options),reference(ast,options));
    }
  }
});

test("HTML URLs retain scheme admission, escaping and Unicode exactly",()=>{
  for(const url of ["", "   ","//host/path"," /relative?a=1&b=2 ","#fragment", "?query", "https://example.com", "HTTP://host", "MailTo:a@example.com","tel:+1-555","javascript:alert(1)","data:text/html,hello","ftp://host","a+b.c-d:payload","1http:relative",":empty","hello world:relative","😀:relative","\ud800:relative"]){
    for(const type of ["link","image"]){
      const node={type,url,title:'a"b<&\ud800',alt:"alt & < > \" ' 😀",children:[text("link & < > \" '")]};
      assert.equal(native.renderHtml(node),reference(node),url);
    }
  }
});

test("HTML code tokens retain supplied kinds, escaping, sparse arrays and plain fallback",()=>{
  for(const lang of [undefined,"", "unknown","text","js","jsonc","yaml","css","diff","html"]){
    for(const tokens of [undefined,[],[{kind:"plain",value:"<&"},{kind:'custom"kind',value:"\ud800\udfff<&\"'"}],new Array(2)]){
      const node={type:"code",lang,value:'const x = "hello"; // comment',tokens};
      for(const syntaxHighlight of [false,true])assert.equal(native.renderHtml(node,{syntaxHighlight}),reference(node,{syntaxHighlight}));
    }
  }
});

test("HTML getters and array species preserve host evaluation order",()=>{
  function run(render){
    const trace=[];
    const wrap=(name,value)=>new Proxy(value,{get(target,key){trace.push([name,String(key)]);return Reflect.get(target,key);},has(target,key){trace.push([name,"has",key]);return key in target;}});
    class Nodes extends Array {static get [Symbol.species](){trace.push("species");return Array;}}
    const nodes=new Nodes(...[
      {type:"heading",depth:2,children:[text("Title")]},
      {type:"list",ordered:true,start:3,children:[{type:"listItem",checked:false,children:[paragraph("item")]}]},
      {type:"link",url:"https://example.com",title:"Title",children:[text("Docs")]},
      {type:"image",url:"/image.png",alt:"Alt",title:"Image"},
      {type:"code",lang:"js",value:"true"},
      {type:"table",align:["left"],children:[{type:"tableRow",children:[{type:"tableCell",children:[text("Cell")]}]}]},
      {type:"frontmatter",data:{title:"Test",count:1}},
      {type:"html",value:"<i>raw</i>"}
    ].map((node,index)=>wrap(index,node)));
    const options=wrap("options",{showFrontmatter:true,syntaxHighlight:true,allowRawHtml:false});
    return [render(wrap("root",{type:"root",children:nodes}),options),trace];
  }
  assert.deepEqual(run(native.renderHtml),run(reference));
});

test("HTML frontmatter keeps circular JSON, toJSON receivers and thrown identity",()=>{
  const shared={value:"shared"},cycle={};cycle.self=cycle;
  const data={nil:null,text:"<&",number:NaN,flag:false,nested:{left:shared,right:shared},cycle,array:[1,undefined],missing:undefined};
  assert.equal(native.renderHtml({type:"frontmatter",data},{showFrontmatter:true}),reference({type:"frontmatter",data},{showFrontmatter:true}));
  function run(render){const trace=[],data={a:{toJSON(key){trace.push([key,this===data.a]);return {b:2};}}};return [render({type:"frontmatter",data},{showFrontmatter:true}),trace];}
  assert.deepEqual(run(native.renderHtml),run(reference));
  const thrown={};assert.throws(()=>native.renderHtml({type:"frontmatter",data:{get x(){throw thrown;}}},{showFrontmatter:true}),error=>error===thrown);
});

test("HTML footnotes collect nested definitions and retain numbering and iteration cleanup",()=>{
  const ref=label=>({type:"footnoteReference",label});
  const ast={type:"root",children:[{type:"paragraph",children:[ref("missing"),ref("b &"),ref("a"),ref("b &")]},{type:"blockquote",children:[{type:"footnoteDefinition",label:"a",children:[paragraph("Alpha")]},{type:"footnoteDefinition",label:"b &",children:[{type:"paragraph",children:[text("Beta"),ref("c")]}]}]},{type:"footnoteDefinition",label:"c",children:[paragraph("late reference")]}]};
  assert.equal(native.renderHtml(ast),reference(ast));
  const thrown={};
  function run(render){const trace=[];const inner={*[Symbol.iterator](){try{yield {get type(){throw thrown;}};}finally{trace.push("inner");}}};const children={*[Symbol.iterator](){try{yield {type:"paragraph",children:inner};}finally{trace.push("outer");}}};assert.throws(()=>render({type:"root",children}),error=>error===thrown);return trace;}
  assert.deepEqual(run(native.renderHtml),run(reference));
});

test("HTML standalone, fallback and invalid values preserve renderer behavior",()=>{
  const nodes=[text("\ud800&<>\"'"),{type:"unknown"},{type:"unknown",children:[paragraph("child")]},{type:"table",children:[]},{type:"heading",depth:2,children:[]},{type:"list",ordered:false,children:[]},{type:"listItem",checked:true,children:[paragraph("standalone")]},{type:"footnoteReference",label:"a"},{type:"footnoteDefinition",label:"a",children:[paragraph("hidden")]},{type:"frontmatter",data:{}}];
  for(const node of nodes)for(const options of [undefined,{},null])assert.deepEqual(outcome(()=>native.renderHtml(node,options)),outcome(()=>reference(node,options)));
  assert.equal(native.renderHtml.name,reference.name);assert.equal(native.renderHtml.length,reference.length);
});

test("HTML escaping preserves custom iterators, coercions and cleanup",()=>{
  function run(render){const trace=[];const value={*[Symbol.iterator](){try{yield "&";yield {toString(){trace.push("coerce");return "<custom>";}};yield "\ud800";}finally{trace.push("closed");}}};return [render({type:"text",value}),trace];}
  assert.deepEqual(run(native.renderHtml),run(reference));
  const thrown={};
  function fail(render){const trace=[];const value={*[Symbol.iterator](){try{yield {[Symbol.toPrimitive](){throw thrown;}};}finally{trace.push("closed");}}};assert.throws(()=>render({type:"text",value}),error=>error===thrown);return trace;}
  assert.deepEqual(fail(native.renderHtml),fail(reference));
});

test("HTML footnote and JSON membership checks retain truthy overridden methods",()=>{
  function run(render){
    const has=Map.prototype.has,includes=Array.prototype.includes;
    Map.prototype.has=function(){return {};};Array.prototype.includes=function(){return {};};
    try{
      return [render({type:"root",children:[{type:"paragraph",children:[{type:"footnoteReference",label:"missing"}]}]}),render({type:"frontmatter",data:{value:{x:1}}},{showFrontmatter:true})];
    }finally{Map.prototype.has=has;Array.prototype.includes=includes;}
  }
  assert.deepEqual(run(native.renderHtml),run(reference));
});

test("HTML URL scanning retains method receivers and character coercion order",()=>{
  function run(render){
    const trace=[];
    const ch={charCodeAt(index){trace.push(["code",index,this===ch]);return {valueOf(){trace.push("numeric");return 104;}};},[Symbol.toPrimitive](hint){trace.push(["coerce",hint]);return "h";}};
    const trimmed={length:2,0:ch,1:":",startsWith(prefix){trace.push(["prefix",prefix,this===trimmed]);return false;}};
    const url={trim(){trace.push(["trim",this===url]);return trimmed;}};
    return [render({type:"image",url,alt:"alt"}),trace];
  }
  assert.deepEqual(run(native.renderHtml),run(reference));
});
