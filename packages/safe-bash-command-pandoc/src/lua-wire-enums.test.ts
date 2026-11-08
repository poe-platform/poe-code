import {expect,it,vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert,convertToOutput} from "./engine.js";
import {createLuaFilterCapability} from "./lua-filters.js";
const encoder=new TextEncoder(),text=[{t:"Str",c:"text"}],para={t:"Para",c:text};
async function compare(blocks:unknown[],script:string,from="json") {
  const input={bytes:encoder.encode(from==="csv"?"head\nbody":JSON.stringify({"pandoc-api-version":[1,23,1,2],meta:{literal:{t:"MetaString",c:"AlignLeft"}},blocks}))};
  const options={from,to:"json",filters:[{kind:"lua" as const,path:"/filter.lua"}]};
  const filters=createLuaFilterCapability({readStream:async function*(){yield encoder.encode(script);}});
  const expected=await convert([input],options,{filters});
  const fs=new MemoryFileSystem();let output="";
  vi.spyOn(filters,"apply").mockRejectedValue(new Error("Resident Lua forbidden"));
  await convertToOutput([input],options,{filters,workingFiles:{fs,directory:"/",cacheBytes:1048576},output:{async write(bytes){output+=new TextDecoder().decode(bytes);},async close(){},async abort(){}}});
  expect(expected).toMatchObject({kind:"text",text:output});expect(await fs.readdir("/")).toEqual([]);
}
it("preserves CSV table alignment enums across retained Lua",async()=>{
  await compare([],"function Str(el) el.text=string.upper(el.text); return el end","csv");
});
it("exposes quote and math types as strings and serializes changed types",async()=>{
  await compare([{t:"Para",c:[...['SingleQuote','DoubleQuote'].map(t=>({t:'Quoted',c:[{t},text]})),...['InlineMath','DisplayMath'].map(t=>({t:'Math',c:[{t},'x']}))]}],
    'function Quoted(el) assert(type(el.quotetype)=="string"); el.quotetype="DoubleQuote"; return el end; function Math(el) assert(type(el.mathtype)=="string"); el.mathtype="InlineMath"; return el end');
});
it("preserves list styles and delimiters and encodes new list constructors",async()=>{
  const styles=['DefaultStyle','Example','Decimal','LowerRoman','UpperRoman','LowerAlpha','UpperAlpha'],delimiters=['DefaultDelim','Period','OneParen','TwoParens'];
  await compare(styles.map((style,index)=>({t:'OrderedList',c:[[1,{t:style},{t:delimiters[index%delimiters.length]}],[[para]]]})),
    'function OrderedList(el) assert(type(el.listAttributes[2])=="string" and type(el.listAttributes[3])=="string"); return pandoc.OrderedList(el.content,{2,"UpperRoman","TwoParens"}) end');
});
it("preserves citation modes as strings and re-encodes replacements",async()=>{
  await compare([{t:'Para',c:[{t:'Cite',c:[['AuthorInText','SuppressAuthor','NormalCitation'].map(t=>({citationId:'id',citationPrefix:[],citationSuffix:[],citationMode:{t},citationNoteNum:0,citationHash:0})),text]}]}],
    'function Cite(el) for _,citation in ipairs(el.citations) do assert(type(citation.citationMode)=="string"); citation.citationMode="SuppressAuthor" end; return el end');
});
it("retains alignments in column specs, heads, bodies and feet",async()=>{
  const attr=['',[],[]],alignments=['AlignLeft','AlignRight','AlignCenter','AlignDefault'];
  const row=(t:string)=>[attr,[[attr,{t},1,1,[para]]]];
  await compare([{t:'Table',c:[attr,[null,[]],[[{t:alignments[0]},{t:'ColWidthDefault'}]],[attr,[row(alignments[1]!)]],[[attr,0,[row(alignments[2]!)],[row(alignments[3]!)]]],[attr,[row(alignments[0]!)]]]}],
    'function Table(el) for _,spec in ipairs(el.colspecs) do assert(type(spec[1])=="string"); spec[1]="AlignCenter" end; return el end');
});
