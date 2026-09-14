import type {ModuleAnalysis} from "../analysis.js";
import type {Expression} from "../ast.js";
import type {FunctionNode} from "../expression-context.js";
import type {Statement} from "../statement-ast.js";
import {CodePointString} from "./code-point-string.js";
import {literalStringInternName} from "./constant-values.js";
import type {CompiledClassBody} from "./class-compilation.js";
import {ExecutionBudget, type ExecutionMeter} from "./execution-budget.js";
import type {CompiledFunction} from "./function-compilation.js";
import type {CompiledGeneratorExpression} from "./generator-expression-compilation.js";
import type {ComprehensionNode} from "./comprehension-execution.js";
import type {LiteralExpression} from "./literal-pool.js";
import {compileProgram, type CompiledProgram} from "./program-compilation.js";
import type {RuntimeValue, RuntimeValues} from "./runtime-values.js";

type FrozenConstant =
  | {readonly kind: "string"; readonly points: CodePointString}
  | {readonly kind: "interned"; readonly name: string; readonly points: CodePointString}
  | {readonly kind: "integer"; readonly value: number}
  | {readonly kind: "literal"; readonly node: LiteralExpression}
  | {readonly kind: "tuple"; readonly items: readonly FrozenConstant[]};
type ClassNode = Extract<Statement, {kind: "class"}>;

/** Precompile trusted, interpreter-owned library definitions. Never used for
 * guest source. Only immutable syntax, layouts and constant recipes are shared;
 * guest values, code records and all code/literal maps are materialized per load.
 * Preparation uses the ordinary compiler without rewriting library source.
 */
export class RuntimeFrozenProgram {
  readonly #constants: FrozenConstant[] = [];
  readonly #program: CompiledProgram<FrozenConstant>;

  constructor(analysis: ModuleAnalysis, filename: string) {
    const meter = new ExecutionBudget({maxSteps: Number.MAX_SAFE_INTEGER, maxAllocatedBytes: Number.MAX_SAFE_INTEGER});
    const retain = (constant: FrozenConstant): FrozenConstant => {
      this.#constants.push(Object.freeze(constant));
      return constant;
    };
    this.#program = compileProgram<FrozenConstant>(analysis, {filename, stripDocstring: false}, {
      string: value => retain({kind: "string", points: new CodePointString(Uint32Array.from(value, character => character.codePointAt(0)!))}),
      integer: value => retain({kind: "integer", value}),
      literal: node => {
        if (node.literalKind !== "string") return retain({kind: "literal", node});
        const points = node.value as Uint32Array, name = literalStringInternName(points);
        const payload = new CodePointString(points);
        return retain(name === undefined ? {kind: "string", points: payload} : {kind: "interned", name, points: payload});
      },
      tuple: items => retain({kind: "tuple", items: Object.freeze([...items])}),
    }, meter);
  }

  instantiate(values: RuntimeValues, meter: ExecutionMeter): CompiledProgram<RuntimeValue> {
    meter.checkpoint(1, 448);
    const constants = new Map<FrozenConstant, RuntimeValue>();
    // Replay factory order, including literals and small-value interning, before
    // assembling code graphs. Recipes refer only to earlier constant recipes.
    for (const constant of this.#constants) {
      meter.checkpoint(1, 48);
      let value: RuntimeValue;
      switch (constant.kind) {
        case "string": value = values.stringPoints(constant.points, "canonical"); break;
        case "interned": value = values.internString(constant.name, constant.points); break;
        case "integer": value = values.integer(constant.value); break;
        case "literal": value = values.literal(constant.node); break;
        case "tuple": {
          meter.checkpoint(constant.items.length, 32 + 8 * constant.items.length);
          value = values.tuple(constant.items.map(item => constants.get(item)!));
          break;
        }
      }
      constants.set(constant, value);
    }
    const prepared = this.#program;
    meter.checkpoint(1, 480);
    const source = {filename: constants.get(prepared.module.source!.filename)!};
    const docstring = (value: {readonly value: FrozenConstant} | undefined) => {
      if (value === undefined) return undefined;
      meter.checkpoint(1, 32);
      return {value: constants.get(value.value)!};
    };
    const folded = new Map<Expression, RuntimeValue>();
    const literals = Object.assign(new Map<LiteralExpression, RuntimeValue>(), {folded});
    for (const [node, value] of prepared.literals!) {
      meter.checkpoint(1, 48); literals.set(node, constants.get(value)!);
    }
    for (const [node, value] of prepared.literals!.folded!) {
      meter.checkpoint(1, 48); folded.set(node, constants.get(value)!);
    }
    const classes = new Map<ClassNode, CompiledClassBody<RuntimeValue>>();
    const functions = new Map<FunctionNode, CompiledFunction<RuntimeValue>>();
    const classFunctions = new Map<ClassNode, CompiledFunction<RuntimeValue>>();
    const generatorExpressions = new Map<ComprehensionNode, CompiledGeneratorExpression<RuntimeValue>>();
    for (const [node, code] of prepared.classes) {
      meter.checkpoint(1, 240);
      classes.set(node, {...code, source, qualifiedName: constants.get(code.qualifiedName)!,
        firstLine: constants.get(code.firstLine)!, staticAttributes: constants.get(code.staticAttributes)!, docstring: docstring(code.docstring)});
    }
    for (const [node, code] of prepared.generatorExpressions!) {
      meter.checkpoint(1, 240);
      generatorExpressions.set(node, {...code, source, name: constants.get(code.name)!,
        qualifiedName: constants.get(code.qualifiedName)!, firstLine: constants.get(code.firstLine)!});
    }
    meter.checkpoint(prepared.comprehensions!.size, 64 + 48 * prepared.comprehensions!.size);
    const comprehensions = new Map(prepared.comprehensions);
    const shared = {source, definitions: functions, classDefinitions: classFunctions, literals, generatorExpressions, comprehensions};
    for (const [node, code] of prepared.functions) {
      if (code.body.kind !== "suite" && code.body.kind !== "expression") throw Error("unexpected compiled function body");
      meter.checkpoint(1, 304);
      functions.set(node, {...code, ...shared, body: code.body, name: constants.get(code.name)!,
        qualifiedName: constants.get(code.qualifiedName)!, firstLine: constants.get(code.firstLine)!, docstring: docstring(code.docstring)});
    }
    for (const [node, code] of prepared.classFunctions) {
      meter.checkpoint(1, 336);
      classFunctions.set(node, {...code, ...shared, body: {kind: "class", code: classes.get(node)!}, name: constants.get(code.name)!,
        qualifiedName: constants.get(code.qualifiedName)!, firstLine: constants.get(code.firstLine)!, docstring: docstring(code.docstring)});
    }
    meter.checkpoint(1, 128);
    return {module: {...prepared.module, source, docstring: docstring(prepared.module.docstring)},
      functions, classes, classFunctions, generatorExpressions, comprehensions, literals};
  }
}
