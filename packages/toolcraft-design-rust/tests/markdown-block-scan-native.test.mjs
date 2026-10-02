import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {test} from "node:test";
import {referenceBlock as reference} from "./reference-markdown-block.mjs";

const native=createRequire(import.meta.url)("../dist/toolcraft-design-rust.node");
function compare(kind,input,arg=undefined,from=0){
  const actual=native.designScanMarkdownBlock(kind,input,typeof arg==="string"?arg:arg?.char??"",typeof arg==="number"?arg:arg?.length??0,from);
  assert.deepEqual(actual,reference[kind](input,arg,from),`${kind}: ${JSON.stringify(input)}`);
}

test("block Markdown scanners retain fence, heading and indentation grammar",()=>{
  for(const prefix of [""," ","   ","    ","\t"," \t","\ufeff","\ufeff   "]){
    for(const content of ["```","``","````js title extra  ","~~~\tjs\tmeta","```a`b","``` js\u00a0x", "# title ###", "##", "######\tx ##", "####### x", "#x", "# ###", "# a#", "# \\# ","---","- - -","___","***"," * * * ","-","=", "===\t","= =", "\u00a0"]){
      const input=prefix+content;
      for(const kind of ["parseOpeningFence","parseAtxHeadingLine","isThematicBreakLine","parseSetextUnderline","skipLeadingBlockIndent","readLeadingWhitespace"])compare(kind,input);
      for(const fence of [{char:"`",length:3},{char:"~",length:4}])compare("isClosingFence",input,fence);
    }
  }
});

test("block Markdown scanners retain list, task, quote, alert and footnote markers",()=>{
  for(const input of ["- item","-","+\titem","*   item","    - item","\ufeff- item","12. item","001) item","12.x","123456789012345678901234567890. item","9".repeat(400)+". item","> quote",">\tquote",">> quote", " >", "[!NOTE] text","[!WARNING]text","[!note] text","[!CAUTION]", "[^a_1-2]: text","[^bad label]: text","[^]:","[^x]:", "[x] done","[X]\tdone","[ ]","[x]bad", "[_] no"]){
    for(const kind of ["parseListMarker","parseTaskMarker","parseBlockquoteLine","parseAlertMarker","parseFootnoteDefinitionMarker"])compare(kind,input);
  }
});

test("block Markdown scanners retain escaped pipes, empty cells and column alignment",()=>{
  for(const input of ["a | b","| a | b |","|","||","|||", " | a\\|b | c | ","a|b\\|", "a\\|b", "|`a|b`|", "a| \t |c", "    a|b", "\ufeffa|b", "| --- | :--- | ---: | :---: |", "---|---", "--|---", "----|:----:", "| --- :|--- |", "😀|\ud800|\udfff"]){
    compare("parsePipeTableCellSegments",input);compare("parsePipeTableSeparator",input);
  }
});

test("block Markdown HTML scanner follows its own tag set and closing search",()=>{
  for(const tag of reference.BLOCK_HTML_TAGS){
    for(const input of [`<${tag}>`,`</${tag.toUpperCase()} >`,`<${tag} a='>' />`,` <${tag} disabled>`])compare("parseBlockHtmlTagStart",input);
  }
  for(const input of ["<span>","<script>","<div a=foo/>","<div a=>","<div / >", "<div /bad>","</div a>","<div a=`x`>","<div a=\"bad>","<div\n>","<div a=x\ny>","<div :a.b-2_ = 'x'>"])compare("parseBlockHtmlTagStart",input);
  for(const input of ["x</div>","</DIV >","</divish> </div>","</div\n>","İİİ</div>","<blockquote>hello</blocKquote>","\ud800</div>😀"]){
    for(const tag of ["div","blockquote"])for(const from of [0,1,5,10,input.length])compare("containsClosingHtmlTag",input,tag,from);
  }
});

test("block Markdown line scanning and seeded malformed input preserve UTF-16 positions",()=>{
  for(const input of ["", "a\nb\r\nc\rd", "😀\ud800\r\n\udfff\n", "\n\n"]){
    for(let start=0;start<=input.length;start++)compare("readLine",input,start);
  }
  let seed=0xabc65;
  const alphabet="azAZ09#`~_*-=+>|[!^]:.()\\ \t\r\n\"'\ud800\udc00";
  const kinds=["parseOpeningFence","parseAtxHeadingLine","isThematicBreakLine","parseSetextUnderline","parseListMarker","parseTaskMarker","parseBlockquoteLine","parseAlertMarker","parseFootnoteDefinitionMarker","parsePipeTableCellSegments","parsePipeTableSeparator","parseBlockHtmlTagStart"];
  for(let sample=0;sample<350;sample++){
    let input="";
    for(let i=0;i<35;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;input+=alphabet[seed%alphabet.length];}
    for(const kind of kinds)compare(kind,input);
    compare("readLeadingWhitespace",input);compare("skipLeadingBlockIndent",input);
  }
});
