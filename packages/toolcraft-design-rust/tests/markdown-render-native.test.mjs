import assert from "node:assert/strict";
import {test} from "node:test";
import * as native from "../dist/index.js";
import * as original from "../../toolcraft-design/dist/index.js";
import {render as reference} from "../../toolcraft-design/dist/terminal-markdown/renderer.js";
import {parse} from "../../toolcraft-design/dist/terminal-markdown/parser.js";
const text=value=>({type:"text",value});
const paragraph=value=>({type:"paragraph",children:[text(value)]});
const outcome=fn=>{try{return {value:fn()};}catch(error){return {error:[error?.constructor?.name,error?.message]};}};
const fixtures=["","# Title\n\n## Subtitle\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six","A **strong** and *emphasized* ~~old~~ `code` line with 界面, e\u0301 and 👩‍💻.\n\n[Docs](https://example.com) ![Image](image.png)","> First paragraph\n>\n> Second\n> - nested\n> - list","- [x] Done\n- [ ] Todo\n  - Nested\n\n3. Third\n4. Fourth","```ts\nconst ready: boolean = true;\nconsole.log(\"<safe>\");\n```","| Left | Center | Right |\n|:---|:---:|---:|\n| first | 2 | third |\n| more | empty | last |","A[^a] B[^b] A[^a].\n\n[^a]: Alpha\n\n[^b]: Beta","---\ntitle: Demo\ncount: 3\n---\nText","<div>HTML <b>text</b></div>\n\n---",...['NOTE','TIP','IMPORTANT','WARNING','CAUTION'].map(kind=>`> [!${kind}]\n> Check your configuration.`)];

test("terminal Markdown AST rendering matches all blocks, widths and output formats",()=>{
  assert.equal(typeof native.render,"function");
  // The reference parser only builds fixtures; this qualifies AST rendering.
  for(const markdown of fixtures){const {ast}=parse(markdown);for(const width of [1,3.5,12,40,80])for(const syntaxHighlight of [false,true]){
    const options={width,syntaxHighlight,showFrontmatter:true};
    for(const format of ["terminal","markdown","json"]){
      const actual=native.withOutputFormat(format,()=>native.render(ast,options));
      const expected=original.withOutputFormat(format,()=>reference(ast,options));
      assert.equal(actual,expected,`${width} ${format} ${markdown}`);
    }
  }}
});

test("terminal Markdown width validation and option reads match the reference",()=>{
  for(const width of [undefined,0,-1,NaN,Infinity,-Infinity,"40",null,1,0.5,40])for(const options of [{width},undefined,null]){
    assert.deepEqual(outcome(()=>native.render(paragraph("text"),options)),outcome(()=>reference(paragraph("text"),options)));
  }
  function run(render){const trace=[],options=new Proxy({width:20,showFrontmatter:true,syntaxHighlight:true},{get(target,key){trace.push(key);return target[key];}});const ast={get type(){trace.push("type");return "paragraph";},get children(){trace.push("children");return [text("hello")];}};return [render(ast,options),trace];}
  assert.deepEqual(run(native.render),run(reference));
  assert.equal(native.render.name,reference.name);assert.equal(native.render.length,reference.length);
});

test("terminal Markdown tables retain missing cells, alignments and stacked fallbacks",()=>{
  const cell=value=>({type:"tableCell",children:[text(value)]});
  const row=children=>({type:"tableRow",children});
  for(const children of [[],[row([])],[row([cell("Name"),cell("Value")])],[row([cell(""),{type:"unknown"},cell("Notes")]),row([cell("A"),cell(""),cell("Long notes that wrap")]),row([cell("B")])],[paragraph("ignored"),row([cell("A"),cell("B")]),row([cell("e\u0301 👩‍💻"),{type:"unknown"},cell("extra")])]]){
    const ast={type:"table",align:["left","center","right",null],children};
    for(const width of [1,8,20,80])assert.equal(native.render(ast,{width}),reference(ast,{width}));
  }
});

test("terminal Markdown AST getters and array species preserve evaluation order",()=>{
  function run(render){
    const trace=[],wrap=(name,value)=>new Proxy(value,{get(target,key){trace.push([name,String(key)]);return Reflect.get(target,key);},has(target,key){trace.push([name,"has",key]);return key in target;}});
    class Children extends Array{static get [Symbol.species](){trace.push("species");return Array;}}
    const children=new Children(...[
      {type:"heading",depth:1,children:[text("Title")]},
      {type:"blockquote",children:[paragraph("Quote")]},
      {type:"alert",kind:"WARNING",children:[paragraph("Alert")]},
      {type:"code",lang:"js",value:"const x = true"},
      {type:"list",ordered:true,start:3,children:[wrap("item",{type:"listItem",checked:false,children:[paragraph("Item")]})]},
      {type:"table",align:["right"],children:[wrap("row",{type:"tableRow",children:[wrap("cell",{type:"tableCell",children:[text("Cell")]})]})]},
      {type:"html",value:"<b>HTML</b>"},
      {type:"frontmatter",data:{name:"Demo",nested:{n:1}}}
    ].map((node,index)=>wrap(index,node)));
    return [render(wrap("root",{type:"root",children}),{width:25,showFrontmatter:true,syntaxHighlight:true}),trace];
  }
  assert.deepEqual(run(native.render),run(reference));
});

test("terminal Markdown footnotes preserve top-level collection and expanding references",()=>{
  const ref=label=>({type:"footnoteReference",label});
  const ast={type:"root",children:[{type:"paragraph",children:[ref("missing"),ref("a")]},{type:"blockquote",children:[{type:"footnoteDefinition",label:"nested",children:[paragraph("hidden")]}]},{type:"footnoteDefinition",label:"a",children:[{type:"paragraph",children:[text("Alpha"),ref("b"),ref("nested")]}]},{type:"footnoteDefinition",label:"b",children:[paragraph("Beta")]}]};
  assert.equal(native.render(ast,{width:14}),reference(ast,{width:14}));
});

test("terminal Markdown frontmatter keeps circular formatting and arbitrary throws",()=>{
  const shared={x:1},cycle={};cycle.self=cycle;
  const ast={type:"frontmatter",data:{nil:null,text:"x",flag:false,nan:NaN,shared:{a:shared,b:shared},cycle,undefined:undefined}};
  assert.equal(native.render(ast,{showFrontmatter:true,width:20}),reference(ast,{showFrontmatter:true,width:20}));
  const thrown={};assert.throws(()=>native.render({type:"frontmatter",data:{get x(){throw thrown;}}},{showFrontmatter:true}),error=>error===thrown);
});

test("terminal Markdown preserves empty and fallback blocks and ignores supplied code tokens",()=>{
  for(const ast of [text("standalone"),{type:"heading",depth:1,children:[]},{type:"blockquote",children:[]},{type:"alert",kind:"TIP",children:[]},{type:"list",ordered:false,children:[]},{type:"listItem",checked:true,children:[paragraph("standalone")]},{type:"unknown",children:[paragraph("fallback")]},{type:"unknown"},{type:"code",lang:"js",value:"",get tokens(){throw new Error("must not read tokens");}},{type:"code",lang:"js",value:"\x1b[31mtrue\x1b[0m\n",tokens:[{kind:"plain",value:"ignored"}]}]){
    assert.equal(native.render(ast,{width:20,syntaxHighlight:true}),reference(ast,{width:20,syntaxHighlight:true}));
  }
});

test("terminal Markdown theme callbacks retain receivers, lazy lookups and layout mutation order",()=>{
  function run(api,render){
    api.resetThemeCache();const theme=api.getTheme(),trace=[];
    const saved=new Map(Object.keys(theme).map(key=>[key,Object.getOwnPropertyDescriptor(theme,key)]));
    const align=["left","left"],row=children=>({type:"tableRow",children}),cell=value=>({type:"tableCell",children:[text(value)]});
    const ast={type:"root",children:[{type:"heading",depth:1,children:[text("Header")]},{type:"code",lang:"js",value:'const value = "ok"; // note'},{type:"alert",kind:"TIP",children:[paragraph("Ready")]},{type:"table",get align(){trace.push("align");return align;},children:[row([cell("A"),cell("B")]),row([cell("abc"),cell("long")])]}]};
    for(const key of ["header","accent","muted","success","number"]){Object.defineProperty(theme,key,{configurable:true,get(){trace.push(["lookup",key]);return function(value){trace.push(["call",key,this===theme,value]);if(key==="header")align[0]="right";return value;};}});}
    try{return [render(ast,{width:40,syntaxHighlight:true}),trace];}finally{for(const [key,descriptor]of saved)Object.defineProperty(theme,key,descriptor);api.resetThemeCache();}
  }
  assert.deepEqual(run(native,native.render),run(original,reference));
});

test("terminal Markdown validates widths before later getters and preserves arbitrary theme errors",()=>{
  const thrown={};
  function run(api,render){
    api.resetThemeCache();const theme=api.getTheme(),descriptor=Object.getOwnPropertyDescriptor(theme,"header");
    Object.defineProperty(theme,"header",{configurable:true,get(){throw thrown;}});
    try{assert.throws(()=>render({type:"heading",depth:1,children:[text("title")]},{width:20}),error=>error===thrown);}
    finally{Object.defineProperty(theme,"header",descriptor);api.resetThemeCache();}
    const trace=[],options={get width(){trace.push("width");return 0;},get showFrontmatter(){throw thrown;}};
    return [outcome(()=>render({get type(){throw thrown;}},options)),trace];
  }
  assert.deepEqual(run(native,native.render),run(original,reference));
});
