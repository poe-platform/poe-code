import assert from "node:assert/strict";
import {test} from "node:test";
import {referenceBlock as reference} from "./reference-markdown-block.mjs";

const load=()=>import("../dist/markdown-block-body.js");
function snapshot(nodes){return nodes.map(node=>({keys:Reflect.ownKeys(node),range:Object.getOwnPropertyDescriptor(node,"range"),node:{...node,...(node.children?{children:snapshot(node.children)}:{})}}));}
function compare(parse,input,offset=0,prefer=false){
  const expected=reference.applyInlineParsing(reference.parseBlocksWithOptions(input,{offsets:reference.createOffsetMap(input,offset),preferListToThematicBreak:prefer}));
  assert.deepEqual(snapshot(parse(input,offset,prefer)),snapshot(expected),JSON.stringify(input));
}

test("Markdown block construction preserves fence, heading, paragraph and HTML ranges",async()=>{
  const {parseBlockBody}=await load();
  const cases=[""," \t\r\n","plain\ncontinued", "# Title ###\n\nParagraph **bold**.\n", "Setext\n===\n\nsecond\n---\n", "a\nb\n---\n", "---\n***\n_ _ _\n", "```js title\nconst x = true;\n```\nafter\n", "~~~ a\ntext\r\n~~~\r\n", "```\nunterminated", "```\n````x\n````\n", "\ufeff# BOM\r\n😀\r\n界\r\ud800", "<div>\n**raw**\n\n</DIV> trailing\nafter", "<hr>\nafter", "<div/>\nafter", "<span>x</span>\nafter", "</table>\ntext", "<div>unterminated\n\nlast", "    # indented\n\ttext"];
  for(const input of cases)for(const offset of [0,17,0.5])compare(parseBlockBody,input,offset);
});

test("Markdown nested lists, tasks, quotes and alerts retain mapped indentation",async()=>{
  const {parseBlockBody}=await load();
  const cases=[
    "- one\n- two\n", "1. one\n2) two\n- three\n", "- [x] done\n- [ ] pending\n- [X] done\n", "- # stays inline\n  continued\n", "- first\n\n  next paragraph\n\n- second\n", "- first\n  - nested\n    1. deeper\n  - next\n", "- first\n\tcontinued\n\t- nested\n", "  - first\n\tcontinued\n", "- one\n\n\noutside\n", "-\n- empty\n", "* * *\n", "- first\n  * * *\n", "> quote\n> continued\n\nplain\n", ">\t😀\r\n> > nested\r\n> \r\n> # heading\r\n", "> [!NOTE]\n> **Notice**\n> - item\n", "> [!WARNING] first\n> second\n", "> [!TIP]\n", "> [!bad] ordinary\n", "- item\n  > [!CAUTION] nested\n  > body\n", "\ufeff- item\n   continued\n"
  ];
  for(const input of cases)for(const prefer of [false,true])compare(parseBlockBody,input,31,prefer);
});

test("Markdown tables and footnotes preserve escaped-cell offsets and recursive definitions",async()=>{
  const {parseBlockBody}=await load();
  const cases=[
    "| A | B |\n| :--- | ---: |\n| one | two |\n", "A|B|C\n---|:---:|---:\nx|y\nx|y|z|extra\n", "| a\\|b | 😀 |\n| --- | --- |\n| c\\|d | \ud800 |\n", "A|B\n---|---\n# stops table\n", "paragraph\nA|B\n---|---\nx|y\n", "> A|B\n> ---|---\n> x|y\n", "- item\n  A|B\n  ---|---\n  x|y\n", "A|B\n--|---\nx|y\n", "[^one]: definition\n\nText[^one] and [^missing].\n", "Text[^later]\n\n[^later]: **Later**\n    continued\n\n    - nested\n      > quote\n", "[^a]: one\n\n\noutside\n", "> [^quoted]: inner\n\nuses[^quoted]\n", "- item[^nested]\n  [^nested]: inside\n", "[^a]: uses[^b]\n[^b]: uses[^a]\n", "[^a]:\n\tparagraph\n\t\n\tsecond\n"
  ];
  for(const input of cases)compare(parseBlockBody,input,23);
});

test("Markdown body parser differentially handles seeded block combinations",async()=>{
  const {parseBlockBody}=await load();
  const pieces=["plain **bold**", "", "# Heading", "---", "=", "* * *", "- item", "  continued", "  - nested", "> quote", "> [!NOTE] alert", "```js", "```", "~~~", "| a | b |", "| --- | :---: |", "| c\\|d | 😀 |", "[^one]: note", "uses[^one]", "    continuation", "<div>", "</div>", "\tindented", "\ud800", "[link](u)"];
  let seed=0x965ef;
  for(let sample=0;sample<500;sample++){
    const lines=[];
    for(let index=0;index<14;index++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;lines.push(pieces[seed%pieces.length]);}
    compare(parseBlockBody,lines.join(sample%3===0?"\r\n":sample%3===1?"\n":"\r"),sample%7,sample%2===0);
  }
});

test("Markdown body parser rejects excessive nesting without poisoning later parses",async()=>{
  const {parseBlockBody}=await load();
  assert.throws(()=>parseBlockBody("> ".repeat(150)+"text"),RangeError);
  compare(parseBlockBody,"> **recovers**\n");
});

test("Markdown body parser preserves numeric offsets and character-host thrown identity",async()=>{
  const {parseBlockBody}=await load();
  for(const offset of [-0,NaN,Infinity,-Infinity])compare(parseBlockBody,"**A** *B*\n\n> C\n",offset);
  for(const thrown of [undefined,null,"failure",7,{},new Error("classification")]){
    const original=RegExp.prototype.test;
    let caught=false,value;
    try {
      RegExp.prototype.test=()=>{throw thrown;};
      try {parseBlockBody("**x**");}catch(error){caught=true;value=error;}
    } finally {RegExp.prototype.test=original;}
    assert.equal(caught,true);assert.equal(value,thrown);
  }
  compare(parseBlockBody,"*still works*");
});
