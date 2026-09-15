import {expect,it} from "vitest";
import {parseExpression} from "./expression.js";
import {parseModule} from "./module.js";
import {lex} from "./lexer.js";
import {Indentation} from "./indentation.js";
import {PythonSource} from "./source.js";

it.each([["(",")"],["[","]"],["{0:","}"]])("accepts 200 nested %s delimiters and rejects the next opener",(open,close)=>{
  expect(()=>parseExpression(open.repeat(200)+"1"+close.repeat(200))).not.toThrow();
  expect(()=>parseExpression(open.repeat(201)+"1"+close.repeat(201))).toThrow(expect.objectContaining({name:"SyntaxError",message:"too many nested parentheses",position:{offset:200*open.length,line:1,column:200*open.length}}));
});
it("rejects deeply nested input lexically before exhausting the host stack",()=>{
  expect(()=>parseExpression("(".repeat(10000)+"1"+")".repeat(10000))).toThrow("too many nested parentheses");
});
it.each(["f","t"])("includes %s-string replacement braces in the delimiter limit",prefix=>{
  expect(()=>parseExpression(prefix+'"{'+'('.repeat(199)+'1'+')'.repeat(199)+'}"')).not.toThrow();
  expect(()=>parseExpression(prefix+'"{'+'('.repeat(200)+'1'+')'.repeat(200)+'}"')).toThrow("too many nested parentheses");
  expect(()=>parseExpression('('.repeat(200)+prefix+'"{1}"'+')'.repeat(200))).toThrow("too many nested parentheses");
});
it.each(["f","t"])("bounds nested %s-string modes independently of ordinary delimiters",prefix=>{
  const source=(depth:number)=>{let value="1";for(let index=0;index<depth;index++)value=prefix+'"{'+value+'}"';return value;};
  expect(()=>[...lex(source(149))]).not.toThrow();
  expect(()=>[...lex(source(150))]).toThrow("too many nested f-strings or t-strings");
});
it("accepts 99 indentation levels and rejects level 100 without growing state",()=>{
  const indentation=new Indentation(),source=new PythonSource("x");
  for(let level=1;level<=99;level++)expect(indentation.accept(" ".repeat(level),source)).toEqual(["INDENT"]);
  expect(()=>indentation.accept(" ".repeat(100),source)).toThrow(expect.objectContaining({name:"IndentationError",message:"too many levels of indentation"}));
  expect(indentation.finish()).toHaveLength(99);
});
it.each(["'",'"',"'''",'"""'])("attributes excess interpolation depth to the final opening %s quote",quote=>{
  let source="1";for(let index=0;index<150;index++)source="f"+quote+"{"+source+"}"+quote;
  const offset=149*(quote.length+2)+quote.length;
  expect(()=>[...lex(source)]).toThrow(expect.objectContaining({message:"too many nested f-strings or t-strings",position:{offset,line:1,column:offset}}));
});
it("rejects excessive nested suites through the module parser",()=>{
  const source=(depth:number)=>Array.from({length:depth},(_,index)=>" ".repeat(index)+"if True:\n").join("")+" ".repeat(depth)+"pass\n";
  expect(()=>parseModule(source(99))).not.toThrow();
  expect(()=>parseModule(source(100))).toThrow(expect.objectContaining({name:"IndentationError",message:"too many levels of indentation",position:{offset:5850,line:101,column:0}}));
});
