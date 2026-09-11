import type {Statement} from "../statement-ast.js";
import type {ExecutionMeter} from "./execution-budget.js";

/** Rebuild executable compound suites, not the analyzed AST. Definitions keep
 * identity and their own compiler optimizes their bodies. Work is iterative. */
export function eliminateAssertions(body:readonly Statement[],meter:ExecutionMeter):readonly Statement[] {
  try {
    meter.checkpoint(1,96);
    const pending:{source:readonly Statement[];output:Statement[]}[]=[];
    const suite=(source:readonly Statement[]):Statement[]=>{
      meter.checkpoint(1,88);const output:Statement[]=[];pending.push({source,output});return output;
    };
    const result=suite(body);
    while(pending.length){
      meter.checkpoint();const {source,output}=pending.pop()!;
      for(const statement of source){
        meter.checkpoint();if(statement.kind==="assert")continue;
        let compiled=statement;
        switch(statement.kind){
          case "with":meter.checkpoint(0,128);compiled={...statement,body:suite(statement.body)};break;
          case "for":case "while":meter.checkpoint(0,128);compiled={...statement,body:suite(statement.body),otherwise:suite(statement.otherwise)};break;
          case "if":
            meter.checkpoint(0,160+64*statement.branches.length);
            compiled={...statement,branches:statement.branches.map(branch=>{meter.checkpoint();return{...branch,body:suite(branch.body)};}),otherwise:suite(statement.otherwise)};break;
          case "try":
            meter.checkpoint(0,192+96*statement.handlers.length);
            compiled={...statement,body:suite(statement.body),handlers:statement.handlers.map(handler=>{meter.checkpoint();return{...handler,body:suite(handler.body)};}),otherwise:suite(statement.otherwise),finalizer:suite(statement.finalizer)};break;
          case "match":
            meter.checkpoint(0,160+96*statement.cases.length);
            compiled={...statement,cases:statement.cases.map(clause=>{meter.checkpoint();return{...clause,body:suite(clause.body)};})};break;
        }
        meter.checkpoint(0,8);output.push(compiled);
      }
    }
    return result;
  } finally {meter.checkpoint();}
}
