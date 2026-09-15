import {expect,it,vi} from "vitest";
import {lex} from "./lexer.js";
import {PythonSource} from "./source.js";
import {Indentation} from "./indentation.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["","+","()","(+)\n"," \n","#comment","\n","\t+\n"])("charges structural lexer storage independently of positions and indentation: %j",source=>{
  const position={offset:0,line:1,column:0};
  const spies=[vi.spyOn(PythonSource.prototype,"position","get").mockReturnValue(position),vi.spyOn(Indentation.prototype,"accept").mockReturnValue([]),vi.spyOn(Indentation.prototype,"finish").mockReturnValue([])];
  try{expect(()=>[...lex(source,{meter:new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:288})})]).toThrow(ExecutionLimitError);}finally{for(const spy of spies)spy.mockRestore();}
});
it("charges long indentation-prefix copies",()=>{
  expect(()=>[...lex(" ".repeat(10000)+"+",{meter:new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:2000})})]).toThrow(ExecutionLimitError);
});
