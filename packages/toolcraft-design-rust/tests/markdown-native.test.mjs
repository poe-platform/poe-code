import assert from "node:assert/strict";
import {test} from "node:test";
import * as reference from "../../toolcraft-design/dist/terminal-markdown/index.js";
import {extractFrontmatter as referenceFrontmatter} from "../../toolcraft-design/dist/terminal-markdown/parser/frontmatter.js";
const load=()=>import("../dist/index.js");

test("Markdown demo subpath preserves every named fixture and absent unknown-name result",async()=>{
  const {getMarkdownDemo}=await import("toolcraft-design-rust/terminal-markdown/demo-content");
  const {getMarkdownDemo:original}=await import("../../toolcraft-design/dist/terminal-markdown/demo-content.js");
  for(const name of [undefined,"default","minimal","code-blocks","blockquotes","lists","tables","alerts","unknown",null,42,{},new String("minimal")])assert.equal(getMarkdownDemo(name),original(name));
  assert.equal(getMarkdownDemo.name,original.name);assert.equal(getMarkdownDemo.length,original.length);
});

function snapshot(value){
  if(!value||typeof value!=="object"||value instanceof Date)return value;
  if(Array.isArray(value))return value.map(snapshot);
  return {keys:Reflect.ownKeys(value),properties:Object.fromEntries(Reflect.ownKeys(value).map(key=>[key,{...Object.getOwnPropertyDescriptor(value,key),value:snapshot(value[key])}]))};
}

test("public Markdown parser preserves frontmatter identity and hidden UTF-8 ranges",async()=>{
  const native=await load();
  const inputs=["","# Heading\n\n**body**", "---\ntitle: Demo\ndraft: false\n---\n# Body", "---\n---\n", "---\nmissing closing fence", "\ufeff---\r\ntitle: café\r\n---\r\n😀\r\n", "---\rtags: [one, two]\r---\r# Body", "---\n__proto__: {owner: attacker}\nconstructor: value\n---\nBody", "---\nbase: &x {name: Item}\nalias: *x\n---\nBody", "%YAML 1.1\n---\ndate: 2025-01-02\n---\nBody"];
  for(const input of inputs){
    const actual=native.parse(input),expected=reference.parse(input);
    assert.deepEqual(snapshot(actual),snapshot(expected),JSON.stringify(input));
    assert.equal(JSON.stringify(actual),JSON.stringify(expected));
    if(actual.frontmatter!==undefined)assert.equal(actual.frontmatter,actual.ast.children[0].data);
  }
  for(const input of ["---\nscalar\n---\nbody","---\n- item\n---\nbody"]){
    let expected;try{reference.parse(input);}catch(error){expected=error;}
    assert.throws(()=>native.parse(input),error=>error.name===expected.name&&error.message===expected.message);
  }
});

test("public Markdown string wrappers compose the native parser and AST renderers",async()=>{
  const native=await load();
  const markdown=['---','title: Example','---','# Status','','> [!NOTE] **Ready**','', '- [x] Complete', '- [ ] Next', '', '| A | B |','| --- | ---: |','| one | two |','','```js','const x = true;','```','','[link](https://example.com) and note[^one]','','[^one]: Definition.'].join('\n');
  for(const options of [undefined,{width:30,showFrontmatter:true},{syntaxHighlight:true}])assert.equal(native.renderMarkdown(markdown,options),reference.renderMarkdown(markdown,options));
  for(const options of [undefined,{showFrontmatter:true,syntaxHighlight:true},{allowRawHtml:true}])assert.equal(native.renderMarkdownHtml(markdown,options),reference.renderMarkdownHtml(markdown,options));
  for(const options of [undefined,{includeFrontmatter:true,expandLinks:true},{announceHeadings:false,announceCode:false,announceAlerts:false}])assert.equal(native.renderMarkdownPlaintext(markdown,options),reference.renderMarkdownPlaintext(markdown,options));
  for(const name of ["parse","renderMarkdown","renderMarkdownHtml","renderMarkdownPlaintext"]){assert.equal(native[name].name,reference[name].name);assert.equal(native[name].length,reference[name].length);}
});

test("Markdown subpaths share root function identity and expose parser helpers",async()=>{
  const root=await load();
  const markdown=await import("toolcraft-design-rust/terminal-markdown/index");
  for(const name of ["parse","render","renderHtml","renderPlaintext","renderMarkdown","renderMarkdownHtml","renderMarkdownPlaintext"])assert.equal(markdown[name],root[name]);
  const parser=await import("toolcraft-design-rust/terminal-markdown/parser");assert.equal(parser.parse,root.parse);
  const terminal=await import("toolcraft-design-rust/terminal-markdown/renderer");assert.equal(terminal.render,root.render);
  const html=await import("toolcraft-design-rust/terminal-markdown/html-renderer");assert.equal(html.renderHtml,root.renderHtml);
  const plain=await import("toolcraft-design-rust/terminal-markdown/plaintext-renderer");
  const entry=await import("toolcraft-design-rust/render-markdown-plaintext");
  for(const name of ["renderPlaintext","renderMarkdownPlaintext"]){assert.equal(plain[name],root[name]);assert.equal(entry[name],root[name]);}
  const {extractFrontmatter}=await import("toolcraft-design-rust/terminal-markdown/parser/frontmatter");
  for(const input of ["Body","---\ntitle: Hello\n---\nBody","---\nmissing"]){assert.deepEqual(snapshot(extractFrontmatter(input)),snapshot(referenceFrontmatter(input)));}
  const {parseBlocks,parseBlockDocument}=await import("toolcraft-design-rust/terminal-markdown/parser/block");
  const document=parseBlockDocument("---\ntitle: Hello\n---\nBody");
  assert.deepEqual(document.frontmatter,{title:"Hello"});assert.equal(document.frontmatterRange.end,21);
  assert.deepEqual(parseBlocks("# Heading"),root.parse("# Heading").ast.children);
  const {parseInline}=await import("toolcraft-design-rust/terminal-markdown/parser/inline");assert.equal(parseInline("**bold**")[0].type,"strong");
  const {highlightCodeBlock}=await import("toolcraft-design-rust/terminal-markdown/parser/code-highlight");assert.ok(highlightCodeBlock({type:"code",lang:"js",value:"true"}));
  assert.deepEqual(Object.keys(await import("toolcraft-design-rust/terminal-markdown/ast")),[]);
});
