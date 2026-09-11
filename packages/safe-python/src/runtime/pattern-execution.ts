import type {Expression,SourceSpan} from "../ast.js";
import type {Pattern} from "../pattern-ast.js";
import type {ExecutionMeter} from "./execution-budget.js";

export interface PatternContext<Value> {
  position?(site:SourceSpan):void;
  evaluate(expression:Expression):Value;
  equal(left:Value,right:Value):boolean;
  identical(left:Value,right:Value):boolean;
  store(name:string,value:Value):void;
  /** Undefined means ineligible or wrong length. Iteration supplies selected
   * subpatterns in order and owns extraction, never guest iterator cleanup. */
  sequence?(pattern:Extract<Pattern,{kind:"sequence"}>,subject:Value):Iterator<{pattern:Pattern;value:Value}>|undefined;
}

export class UnsupportedPatternError extends Error {
  constructor(readonly kind:Pattern["kind"]){super(`unsupported pattern: ${kind}`);this.name="UnsupportedPatternError";}
}

/** Match validated patterns without recursive host calls. Captures are staged
 * until success, then published before the guard; a false guard does not undo
 * them. Failed alternatives discard only their own pending captures. Guest
 * protocol failures propagate instead of selecting another alternative.
 * Native sequence extraction is supplied separately; mapping/class protocols
 * remain an explicit gap.
 */
export function matchPattern<Value>(pattern:Pattern,subject:Value,context:PatternContext<Value>,meter:ExecutionMeter):boolean {
  type Task={kind:"pattern";pattern:Pattern;value:Value}|{kind:"bind";name:string;value:Value}|{kind:"choice-end"}|{kind:"sequence";iterator:Iterator<{pattern:Pattern;value:Value}>};
  type Choice={patterns:readonly Pattern[];index:number;value:Value;depth:number;captures:number};
  meter.checkpoint(1,256);
  const work:Task[]=[{kind:"pattern",pattern,value:subject}],choices:Choice[]=[],captures:Array<{name:string;value:Value}>=[];
  while(work.length){
    meter.checkpoint();const task=work.pop()!;
    if(task.kind==="choice-end"){choices.pop();continue;}
    if(task.kind==="bind"){meter.checkpoint(0,40);captures.push(task);continue;}
    if(task.kind==="sequence"){
      let next:IteratorResult<{pattern:Pattern;value:Value}>;
      try{next=task.iterator.next();}finally{meter.checkpoint();}
      if(!next.done){meter.checkpoint(0,48);work.push(task,{kind:"pattern",...next.value});}
      continue;
    }
    const {pattern:node,value}=task;
    if(context.position)try{context.position(node);}finally{meter.checkpoint(0);}
    let accepted=true;
    switch(node.kind){
      case "capture":case "star":
        if(node.name){meter.checkpoint(0,40);captures.push({name:node.name.name,value});}
        break;
      case "as":
        meter.checkpoint(0,88);work.push({kind:"bind",name:node.name.name,value},{kind:"pattern",pattern:node.pattern,value});break;
      case "or":
        if(!node.patterns.length)throw Error("OR pattern requires alternatives");
        meter.checkpoint(0,128);choices.push({patterns:node.patterns,index:0,value,depth:work.length,captures:captures.length});
        work.push({kind:"choice-end"},{kind:"pattern",pattern:node.patterns[0],value});break;
      case "value":case "singleton":{
        let expected:Value;
        try{expected=context.evaluate(node.value);}finally{meter.checkpoint();}
        try{accepted=node.kind==="singleton"?context.identical(value,expected):context.equal(value,expected);}finally{meter.checkpoint();}
        break;
      }
      case "sequence":{
        if(context.sequence===undefined)throw new UnsupportedPatternError(node.kind);
        let iterator:Iterator<{pattern:Pattern;value:Value}>|undefined;
        try{iterator=context.sequence(node,value);}finally{meter.checkpoint();}
        if(iterator===undefined)accepted=false;
        else {meter.checkpoint(0,40);work.push({kind:"sequence",iterator});}
        break;
      }
      default:throw new UnsupportedPatternError(node.kind);
    }
    if(accepted)continue;
    let retry=false;
    while(choices.length){
      meter.checkpoint();const choice=choices[choices.length-1];
      work.length=choice.depth;captures.length=choice.captures;
      if(++choice.index<choice.patterns.length){
        meter.checkpoint(0,64);work.push({kind:"choice-end"},{kind:"pattern",pattern:choice.patterns[choice.index],value:choice.value});retry=true;break;
      }
      choices.pop();
    }
    if(!retry)return false;
  }
  for(const capture of captures){
    meter.checkpoint();try{context.store(capture.name,capture.value);}finally{meter.checkpoint();}
  }
  return true;
}
