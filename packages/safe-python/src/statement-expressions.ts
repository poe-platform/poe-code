import type { Expression } from "./ast.js";
import type { Statement } from "./statement-ast.js";
import { patternExpressions } from "./pattern-expressions.js";
import type {SourceMeter} from "./source.js";

type StatementPart=Expression|readonly Statement[];
type Frame={kind:"parts";parts:Generator<StatementPart>}|{kind:"body";body:readonly Statement[];index:number};

/** Enumerate executable expressions; disable descent for scope-aware statement walkers. */
export function* statementExpressions(statement: Statement, descend = true,meter?:SourceMeter): Generator<Expression> {
  meter?.checkpoint(1,176);
  const pending:Frame[]=[{kind:"parts",parts:statementParts(statement,descend,meter)}];
  try {
    while(pending.length){
      meter?.checkpoint();
      const frame=pending[pending.length-1];
      if(frame.kind==="body"){
        if(frame.index===frame.body.length){pending.pop();continue;}
        meter?.checkpoint(0,144);pending.push({kind:"parts",parts:statementParts(frame.body[frame.index++],descend,meter)});
      }else{
        meter?.checkpoint(0,32);const next=frame.parts.next();
        if(next.done){pending.pop();continue;}
        if(Array.isArray(next.value)){meter?.checkpoint(0,64);pending.push({kind:"body",body:next.value,index:0});}
        // The only array-valued parts are borrowed statement bodies.
        else yield next.value as Expression;
      }
    }
  } finally {meter?.checkpoint();}
}

function* statementParts(statement:Statement,descend:boolean,meter?:SourceMeter):Generator<StatementPart>{
  switch (statement.kind) {
    case "match":
      yield statement.subject;
      for (const clause of statement.cases) {
        meter?.checkpoint(1,128);yield* patternExpressions(clause.pattern,meter);
        if (clause.guard) yield clause.guard;
        if (descend) yield clause.body;
      }
      return;
    case "type-alias": return;
    case "class":
      yield* statement.decorators;
      for (const argument of statement.arguments) yield argument.value;
      if (descend) yield statement.body;
      return;
    case "function":
      yield* statement.decorators;
      for (const parameter of statement.parameters) {meter?.checkpoint();if (parameter.default) yield parameter.default;}
      if (descend) yield statement.body;
      return;
    case "with":
      for (const item of statement.items) {
        yield item.context;
        if (item.target) yield item.target;
      }
      if (descend) yield statement.body;
      return;
    case "try":
      if (descend) yield statement.body;
      for (const handler of statement.handlers) {
        meter?.checkpoint();
        if (handler.exception) yield handler.exception;
        if (descend) yield handler.body;
      }
      if (descend) yield statement.otherwise;
      if (descend) yield statement.finalizer;
      return;
    case "for":
      yield statement.target;
      yield statement.iterable;
      if (descend) yield statement.body;
      if (descend) yield statement.otherwise;
      return;
    case "if":
      for (const branch of statement.branches) {
        yield branch.condition;
        if (descend) yield branch.body;
      }
      if (descend) yield statement.otherwise;
      return;
    case "while":
      yield statement.condition;
      if (descend) yield statement.body;
      if (descend) yield statement.otherwise;
      return;
    case "pass": case "break": case "continue": case "global": case "nonlocal": return;
    case "import": case "import-from": return;
    case "delete": yield* statement.targets; return;
    case "expression-statement": yield statement.expression; return;
    case "return": if (statement.value) yield statement.value; return;
    case "raise":
      if (statement.exception) yield statement.exception;
      if (statement.cause) yield statement.cause;
      return;
    case "assert":
      yield statement.condition;
      if (statement.message) yield statement.message;
      return;
    case "assignment": yield statement.value; yield* statement.targets; return;
    case "augmented-assignment": yield statement.target; yield statement.value; return;
    case "annotated-assignment":
      if (statement.value) yield statement.value;
      yield statement.target;
      return;
    default: { const exhaustive: never = statement; throw new Error(`unknown statement: ${exhaustive}`); }
  }
}
