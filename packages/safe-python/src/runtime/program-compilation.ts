import type { ModuleAnalysis,ExpressionAnalysis } from "../analysis.js";
import type {Expression} from "../ast.js";
import type { FunctionNode } from "../expression-context.js";
import type { Statement } from "../statement-ast.js";
import type { ResolvedScope } from "../symbol-resolution.js";
import { compileClassBody, type ClassConstants, type CompiledClassBody } from "./class-compilation.js";
import { compileFunction, type CompiledFunction } from "./function-compilation.js";
import { compileSuite } from "./suite-compilation.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { compileLiteralPool, type LiteralExpression, type LiteralPool } from "./literal-pool.js";
import type { ComprehensionNode } from "./comprehension-execution.js";
import {createCompilationSource,type CompilationSource,type CodeCompilationOptions} from "./compilation-source.js";
import {compileCodeScopeFlags} from "./code-scope-flags.js";
import {compileGeneratorExpression,type CompiledGeneratorExpression} from "./generator-expression-compilation.js";

export interface CompiledModule<Value> {
  /** Eval-mode root; never interpreted as a docstring or statement suite. */
  readonly expression?:Expression;
  readonly flags?:number;
  readonly source?:CompilationSource<Value>;
  readonly scope: ResolvedScope;
  readonly docstring: { readonly value: Value } | undefined;
  readonly statements: readonly Statement[];
}

export interface CompiledProgram<Value> {
  readonly comprehensions?: ReadonlyMap<ComprehensionNode,ResolvedScope>;
  readonly generatorExpressions?:ReadonlyMap<ComprehensionNode,CompiledGeneratorExpression<Value>>;
  readonly literals?: LiteralPool<Value>;
  readonly module: CompiledModule<Value>;
  readonly functions: ReadonlyMap<FunctionNode, CompiledFunction<Value>>;
  readonly classes: ReadonlyMap<Extract<Statement, { kind: "class" }>, CompiledClassBody<Value>>;
  readonly classFunctions: ReadonlyMap<Extract<Statement, { kind: "class" }>, CompiledFunction<Value>>;
}

/** Eagerly prepare all analyzed function/class code before module execution.
 * AST identity keys let definition/expression adapters obtain code without scope
 * searches or recompilation. Traversal includes unexecuted suites, defaults and
 * comprehension children; no guest code runs here. The maps are host compiler
 * metadata, not exposed guest mappings or a security boundary. Comprehension
 * scope identities travel with nested code. General constant folding, guest code objects and complete allocation
 * accounting remain unfinished; this is not a standalone Python execution API.
 */
export function compileProgram<Value>(
  analysis: ModuleAnalysis|ExpressionAnalysis, options: CodeCompilationOptions,
  constants: ClassConstants<Value> & { literal?(node: LiteralExpression): Value }, meter: ExecutionMeter
): CompiledProgram<Value> {
  try {
  meter.checkpoint(1, 448);
  if (analysis.scopes.scope.kind !== "module" || analysis.scopes.scope.node !== analysis.module)
    throw new Error("program compilation requires a matching analyzed module scope");
  const source=createCompilationSource(options.filename??"<string>",constants,meter);
  const scopeFlags=compileCodeScopeFlags(analysis.scopes.scope,analysis.futureFeatures,meter,analysis.futureFlags);
  const expression="expression" in analysis?analysis.expression:undefined;
  let module:CompiledModule<Value>;
  if(expression!==undefined){
    const statement=analysis.module.body[0];
    if(analysis.module.body.length!==1||statement.kind!=="expression-statement"||statement.expression!==expression)throw new Error("expression compilation requires a matching analyzed expression");
    meter.checkpoint(1,80);
    module={flags:scopeFlags.get(analysis.scopes.scope),source,scope:analysis.scopes,expression,docstring:undefined,statements:[]};
  }else module = { flags:scopeFlags.get(analysis.scopes.scope),source,scope: analysis.scopes, ...compileSuite(analysis.module.body, options.stripDocstring, constants, meter) };
  let literals:LiteralPool<Value>|undefined;
  if(constants.literal){
    meter.checkpoint(0,128);
    literals=compileLiteralPool(analysis.module.body,constants.literal.bind(constants),meter,constants.tuple.bind(constants),expression===undefined);
  }
  const functions = new Map<FunctionNode, CompiledFunction<Value>>();
  const comprehensions = new Map<ComprehensionNode,ResolvedScope>();
  const generatorExpressions=new Map<ComprehensionNode,CompiledGeneratorExpression<Value>>();
  const classes = new Map<Extract<Statement, { kind: "class" }>, CompiledClassBody<Value>>();
  const classFunctions = new Map<Extract<Statement, { kind: "class" }>, CompiledFunction<Value>>();
  const pending = [analysis.scopes];
  while (pending.length) {
    meter.checkpoint();
    const scope = pending.pop()!, node = scope.scope.node;
    if (node.kind === "function" || node.kind === "lambda") {
      const code = compileFunction(scope, analysis, options, constants, meter,source,scopeFlags.get(scope.scope));
      meter.checkpoint(0, 256);
      functions.set(node, { ...code, definitions: functions, classDefinitions: classFunctions, comprehensions, generatorExpressions, literals });
    }
    else if (node.kind === "class") {
      const code = compileClassBody(scope, analysis, options, constants, meter,source,scopeFlags.get(scope.scope));
      meter.checkpoint(0, 48);
      classes.set(node, code);
      meter.checkpoint(0, 288);
      classFunctions.set(node, {
        flags:code.flags,source,scope, kind: "function", name: constants.string(node.name.name),
        qualifiedName: code.qualifiedName, firstLine: code.firstLine,
        docstring: undefined, body: { kind: "class", code },
        definitions: functions, classDefinitions: classFunctions, comprehensions, generatorExpressions, literals
      });
    }
    else if(node.kind==="comprehension"||node.kind==="dictionary-comprehension") {
      meter.checkpoint(0,48);comprehensions.set(node,scope);
      if(node.kind==="comprehension"&&node.collection==="generator"){
        const code=compileGeneratorExpression(scope,analysis,source,scopeFlags.get(scope.scope),constants,meter);
        meter.checkpoint(0,48);generatorExpressions.set(node,code);
      }
    }
    for (let index = scope.children.length - 1; index >= 0; index--) { meter.checkpoint(1,8); pending.push(scope.children[index]); }
  }
  return { module, functions, classes, classFunctions, comprehensions, generatorExpressions, literals };
  } finally { meter.checkpoint(); }
}
