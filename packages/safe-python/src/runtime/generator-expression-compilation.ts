import type { ModuleAnalysis } from "../analysis.js";
import type { ResolvedScope } from "../symbol-resolution.js";
import type { CodeConstants } from "./code-constants.js";
import type { CompilationSource } from "./compilation-source.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { compileCodeLocalLayout, type CodeLocalLayout } from "./code-local-layout.js";
import { comprehensionIsAsynchronous } from "./comprehension-asynchronous.js";

export interface CompiledGeneratorExpression<Value> {
  readonly scope:ResolvedScope;
  readonly source:CompilationSource<Value>;
  readonly kind:"generator"|"async-generator";
  readonly flags:number;
  readonly name:Value;
  readonly qualifiedName:Value;
  readonly firstLine:Value;
  readonly localLayout:CodeLocalLayout;
}

/** Generator expressions own code; materialized comprehensions do not. Their
 * outer iterator is an implicit argument, not a source-language parameter. */
export function compileGeneratorExpression<Value>(scope:ResolvedScope,analysis:Pick<ModuleAnalysis,"qualifiedNames">,
  source:CompilationSource<Value>,scopeFlags:number|undefined,constants:CodeConstants<Value>,meter:ExecutionMeter):CompiledGeneratorExpression<Value> {
  meter.checkpoint();const node=scope.scope.node;
  if(node.kind!=="comprehension"||node.collection!=="generator")throw Error("generator-expression compilation requires a generator scope");
  const qualified=analysis.qualifiedNames.get(scope.scope);
  if(qualified===undefined||scopeFlags===undefined)throw Error("missing analyzed generator-expression metadata");
  const asynchronous=comprehensionIsAsynchronous(node,meter),localLayout=compileCodeLocalLayout(scope,meter);
  meter.checkpoint(0,128);
  let name:Value,qualifiedName:Value,firstLine:Value;
  try{name=constants.string("<genexpr>");}finally{meter.checkpoint();}
  try{qualifiedName=constants.string(qualified);}finally{meter.checkpoint();}
  try{firstLine=constants.integer((node.contentSpan??node).start.line);}finally{meter.checkpoint();}
  return Object.freeze({scope,source,kind:asynchronous?"async-generator":"generator",flags:scopeFlags|(asynchronous?0x200:0x20),
    name,qualifiedName,firstLine,localLayout});
}
