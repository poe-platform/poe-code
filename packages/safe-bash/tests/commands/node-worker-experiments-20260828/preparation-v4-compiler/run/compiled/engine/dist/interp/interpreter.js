import { promiseReplayContext } from "./promise-replay.js";
import { SandboxJobQueue, suspendJob } from "./jobs.js";
import { attachErrorSpan, formatErrorStack, readErrorSpan, replaceErrorStack } from "../error/shape.js";
import { evaluateArrowFunctionExpression, evaluateFunctionExpression, evaluateAwaitExpression, emitResumeBreakpoint, createInterpretedClosure, normalizeClosureResult } from "./async.js";
import { HostCallResumabilityError } from "./host-call.js";
import { Budget, SandboxError } from "./budget.js";
import { coerceThrownValue, createCapturedException, evaluateThrowStatement as evaluateThrowStatementResult, evaluateTryStatement as evaluateTryStatementResult, isCapturedException, surfaceThrownValue } from "./exceptions.js";
import { callArrayMethod, getArrayMember, isArrayMethodName } from "./methods/array.js";
import { getFunctionMember } from "./methods/function.js";
import { callMapMethod, getMapMember, isMapMethodName } from "./methods/map.js";
import { callNumberMethod, getNumberMember, isNumberMethodName } from "./methods/number.js";
import { getPromiseMember } from "./promise.js";
import { getSandboxIterator } from "./iteration.js";
import { assertCollectionMutable } from "./running-state.js";
import { getGeneratorMember } from "./methods/generator.js";
import { getRegexMember, isRegexMethodName, setRegexMember } from "./methods/regex.js";
import { bindPattern } from "./patterns.js";
import { callStringMethod, getStringMember, isStringMethodName, validateStringMethodArguments } from "./methods/string.js";
import { callSetMethod, getSetMember, isSetMethodName } from "./methods/set.js";
import { isSandboxErrorConstructor, isSandboxErrorConstructorInstance } from "./globals/error.js";
import { isSandboxMapConstructor, isSandboxSetConstructor } from "./globals/collections.js";
import { createSandboxRegex, allocateProducedSandboxValue, isSandboxClosure, isSandboxGenerator, isSandboxMap, isSandboxPromise, isSandboxRegex, isSandboxSet, measureSandboxData } from "./values.js";
import { Scope } from "./scope.js";
import { hoistVarDeclarations } from "./var-hoist.js";
const taggedTemplateRawArrays = new WeakMap();
const dispatchTable = {
    ArrayExpression: evaluateArrayExpression,
    AssignmentExpression: evaluateAssignmentExpression,
    ArrowFunctionExpression: evaluateArrowFunction,
    AwaitExpression: evaluateAwait,
    BinaryExpression: evaluateBinaryExpression,
    BlockStatement: evaluateBlockStatement,
    BooleanLiteral: evaluatePrimitiveLiteral,
    CallExpression: evaluateCallExpression,
    ConditionalExpression: evaluateConditionalExpression,
    ContinueStatement: evaluateContinueStatement,
    DoWhileStatement: evaluateDoWhileStatement,
    EmptyStatement: evaluateEmptyStatement,
    ExportDefaultDeclaration: evaluateExportDefaultDeclaration,
    ExportNamedDeclaration: evaluateExportNamedDeclaration,
    ExpressionStatement: evaluateExpressionStatement,
    ForInStatement: evaluateForInStatement,
    ForOfStatement: evaluateForOfStatement,
    ForStatement: evaluateForStatement,
    FunctionDeclaration: evaluateFunctionDeclaration,
    FunctionExpression: evaluateFunction,
    IfStatement: evaluateIfStatement,
    Identifier: evaluateIdentifier,
    LogicalExpression: evaluateLogicalExpression,
    MemberExpression: evaluateMemberExpression,
    MetaProperty: evaluateMetaProperty,
    NewExpression: evaluateNewExpression,
    NullLiteral: evaluatePrimitiveLiteral,
    NumericLiteral: evaluatePrimitiveLiteral,
    RegexLiteral: evaluateRegexLiteral,
    ObjectExpression: evaluateObjectExpression,
    BreakStatement: evaluateBreakStatement,
    ReturnStatement: evaluateReturnStatement,
    SequenceExpression: evaluateSequenceExpression,
    StringLiteral: evaluatePrimitiveLiteral,
    SwitchStatement: evaluateSwitchStatement,
    TaggedTemplateExpression: evaluateTaggedTemplateExpression,
    TemplateLiteral: evaluateTemplateLiteral,
    ThrowStatement: evaluateThrowStatement,
    ThisExpression: evaluateThisExpression,
    TryStatement: evaluateTryStatement,
    UnaryExpression: evaluateUnaryExpression,
    UpdateExpression: evaluateUpdateExpression,
    VariableDeclaration: evaluateVariableDeclaration,
    WhileStatement: evaluateWhileStatement,
    YieldExpression: evaluateYieldExpression,
    UndefinedLiteral: evaluatePrimitiveLiteral
};
export async function interpret(node, options = {}) {
    const budget = options.budget ?? new Budget();
    const scope = options.scope === undefined
        ? new Scope(options.bindings, undefined, undefined, {
            chargeData: false
        }, options.snapshot?.bindings).child({}, { functionBoundary: true })
        : options.useScopeDirectly === true && options.bindings === undefined
            ? options.scope
            : options.scope.child(options.bindings ?? {}, {
                functionBoundary: true
            });
    const stats = { nodeVisits: 0 };
    Object.defineProperties(stats, {
        currentDataSize: { enumerable: false, value: 0, writable: true },
        peakDataSize: { enumerable: false, value: 0, writable: true }
    });
    const activeLoopIterations = new Map();
    const jobs = new SandboxJobQueue();
    hoistVarDeclarations(node, scope);
    const context = {
        budget,
        callStack: [],
        onYield: options.onYield,
        captureReplayState: options.captureReplayState,
        rootNode: node,
        scope,
        signal: options.signal,
        stats,
        activeLoopIterations,
        restoredLoopIterations: new Map(Object.entries(options.snapshot?.loopIterations ?? {}).map(([nodeId, iteration]) => [
            Number(nodeId),
            iteration
        ])),
        generatorResume: options.generatorResume,
        generatorYield: options.generatorYield,
        resumeTarget: { nodeId: options.snapshot?.resumeNodeId }
    };
    const evaluation = await jobs.run(() => evaluateNode(node, context));
    await jobs.drain();
    const snapshot = scope.snapshot();
    reconcileDataBudget(budget, stats, scope, "hasValue" in evaluation && evaluation.hasValue ? evaluation.value : undefined);
    if (evaluation.kind === "error") {
        return {
            ok: false,
            error: evaluation.error,
            snapshot,
            stats
        };
    }
    if (evaluation.kind === "throw") {
        if (options.surfaceUnhandledThrows === true) {
            throw surfaceThrownValue(evaluation.value, budget, evaluation.stackFrames, evaluation.span);
        }
        throw evaluation.value;
    }
    if ((evaluation.kind === "break" || evaluation.kind === "continue") &&
        evaluation.label !== undefined) {
        return {
            ok: false,
            error: createError("LABEL_NOT_FOUND", evaluation.node ?? node, `Label '${evaluation.label}' not found`),
            snapshot,
            stats
        };
    }
    if (evaluation.hasValue) {
        return {
            ok: true,
            returnValue: evaluation.value,
            snapshot,
            stats
        };
    }
    return {
        ok: true,
        snapshot,
        stats
    };
}
export { Scope } from "./scope.js";
async function evaluateNode(node, context) {
    const replayWait = promiseReplayContext.getStore()?.beforeNode(node.nodeId);
    if (replayWait !== undefined)
        await suspendJob(replayWait);
    context.budget.visitNode();
    context.stats.nodeVisits += 1;
    if (node.nodeId !== undefined && context.resumeTarget?.nodeId === node.nodeId) {
        context.resumeTarget.nodeId = undefined;
    }
    const handler = dispatchTable[node.type];
    if (handler === undefined) {
        return {
            kind: "error",
            error: createError("UNSUPPORTED_NODE", node, `Unsupported AST node type '${node.type}'.`)
        };
    }
    try {
        const result = await handler(node, context);
        reconcileDataBudget(context.budget, context.stats, context.scope, "hasValue" in result && result.hasValue ? result.value : undefined);
        return result;
    }
    catch (error) {
        if (error instanceof HostCallResumabilityError) {
            throw error;
        }
        if (isFatalSandboxError(error)) {
            attachFatalSandboxErrorContext(error, node, context.callStack);
            throw error;
        }
        if (isInterpreterError(error)) {
            return {
                kind: "error",
                error
            };
        }
        const exception = isCapturedException(error)
            ? coerceThrownValue(error.reason, context.budget, error.stackFrames, node.span)
            : coerceThrownValue(error, context.budget, context.callStack, node.span);
        return {
            kind: "throw",
            hasValue: true,
            span: readErrorSpan(exception) ?? node.span,
            stackFrames: isCapturedException(error) ? error.stackFrames : context.callStack,
            value: exception
        };
    }
}
function reconcileDataBudget(budget, stats, scope, transient) {
    budget.reconcileDataUsage(measureSandboxData([...scope.retainedValues(), ...budget.retainedValues(), transient]));
    stats.currentDataSize = budget.currentDataSize;
    stats.peakDataSize = budget.peakDataSize;
}
async function evaluatePrimitiveLiteral(node, context) {
    const value = typeof node.value === "string" ? context.budget.allocateString(node.value) : node.value;
    return {
        kind: "normal",
        hasValue: true,
        value
    };
}
async function evaluateRegexLiteral(node, _context) {
    const lastSlash = node.raw.lastIndexOf("/");
    return {
        kind: "normal",
        hasValue: true,
        value: createSandboxRegex(node.raw.slice(1, lastSlash), node.raw.slice(lastSlash + 1))
    };
}
async function evaluateEmptyStatement(_node, _context) {
    return {
        kind: "normal",
        hasValue: false,
        value: undefined
    };
}
async function evaluateArrayExpression(node, context) {
    const values = [];
    for (const element of node.elements) {
        if (element.type === "UndefinedLiteral" && element.elision === true) {
            values.length += 1;
            context.budget.allocateArrayLength(values.length);
            continue;
        }
        if (element.type === "SpreadElement") {
            const spreadValues = await evaluateSpreadElement(element, context);
            if (!spreadValues.ok) {
                return spreadValues.result;
            }
            appendArrayValues(values, spreadValues.value);
            context.budget.allocateArrayLength(values.length);
            continue;
        }
        const result = await evaluateNode(element, context);
        if (result.kind !== "normal") {
            return result;
        }
        values.push(result.value);
        context.budget.allocateArrayLength(values.length);
    }
    return {
        kind: "normal",
        hasValue: true,
        value: values
    };
}
async function evaluateObjectExpression(node, context) {
    const object = Object.create(null);
    for (const property of node.properties) {
        if (property.type === "SpreadElement") {
            const spreadEntries = await evaluateObjectSpread(property, context);
            if (!spreadEntries.ok) {
                return spreadEntries.result;
            }
            for (const [key, value] of spreadEntries.value) {
                defineSandboxProperty(object, key, value);
            }
            continue;
        }
        const key = await evaluateObjectPropertyKey(property, context);
        if (!key.ok) {
            return key.result;
        }
        const value = await evaluateNode(property.value, context);
        if (value.kind !== "normal") {
            return value;
        }
        if (isObjectPrototypeSetterProperty(property, key.value)) {
            continue;
        }
        defineSandboxProperty(object, String(key.value), value.value);
    }
    return {
        kind: "normal",
        hasValue: true,
        value: object
    };
}
function isObjectPrototypeSetterProperty(property, key) {
    return !property.computed && !property.shorthand && key === "__proto__";
}
async function evaluateTemplateLiteral(node, context) {
    let value = context.budget.allocateString(node.quasis[0]?.value.cooked ?? "");
    for (let index = 0; index < node.expressions.length; index += 1) {
        const expression = await evaluateNode(node.expressions[index], context);
        if (expression.kind !== "normal") {
            return expression;
        }
        const expressionText = context.budget.allocateString(String(expression.value));
        value = context.budget.allocateString(value + expressionText);
        const quasiText = context.budget.allocateString(node.quasis[index + 1]?.value.cooked ?? "");
        value = context.budget.allocateString(value + quasiText);
    }
    return {
        kind: "normal",
        hasValue: true,
        value
    };
}
async function evaluateTaggedTemplateExpression(node, context) {
    const tag = await evaluateNode(node.tag, context);
    if (tag.kind !== "normal") {
        return tag;
    }
    if (!isSandboxClosure(tag.value)) {
        throw new TypeError("Tagged template tag must be a function.");
    }
    const values = await evaluateTemplateExpressionValues(node.quasi, context);
    if (!values.ok) {
        return values.result;
    }
    return {
        kind: "normal",
        hasValue: true,
        value: await invokeSandboxClosure(tag.value, [createTaggedTemplateStrings(node.quasi, context), ...values.value], context, [...context.callStack, formatStackFrame(node, tag.value.name)])
    };
}
async function evaluateTemplateExpressionValues(node, context) {
    const values = [];
    for (const expressionNode of node.expressions) {
        const expression = await evaluateNode(expressionNode, context);
        if (expression.kind !== "normal") {
            return {
                ok: false,
                result: expression
            };
        }
        values.push(expression.value);
    }
    return {
        ok: true,
        value: values
    };
}
function createTaggedTemplateStrings(node, context) {
    context.budget.allocateArrayLength(node.quasis.length);
    const strings = node.quasis.map((quasi) => quasi.value.cooked === undefined ? undefined : context.budget.allocateString(quasi.value.cooked));
    context.budget.allocateArrayLength(node.quasis.length);
    const raw = node.quasis.map((quasi) => context.budget.allocateString(quasi.value.raw));
    Object.defineProperty(strings, "raw", {
        configurable: false,
        enumerable: false,
        value: raw,
        writable: false
    });
    taggedTemplateRawArrays.set(strings, raw);
    return strings;
}
async function evaluateArrowFunction(node, context) {
    return evaluateArrowFunctionExpression(node, context, evaluateNode);
}
async function evaluateFunctionDeclaration(node, context) {
    if (!context.scope.hasOwnBinding(node.id.name)) {
        context.scope.declare(node.id.name, "const", createInterpretedClosure(node, context, evaluateNode));
    }
    return {
        kind: "normal",
        hasValue: false,
        value: undefined
    };
}
async function evaluateFunction(node, context) {
    return evaluateFunctionExpression(node, context, evaluateNode);
}
async function evaluateAwait(node, context) {
    return evaluateAwaitExpression(node, context, evaluateNode);
}
async function evaluateBinaryExpression(node, context) {
    const left = await evaluateNode(node.left, context);
    if (left.kind !== "normal") {
        return left;
    }
    const right = await evaluateNode(node.right, context);
    if (right.kind !== "normal") {
        return right;
    }
    const value = applyBinaryOperator(node, left.value, right.value, context);
    return {
        kind: "normal",
        hasValue: true,
        value
    };
}
async function evaluateAssignmentExpression(node, context) {
    if (node.left.type === "ArrayPattern" || node.left.type === "ObjectPattern") {
        const right = await evaluateNode(node.right, context);
        if (right.kind !== "normal") {
            return right;
        }
        const binding = await bindPattern(node.left, right.value, { assign: true }, context.scope, {
            evaluate: (patternNode) => evaluateNode(patternNode, context)
        });
        if (!binding.ok) {
            return binding.result;
        }
        return {
            kind: "normal",
            hasValue: true,
            value: right.value
        };
    }
    if (node.left.type === "MemberExpression") {
        return evaluateMemberAssignmentExpression(node, context);
    }
    if (node.left.type !== "Identifier") {
        return {
            kind: "error",
            error: createError("UNSUPPORTED_NODE", node, `Unsupported assignment target '${node.left.type}'.`)
        };
    }
    const binding = context.scope.lookup(node.left.name);
    if (!binding.found) {
        throw new ReferenceError(`Cannot assign to undeclared binding '${node.left.name}'.`);
    }
    if (binding.kind === "const") {
        throw new TypeError(`Cannot assign to const '${node.left.name}'`);
    }
    if (node.operator === "&&=" && !isTruthy(binding.value)) {
        return {
            kind: "normal",
            hasValue: true,
            value: binding.value
        };
    }
    if (node.operator === "||=" && isTruthy(binding.value)) {
        return {
            kind: "normal",
            hasValue: true,
            value: binding.value
        };
    }
    if (node.operator === "??=" && binding.value !== null && binding.value !== undefined) {
        return {
            kind: "normal",
            hasValue: true,
            value: binding.value
        };
    }
    const right = await evaluateNode(node.right, context);
    if (right.kind !== "normal") {
        return right;
    }
    const value = node.operator === "=" ||
        node.operator === "&&=" ||
        node.operator === "||=" ||
        node.operator === "??="
        ? right.value
        : applyCompoundAssignmentOperator(node.operator, binding.value, right.value, context);
    context.scope.assign(node.left.name, value);
    return {
        kind: "normal",
        hasValue: true,
        value
    };
}
async function evaluateMemberAssignmentExpression(node, context) {
    if (node.left.type !== "MemberExpression") {
        throw new TypeError("Expected member assignment target.");
    }
    const member = await evaluateMemberAccess(node.left, context);
    if (member.kind === "error") {
        return member;
    }
    if (member.kind === "completion") {
        return member.result;
    }
    if (member.kind === "nullish") {
        throw new TypeError("Cannot assign properties of null or undefined.");
    }
    if (isSandboxRegex(member.object)) {
        if (node.operator !== "=") {
            throw new TypeError("RegExp properties only support direct assignment.");
        }
        const right = await evaluateNode(node.right, context);
        if (right.kind !== "normal")
            return right;
        setRegexMember(member.object, member.property, right.value);
        return { kind: "normal", hasValue: true, value: right.value };
    }
    if (!isIndexableSandboxValue(member.object)) {
        throw new TypeError("Assignment expressions require a sandbox object property.");
    }
    if (node.operator === "&&=" &&
        !isTruthy(getMemberValue(member.object, member.property, context))) {
        return {
            kind: "normal",
            hasValue: true,
            value: getMemberValue(member.object, member.property, context)
        };
    }
    if (node.operator === "||=" &&
        isTruthy(getMemberValue(member.object, member.property, context))) {
        return {
            kind: "normal",
            hasValue: true,
            value: getMemberValue(member.object, member.property, context)
        };
    }
    if (node.operator === "??=" &&
        getMemberValue(member.object, member.property, context) !== null &&
        getMemberValue(member.object, member.property, context) !== undefined) {
        return {
            kind: "normal",
            hasValue: true,
            value: getMemberValue(member.object, member.property, context)
        };
    }
    const right = await evaluateNode(node.right, context);
    if (right.kind !== "normal") {
        return right;
    }
    const current = getMemberValue(member.object, member.property, context);
    const value = node.operator === "=" ||
        node.operator === "&&=" ||
        node.operator === "||=" ||
        node.operator === "??="
        ? right.value
        : applyCompoundAssignmentOperator(node.operator, current, right.value, context);
    setSandboxProperty(member.object, member.property, value);
    return {
        kind: "normal",
        hasValue: true,
        value
    };
}
async function evaluateLogicalExpression(node, context) {
    const left = await evaluateNode(node.left, context);
    if (left.kind !== "normal") {
        return left;
    }
    switch (node.operator) {
        case "&&":
            if (!isTruthy(left.value)) {
                return left;
            }
            break;
        case "||":
            if (isTruthy(left.value)) {
                return left;
            }
            break;
        case "??":
            if (left.value !== null && left.value !== undefined) {
                return left;
            }
            break;
    }
    return evaluateNode(node.right, context);
}
async function evaluateSequenceExpression(node, context) {
    let result = {
        kind: "normal",
        hasValue: true,
        value: undefined
    };
    for (const expression of node.expressions) {
        result = await evaluateNode(expression, context);
        if (result.kind !== "normal") {
            return result;
        }
    }
    return result;
}
async function evaluateConditionalExpression(node, context) {
    const test = await evaluateNode(node.test, context);
    if (test.kind !== "normal") {
        return test;
    }
    return evaluateNode(isTruthy(test.value) ? node.consequent : node.alternate, context);
}
async function evaluateIdentifier(node, context) {
    const binding = context.scope.lookup(node.name);
    if (!binding.found) {
        return {
            kind: "error",
            error: createError("UNBOUND_IDENTIFIER", node, `Identifier '${node.name}' is not defined.`, context.callStack)
        };
    }
    return {
        kind: "normal",
        hasValue: true,
        value: binding.value
    };
}
async function evaluateThisExpression(_node, context) {
    const binding = context.scope.lookup("this");
    return {
        kind: "normal",
        hasValue: true,
        value: binding.found ? binding.value : undefined
    };
}
async function evaluateMetaProperty(_node, context) {
    return {
        kind: "normal",
        hasValue: true,
        value: context.scope.lookupImportMeta()
    };
}
async function evaluateExportDefaultDeclaration(node, context) {
    const declaration = await evaluateNode(node.declaration, context);
    if (declaration.kind !== "normal") {
        return declaration;
    }
    context.scope.declare("default", "const", declaration.value);
    return {
        kind: "normal",
        hasValue: false,
        value: undefined
    };
}
async function evaluateExportNamedDeclaration(node, context) {
    return evaluateVariableDeclaration(node.declaration, context);
}
async function evaluateVariableDeclaration(node, context) {
    if (node.kind !== "var") {
        predeclareDeclarationBindings(node, context.scope);
    }
    for (const declarator of node.declarations) {
        if (node.kind === "var" &&
            declarator.init === undefined &&
            declarator.id.type === "Identifier" &&
            context.scope.lookup(declarator.id.name).found) {
            continue;
        }
        if (declarator.id.type === "ArrayPattern" || declarator.id.type === "ObjectPattern") {
            const names = getPatternBindingNames(declarator.id);
            const restoredBindings = [];
            for (const name of names) {
                const restored = context.scope.consumeRestoredBinding(name);
                if (restored.found && isRestorableBindingValue(restored.value)) {
                    restoredBindings.push([name, restored.value]);
                }
            }
            if (names.length > 0 && restoredBindings.length === names.length) {
                for (const [name, value] of restoredBindings) {
                    if (node.kind === "var")
                        context.scope.assign(name, value);
                    else
                        context.scope.declare(name, node.kind, value);
                }
                continue;
            }
        }
        const restoredValue = declarator.id.type === "Identifier"
            ? context.scope.consumeRestoredBinding(declarator.id.name)
            : { found: false };
        const value = restoredValue.found && isRestorableBindingValue(restoredValue.value)
            ? {
                kind: "normal",
                hasValue: true,
                value: restoredValue.value
            }
            : declarator.init === undefined
                ? {
                    kind: "normal",
                    hasValue: true,
                    value: undefined
                }
                : await evaluateNode(declarator.init, context);
        if (value.kind !== "normal") {
            return value;
        }
        const binding = await bindPattern(declarator.id, value.value, { kind: node.kind }, context.scope, { evaluate: (patternNode) => evaluateNode(patternNode, context) });
        if (!binding.ok) {
            return binding.result;
        }
    }
    return {
        kind: "normal",
        hasValue: false,
        value: undefined
    };
}
function isRestorableBindingValue(value) {
    if (Array.isArray(value)) {
        return value.every(isRestorableBindingValue);
    }
    if (typeof value !== "object" || value === null) {
        return true;
    }
    if (Object.hasOwn(value, "kind")) {
        return !["fn", "generator", "map", "promise", "regex", "set"].includes(String(value.kind));
    }
    return Object.values(value).every(isRestorableBindingValue);
}
function predeclareDeclarationBindings(node, scope) {
    for (const name of getDeclarationBindingNames(node)) {
        if (!scope.hasOwnBinding(name)) {
            scope.predeclare(name, node.kind);
        }
    }
}
function getForStatementBindingNames(node) {
    return node.init?.type === "VariableDeclaration" && node.init.kind !== "var"
        ? getDeclarationBindingNames(node.init)
        : [];
}
function getDeclarationBindingNames(node) {
    return node.declarations.flatMap((declarator) => getPatternBindingNames(declarator.id));
}
function getPatternBindingNames(pattern) {
    switch (pattern.type) {
        case "Identifier":
            return [pattern.name];
        case "MemberExpression":
            return [];
        case "AssignmentPattern":
            return getPatternBindingNames(pattern.left);
        case "ArrayPattern":
            return pattern.elements.flatMap((element) => element === null ? [] : getPatternBindingNames(element));
        case "ObjectPattern":
            return pattern.properties.flatMap((property) => property.type === "RestElement"
                ? getPatternBindingNames(property)
                : getPatternBindingNames(property.value));
        case "RestElement":
            return getPatternBindingNames(pattern.argument);
    }
}
async function evaluateBlockStatement(node, context) {
    const blockContext = createBlockContext(node, context);
    const resumeIndex = findResumeStatementIndex(node, blockContext);
    const generatorResumeIndex = findGeneratorResumeStatementIndex(node, blockContext);
    for (let index = 0; index < node.body.length; index += 1) {
        const statement = node.body[index];
        if (generatorResumeIndex !== undefined && index < generatorResumeIndex) {
            continue;
        }
        if (resumeIndex !== undefined &&
            index < resumeIndex &&
            statement.type !== "VariableDeclaration") {
            continue;
        }
        const result = await evaluateNode(statement, blockContext);
        if (result.kind !== "normal") {
            return result;
        }
    }
    return {
        kind: "normal",
        hasValue: false,
        value: undefined
    };
}
function findGeneratorResumeStatementIndex(node, context) {
    if (context.generatorResume === undefined) {
        return undefined;
    }
    const index = node.body.findIndex((statement) => containsResumeTarget(statement, new Set([context.generatorResume.yieldNodeId])));
    return index === -1 ? undefined : index;
}
function findResumeStatementIndex(node, context) {
    if (context.restoredLoopIterations.size === 0 && context.resumeTarget?.nodeId === undefined) {
        return undefined;
    }
    const targetNodeIds = new Set(context.restoredLoopIterations.keys());
    if (context.resumeTarget?.nodeId !== undefined) {
        targetNodeIds.add(context.resumeTarget.nodeId);
    }
    const index = node.body.findIndex((statement) => containsResumeTarget(statement, targetNodeIds));
    return index === -1 ? undefined : index;
}
function containsResumeTarget(node, targetNodeIds) {
    if (node.nodeId !== undefined && targetNodeIds.has(node.nodeId)) {
        return true;
    }
    if (node.type === "ArrowFunctionExpression" ||
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression") {
        return false;
    }
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
            if (value.some((entry) => isParseResult(entry) && containsResumeTarget(entry, targetNodeIds))) {
                return true;
            }
            continue;
        }
        if (isParseResult(value) && containsResumeTarget(value, targetNodeIds)) {
            return true;
        }
    }
    return false;
}
function isParseResult(value) {
    return (typeof value === "object" &&
        value !== null &&
        typeof value.type === "string" &&
        Object.hasOwn(value, "span"));
}
function createBlockContext(node, context) {
    const scope = node === context.rootNode || context.generatorResume !== undefined
        ? context.scope
        : context.scope.child();
    const blockContext = {
        ...context,
        scope
    };
    if (context.generatorResume === undefined) {
        predeclareBlockBindings(node, blockContext);
    }
    return blockContext;
}
function predeclareBlockBindings(node, context) {
    predeclareStatementListBindings(node.body, context);
}
function predeclareStatementListBindings(statements, context) {
    const { scope } = context;
    const names = new Set();
    for (const statement of statements) {
        if (statement.type === "FunctionDeclaration") {
            const name = statement.id.name;
            if (names.has(name)) {
                throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
            }
            const closure = createInterpretedClosure(statement, context, evaluateNode);
            const ownBindingKind = scope.getOwnBindingKind(name);
            if (ownBindingKind === "var") {
                names.add(name);
                scope.assign(name, closure);
                continue;
            }
            if (ownBindingKind !== undefined) {
                throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
            }
            names.add(name);
            scope.declare(name, "const", closure);
            continue;
        }
        if (statement.type !== "VariableDeclaration" || statement.kind === "var") {
            continue;
        }
        for (const name of getDeclarationBindingNames(statement)) {
            if (names.has(name) || scope.hasOwnBinding(name)) {
                throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
            }
            names.add(name);
            scope.predeclare(name, statement.kind);
        }
    }
}
async function evaluateSwitchStatement(node, context) {
    const discriminant = await evaluateNode(node.discriminant, context);
    if (discriminant.kind !== "normal") {
        return discriminant;
    }
    const switchContext = { ...context, scope: context.scope.child() };
    predeclareStatementListBindings(node.cases.flatMap((switchCase) => switchCase.consequent), switchContext);
    let defaultIndex;
    let startIndex;
    for (let index = 0; index < node.cases.length; index += 1) {
        const switchCase = node.cases[index];
        if (switchCase.test === undefined) {
            defaultIndex = index;
            continue;
        }
        const test = await evaluateNode(switchCase.test, switchContext);
        if (test.kind !== "normal") {
            return test;
        }
        if (discriminant.value === test.value) {
            startIndex = index;
            break;
        }
    }
    startIndex ??= defaultIndex;
    if (startIndex === undefined) {
        return normalEmptyResult();
    }
    for (let caseIndex = startIndex; caseIndex < node.cases.length; caseIndex += 1) {
        for (const statement of node.cases[caseIndex].consequent) {
            const result = await evaluateNode(statement, switchContext);
            if (result.kind === "break" && result.label === undefined) {
                return normalEmptyResult();
            }
            if (result.kind !== "normal") {
                return result;
            }
        }
    }
    return normalEmptyResult();
}
async function evaluateIfStatement(node, context) {
    const test = await evaluateNode(node.test, context);
    if (test.kind !== "normal") {
        return test;
    }
    const branch = isTruthy(test.value) ? node.consequent : node.alternate;
    if (branch === undefined) {
        return {
            kind: "normal",
            hasValue: false,
            value: undefined
        };
    }
    return evaluateNode(branch, context);
}
async function evaluateForOfStatement(node, context) {
    const iterable = await evaluateNode(node.right, context);
    if (iterable.kind !== "normal") {
        return iterable;
    }
    const values = snapshotableIterationValues(iterable.value);
    if (values === undefined) {
        return evaluateForOfIterator(node, iterable.value, context);
    }
    const restoredIndex = consumeRestoredLoopIterationIndex(node, context);
    for (let index = restoredIndex; index < values.length; index += 1) {
        context.activeLoopIterations.set(node.nodeId ?? -1, index);
        const scope = context.scope.child();
        const binding = await bindForOfLoopVariable(node.left, values[index], scope, context);
        if (!binding.ok) {
            return binding.result;
        }
        const iterationContext = createLoopIterationContext(context, scope);
        emitLoopIterationBreakpoint(node, iterationContext);
        const result = await evaluateNode(node.body, iterationContext);
        if (isMatchingBreak(result, loopLabels(node))) {
            context.activeLoopIterations.delete(node.nodeId ?? -1);
            return {
                kind: "normal",
                hasValue: false,
                value: undefined
            };
        }
        if (isMatchingContinue(result, loopLabels(node))) {
            continue;
        }
        if (result.kind !== "normal") {
            context.activeLoopIterations.delete(node.nodeId ?? -1);
            return result;
        }
    }
    context.activeLoopIterations.delete(node.nodeId ?? -1);
    return {
        kind: "normal",
        hasValue: false,
        value: undefined
    };
}
async function evaluateForOfIterator(node, value, context) {
    const iterator = getSandboxIterator(value);
    if (iterator === undefined) {
        throw new TypeError(`${String(value)} is not a supported iterable`);
    }
    const nodeId = node.nodeId ?? -1;
    let index = consumeRestoredLoopIterationIndex(node, context);
    for (let skipped = 0; skipped < index; skipped += 1) {
        const skippedIteration = await iterator.next();
        if (typeof skippedIteration !== "object" || skippedIteration === null) {
            throw new TypeError("Iterator result must be an object.");
        }
        if (skippedIteration.done) {
            return normalEmptyResult();
        }
    }
    while (true) {
        const iteration = await iterator.next();
        if (typeof iteration !== "object" || iteration === null) {
            throw new TypeError("Iterator result must be an object.");
        }
        if (iteration.done) {
            context.activeLoopIterations.delete(nodeId);
            return normalEmptyResult();
        }
        context.activeLoopIterations.set(nodeId, index);
        const scope = context.scope.child();
        const binding = await bindForOfLoopVariable(node.left, iteration.value, scope, context);
        if (!binding.ok) {
            return binding.result;
        }
        const iterationContext = createLoopIterationContext(context, scope);
        emitLoopIterationBreakpoint(node, iterationContext);
        const result = await evaluateNode(node.body, iterationContext);
        if (isMatchingBreak(result, loopLabels(node))) {
            context.activeLoopIterations.delete(nodeId);
            await closeIterator(iterator);
            return normalEmptyResult();
        }
        if (isMatchingContinue(result, loopLabels(node))) {
            index += 1;
            continue;
        }
        if (result.kind !== "normal") {
            context.activeLoopIterations.delete(nodeId);
            await closeIterator(iterator);
            return result;
        }
        index += 1;
    }
}
async function evaluateForInStatement(node, context) {
    const right = await evaluateNode(node.right, context);
    if (right.kind !== "normal") {
        return right;
    }
    const object = forInObject(right.value);
    if (object === undefined) {
        return normalEmptyResult();
    }
    const restoredIteration = consumeRestoredLoopIteration(node, context);
    const keys = restoredIteration === undefined || typeof restoredIteration === "number"
        ? forInKeys(object)
        : restoredIteration.values.map(String);
    const restoredIndex = typeof restoredIteration === "number" ? restoredIteration : (restoredIteration?.index ?? 0);
    for (let index = restoredIndex; index < keys.length; index += 1) {
        context.activeLoopIterations.set(node.nodeId ?? -1, { index, values: keys });
        const key = keys[index];
        if (!(key in object)) {
            continue;
        }
        const scope = context.scope.child();
        const binding = await bindForInLoopVariable(node.left, key, scope, context);
        if (!binding.ok) {
            context.activeLoopIterations.delete(node.nodeId ?? -1);
            return binding.result;
        }
        const iterationContext = createLoopIterationContext(context, scope);
        emitLoopIterationBreakpoint(node, iterationContext);
        const result = await evaluateNode(node.body, iterationContext);
        if (isMatchingBreak(result, loopLabels(node))) {
            context.activeLoopIterations.delete(node.nodeId ?? -1);
            return normalEmptyResult();
        }
        if (isMatchingContinue(result, loopLabels(node))) {
            continue;
        }
        if (result.kind !== "normal") {
            context.activeLoopIterations.delete(node.nodeId ?? -1);
            return result;
        }
    }
    context.activeLoopIterations.delete(node.nodeId ?? -1);
    return normalEmptyResult();
}
function forInObject(value) {
    if (value === null || value === undefined || isSandboxClosure(value) || isSandboxPromise(value)) {
        return undefined;
    }
    if (typeof value === "string" || Array.isArray(value) || isPlainForInObject(value)) {
        return Object(value);
    }
    return undefined;
}
function forInKeys(object) {
    const keys = Object.keys(object);
    return Array.isArray(object) ? keys.filter(isArrayIndexKey) : keys;
}
function isArrayIndexKey(key) {
    const index = Number(key);
    return Number.isInteger(index) && index >= 0 && index < 4_294_967_295 && String(index) === key;
}
function isPlainForInObject(value) {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
async function bindForInLoopVariable(left, key, scope, context) {
    if (left.type === "Identifier") {
        return bindPattern(left, key, { assign: true }, scope, {
            evaluate: (patternNode) => evaluateNode(patternNode, { ...context, scope })
        });
    }
    const [declarator] = left.declarations;
    if (left.declarations.length !== 1 || declarator?.id.type !== "Identifier") {
        throw new TypeError("for...in keys are strings; destructure inside the body");
    }
    return bindPattern(declarator.id, key, { kind: left.kind }, scope, {
        evaluate: (patternNode) => evaluateNode(patternNode, { ...context, scope })
    });
}
function normalEmptyResult() {
    return { kind: "normal", hasValue: false, value: undefined };
}
async function evaluateForStatement(node, context) {
    const loopScope = context.scope.child();
    const loopBindingNames = getForStatementBindingNames(node);
    const loopContext = {
        ...context,
        scope: loopScope
    };
    if (node.init !== undefined) {
        const init = await evaluateNode(node.init, loopContext);
        if (init.kind !== "normal") {
            return init;
        }
    }
    while (true) {
        context.budget.visitNode();
        context.stats.nodeVisits += 1;
        if (node.test !== undefined) {
            const test = await evaluateNode(node.test, loopContext);
            if (test.kind !== "normal") {
                return test;
            }
            if (!isTruthy(test.value)) {
                return {
                    kind: "normal",
                    hasValue: false,
                    value: undefined
                };
            }
        }
        const iterationScope = loopBindingNames.length === 0 ? loopScope : loopScope.iterationChild(loopBindingNames);
        const iterationContext = {
            ...loopContext,
            ...createLoopIterationContext(loopContext, iterationScope)
        };
        emitLoopIterationBreakpoint(node, iterationContext);
        const result = await evaluateNode(node.body, iterationContext);
        if (isMatchingBreak(result, loopLabels(node))) {
            return {
                kind: "normal",
                hasValue: false,
                value: undefined
            };
        }
        if (result.kind !== "normal" && !isMatchingContinue(result, loopLabels(node))) {
            return result;
        }
        const updateScope = loopBindingNames.length === 0
            ? iterationScope
            : iterationScope.iterationChild(loopBindingNames);
        const updateContext = {
            ...loopContext,
            scope: updateScope
        };
        if (node.update !== undefined) {
            const update = await evaluateNode(node.update, updateContext);
            if (update.kind !== "normal") {
                return update;
            }
        }
        loopScope.copyInitializedBindingsFrom(updateScope, loopBindingNames);
    }
}
async function evaluateWhileStatement(node, context) {
    while (true) {
        const test = await evaluateNode(node.test, context);
        if (test.kind !== "normal") {
            return test;
        }
        if (!isTruthy(test.value)) {
            return {
                kind: "normal",
                hasValue: false,
                value: undefined
            };
        }
        const iterationContext = createLoopIterationContext(context, context.scope);
        emitLoopIterationBreakpoint(node, iterationContext);
        const result = await evaluateNode(node.body, iterationContext);
        if (isMatchingBreak(result, loopLabels(node))) {
            return {
                kind: "normal",
                hasValue: false,
                value: undefined
            };
        }
        if (isMatchingContinue(result, loopLabels(node))) {
            continue;
        }
        if (result.kind !== "normal") {
            return result;
        }
    }
}
async function evaluateDoWhileStatement(node, context) {
    while (true) {
        const iterationContext = createLoopIterationContext(context, context.scope);
        emitLoopIterationBreakpoint(node, iterationContext);
        const result = await evaluateNode(node.body, iterationContext);
        if (isMatchingBreak(result, loopLabels(node))) {
            return {
                kind: "normal",
                hasValue: false,
                value: undefined
            };
        }
        if (result.kind !== "normal" && !isMatchingContinue(result, loopLabels(node))) {
            return result;
        }
        const test = await evaluateNode(node.test, context);
        if (test.kind !== "normal") {
            return test;
        }
        if (!isTruthy(test.value)) {
            return {
                kind: "normal",
                hasValue: false,
                value: undefined
            };
        }
    }
}
function emitLoopIterationBreakpoint(node, context) {
    emitResumeBreakpoint(context, {
        kind: "loop-iteration",
        nodeId: node.nodeId,
        span: node.span
    });
}
function createLoopIterationContext(context, scope) {
    return {
        ...context,
        scope,
        snapshot: (currentScope) => ({
            ...currentScope.snapshot(),
            ...(context.activeLoopIterations.size === 0
                ? {}
                : { loopIterations: Object.fromEntries(context.activeLoopIterations) })
        })
    };
}
function consumeRestoredLoopIteration(node, context) {
    const nodeId = node.nodeId ?? -1;
    const iteration = context.restoredLoopIterations.get(nodeId);
    context.restoredLoopIterations.delete(nodeId);
    return iteration;
}
function consumeRestoredLoopIterationIndex(node, context) {
    const iteration = consumeRestoredLoopIteration(node, context);
    return typeof iteration === "number" ? iteration : (iteration?.index ?? 0);
}
function snapshotableIterationValues(value) {
    if (typeof value === "string") {
        return Array.from(value);
    }
    if (Array.isArray(value)) {
        return value;
    }
    if (isSandboxMap(value)) {
        return Array.from(value.entries, ([key, entry]) => [key, entry]);
    }
    if (isSandboxSet(value)) {
        return Array.from(value.values);
    }
    return undefined;
}
function isMatchingBreak(result, labels) {
    return (result.kind === "break" && (result.label === undefined || hasLoopLabel(labels, result.label)));
}
function isMatchingContinue(result, labels) {
    return (result.kind === "continue" && (result.label === undefined || hasLoopLabel(labels, result.label)));
}
function loopLabels(node) {
    return node.labels ?? node.label;
}
function hasLoopLabel(labels, target) {
    return Array.isArray(labels) ? labels.includes(target) : labels === target;
}
async function bindForOfLoopVariable(left, value, scope, context) {
    if (left.type === "Identifier") {
        return bindPattern(left, value, { assign: true }, scope, {
            evaluate: (patternNode) => evaluateNode(patternNode, { ...context, scope })
        });
    }
    if (left.type !== "VariableDeclaration") {
        throw new TypeError(`Unsupported for...of left-hand side '${left.type}'.`);
    }
    const [declarator] = left.declarations;
    if (left.declarations.length !== 1 || declarator === undefined) {
        throw new TypeError("for...of declarations must include exactly one declarator.");
    }
    return bindPattern(declarator.id, value, { kind: left.kind }, scope, {
        evaluate: (patternNode) => evaluateNode(patternNode, { ...context, scope })
    });
}
async function evaluateExpressionStatement(node, context) {
    return evaluateNode(node.expression, context);
}
async function evaluateBreakStatement(node, _context) {
    return {
        kind: "break",
        hasValue: false,
        ...(node.label === undefined ? {} : { label: node.label }),
        node,
        value: undefined
    };
}
async function evaluateContinueStatement(node, _context) {
    return {
        kind: "continue",
        hasValue: false,
        ...(node.label === undefined ? {} : { label: node.label }),
        node,
        value: undefined
    };
}
async function evaluateReturnStatement(node, context) {
    if (node.argument === undefined) {
        return {
            kind: "return",
            hasValue: false,
            value: undefined
        };
    }
    const argument = await evaluateNode(node.argument, context);
    if (argument.kind !== "normal") {
        return argument;
    }
    return {
        kind: "return",
        hasValue: argument.hasValue,
        value: argument.value
    };
}
async function evaluateYieldExpression(node, context) {
    if (context.generatorYield === undefined) {
        throw new TypeError("yield is only valid inside a generator.");
    }
    if (context.generatorResume !== undefined &&
        node.nodeId !== context.generatorResume.yieldNodeId) {
        return { kind: "normal", hasValue: true, value: undefined };
    }
    if (node.delegate) {
        return evaluateYieldDelegate(node, context);
    }
    const argument = context.generatorResume !== undefined || node.argument === undefined
        ? { kind: "normal", hasValue: true, value: undefined }
        : await evaluateNode(node.argument, context);
    if (argument.kind !== "normal") {
        return argument;
    }
    const completionPromise = context.generatorYield(allocateProducedSandboxValue(argument.value, context.budget), node.nodeId);
    emitResumeBreakpoint(context, {
        kind: "generator-yield",
        nodeId: node.nodeId,
        span: node.span
    });
    const completion = await completionPromise;
    context.generatorResume = undefined;
    return generatorCompletionResult(completion);
}
async function evaluateYieldDelegate(node, context) {
    const argument = await evaluateNode(node.argument, context);
    if (argument.kind !== "normal") {
        return argument;
    }
    const iterator = getSandboxIterator(argument.value);
    if (iterator === undefined) {
        throw new TypeError(`${String(argument.value)} is not a supported iterable`);
    }
    let completion = {
        type: "normal",
        value: undefined
    };
    const replay = context.generatorResume?.sent ?? [];
    let replayIndex = 0;
    while (true) {
        const method = completion.type === "normal" ? "next" : completion.type;
        const iteratorMethod = iterator[method];
        if (iteratorMethod === undefined) {
            if (completion.type === "throw") {
                throw completion.value;
            }
            return generatorCompletionResult(completion);
        }
        const result = await iteratorMethod(completion.value);
        if (result.done) {
            if (completion.type === "return") {
                return generatorCompletionResult({ type: "return", value: result.value });
            }
            return {
                kind: "normal",
                hasValue: true,
                value: result.value
            };
        }
        if (replayIndex < replay.length - 1) {
            completion = replay[replayIndex + 1];
            replayIndex += 1;
            continue;
        }
        const completionPromise = context.generatorYield(allocateProducedSandboxValue(result.value, context.budget), node.nodeId);
        emitResumeBreakpoint(context, {
            kind: "generator-yield",
            nodeId: node.nodeId,
            span: node.span
        });
        completion = (await completionPromise);
        context.generatorResume = undefined;
    }
}
function generatorCompletionResult(completion) {
    if (completion.type === "throw") {
        return { kind: "throw", hasValue: true, value: completion.value };
    }
    if (completion.type === "return") {
        return { kind: "return", hasValue: true, value: completion.value };
    }
    return { kind: "normal", hasValue: true, value: completion.value };
}
async function evaluateThrowStatement(node, context) {
    return evaluateThrowStatementResult(node, context, evaluateNode);
}
async function evaluateTryStatement(node, context) {
    return evaluateTryStatementResult(node, context, evaluateNode);
}
async function evaluateUnaryExpression(node, context) {
    if (node.operator === "delete") {
        return evaluateDeleteExpression(node, context);
    }
    if (node.operator === "typeof" &&
        node.argument.type === "Identifier" &&
        !context.scope.lookup(node.argument.name).found) {
        return {
            kind: "normal",
            hasValue: true,
            value: "undefined"
        };
    }
    const argument = await evaluateNode(node.argument, context);
    if (argument.kind !== "normal") {
        return argument;
    }
    if (node.operator === "void") {
        return {
            kind: "normal",
            hasValue: true,
            value: undefined
        };
    }
    return {
        kind: "normal",
        hasValue: true,
        value: await applyUnaryOperator(node.operator, argument.value, context)
    };
}
async function evaluateDeleteExpression(node, context) {
    if (node.argument.type !== "MemberExpression") {
        throw createError("UNSUPPORTED_NODE", node, "Unary operator 'delete' requires a member target.");
    }
    const member = await evaluateMemberAccess(node.argument, context);
    if (member.kind === "error") {
        return member;
    }
    if (member.kind === "completion") {
        return member.result;
    }
    if (member.kind === "nullish") {
        if (node.argument.optional) {
            return {
                kind: "normal",
                hasValue: true,
                value: true
            };
        }
        throw new TypeError("Cannot delete properties of null or undefined.");
    }
    if (!isIndexableSandboxValue(member.object)) {
        throw new TypeError("Unary operator 'delete' requires a sandbox object property.");
    }
    deleteSandboxProperty(member.object, member.property);
    return {
        kind: "normal",
        hasValue: true,
        value: true
    };
}
async function evaluateUpdateExpression(node, context) {
    if (node.argument.type === "Identifier") {
        return evaluateIdentifierUpdateExpression(node, context);
    }
    return evaluateMemberUpdateExpression(node, context);
}
async function evaluateIdentifierUpdateExpression(node, context) {
    if (node.argument.type !== "Identifier") {
        throw new TypeError("Expected identifier update target.");
    }
    const binding = context.scope.lookup(node.argument.name);
    if (!binding.found) {
        return {
            kind: "error",
            error: createError("UNBOUND_IDENTIFIER", node.argument, `Identifier '${node.argument.name}' is not defined.`)
        };
    }
    if (binding.kind === "const") {
        throw new TypeError(`Cannot assign to const '${node.argument.name}'`);
    }
    const current = Number(binding.value);
    const next = node.operator === "++" ? current + 1 : current - 1;
    context.scope.assign(node.argument.name, next);
    return {
        kind: "normal",
        hasValue: true,
        value: node.prefix ? next : current
    };
}
async function evaluateMemberUpdateExpression(node, context) {
    if (node.argument.type !== "MemberExpression") {
        throw new TypeError("Expected member update target.");
    }
    const member = await evaluateMemberAccess(node.argument, context);
    if (member.kind === "error") {
        return member;
    }
    if (member.kind === "completion") {
        return member.result;
    }
    if (member.kind === "nullish") {
        throw new TypeError("Cannot update properties of null or undefined.");
    }
    if (!isIndexableSandboxValue(member.object)) {
        throw new TypeError("Update expressions require a sandbox object property.");
    }
    const current = Number(getMemberValue(member.object, member.property, context));
    const next = node.operator === "++" ? current + 1 : current - 1;
    setSandboxProperty(member.object, member.property, next);
    return {
        kind: "normal",
        hasValue: true,
        value: node.prefix ? next : current
    };
}
async function evaluateMemberExpression(node, context) {
    const member = await evaluateMemberAccess(node, context);
    if (member.kind === "error") {
        return member;
    }
    if (member.kind === "completion") {
        return member.result;
    }
    if (member.kind === "nullish") {
        if (node.optional) {
            return {
                kind: "normal",
                hasValue: true,
                value: undefined
            };
        }
        throw new TypeError("Cannot read properties of null or undefined.");
    }
    if (typeof member.object === "string") {
        return {
            kind: "normal",
            hasValue: true,
            value: getStringMember(member.object, member.property, context.budget)
        };
    }
    if (typeof member.object === "number") {
        return {
            kind: "normal",
            hasValue: true,
            value: getNumberMember(member.object, member.property, context.budget)
        };
    }
    if (Array.isArray(member.object)) {
        return {
            kind: "normal",
            hasValue: true,
            value: getArrayMemberValue(member.object, member.property, context)
        };
    }
    if (isSandboxMap(member.object)) {
        return {
            kind: "normal",
            hasValue: true,
            value: getMapMember(member.object, member.property, createMapMethodOptions(context))
        };
    }
    if (isSandboxSet(member.object)) {
        return {
            kind: "normal",
            hasValue: true,
            value: getSetMember(member.object, member.property, createSetMethodOptions(context))
        };
    }
    if (isSandboxGenerator(member.object)) {
        return {
            kind: "normal",
            hasValue: true,
            value: getGeneratorMember(member.object, member.property, context.budget)
        };
    }
    if (isSandboxClosure(member.object)) {
        return {
            kind: "normal",
            hasValue: true,
            value: getClosureMemberValue(member.object, member.property, context)
        };
    }
    if (isSandboxPromise(member.object)) {
        return {
            kind: "normal",
            hasValue: true,
            value: getPromiseMember(member.object, member.property, context.budget)
        };
    }
    if (isSandboxRegex(member.object)) {
        return {
            kind: "normal",
            hasValue: true,
            value: getRegexMember(member.object, member.property)
        };
    }
    if (!isIndexableSandboxValue(member.object)) {
        throw new TypeError("Attempted to read a property from a non-object value.");
    }
    return {
        kind: "normal",
        hasValue: true,
        value: getMemberValue(member.object, member.property, context)
    };
}
async function evaluateCallExpression(node, context) {
    if (node.callee.type === "MemberExpression") {
        context.budget.visitNode();
        context.stats.nodeVisits += 1;
        return evaluateMemberCallExpression(node, context);
    }
    const callee = await evaluateNode(node.callee, context);
    if (callee.kind !== "normal") {
        return callee;
    }
    return evaluateResolvedCallExpression(node, callee.value, context);
}
async function evaluateNewExpression(node, context) {
    const callee = await evaluateNode(node.callee, context);
    if (callee.kind !== "normal") {
        return callee;
    }
    const name = getConstructorName(node.callee);
    if (!isSandboxClosure(callee.value) || callee.value.construct === undefined) {
        throw new TypeError(`${name} is not a constructor.`);
    }
    const args = await evaluateCallArguments(node.arguments, context);
    if (!args.ok) {
        return args.result;
    }
    const stack = [...context.callStack, formatStackFrame(node, callee.value.name ?? name)];
    const leaveCall = context.budget.enterCall();
    try {
        return {
            kind: "normal",
            hasValue: true,
            value: await wrapHostResult(callee.value.construct(args.value, {
                stack,
                thisValue: undefined,
                span: node.span
            }), stack)
        };
    }
    catch (error) {
        if (isFatalSandboxError(error)) {
            throw error;
        }
        throw captureException(error, stack);
    }
    finally {
        leaveCall();
    }
}
function getConstructorName(callee) {
    if (callee.type === "Identifier") {
        return callee.name;
    }
    if (callee.type === "MemberExpression") {
        if (!callee.computed && callee.property.type === "Identifier") {
            return callee.property.name;
        }
        if (callee.computed && callee.property.type === "StringLiteral") {
            return callee.property.value;
        }
        if (callee.computed && callee.property.type === "NumericLiteral") {
            return String(callee.property.value);
        }
    }
    return "<anonymous>";
}
function formatStackFrame(node, name) {
    return `    at ${name ?? "<anonymous>"} (line ${node.span.start.line}, column ${node.span.start.column})`;
}
function createError(code, node, message, stackFrames = []) {
    const name = code === "UNBOUND_IDENTIFIER" ? "ReferenceError" : "Error";
    const stack = [...stackFrames, formatStackFrame(node, undefined)];
    return {
        code,
        message,
        name,
        nodeId: node.nodeId,
        nodeType: node.type,
        span: node.span,
        stack: formatErrorStack(name, message, stack)
    };
}
function attachFatalSandboxErrorContext(error, node, stackFrames) {
    attachErrorSpan(error, node.span);
    replaceErrorStack(error, stackFrames);
}
async function evaluateMemberAccess(node, context) {
    const object = await evaluateNode(node.object, context);
    if (object.kind !== "normal") {
        return {
            kind: "completion",
            result: object
        };
    }
    if ((object.value === null || object.value === undefined) && node.optional) {
        return {
            kind: "nullish"
        };
    }
    const property = node.computed
        ? await evaluateMemberProperty(node.property, context)
        : { ok: true, value: getStaticPropertyName(node.property) };
    if (!property.ok) {
        return property.result.kind === "error"
            ? {
                kind: "error",
                error: property.result.error
            }
            : {
                kind: "completion",
                result: property.result
            };
    }
    if (object.value === null || object.value === undefined) {
        return {
            kind: "nullish"
        };
    }
    return {
        kind: "resolved",
        object: object.value,
        property: property.value
    };
}
async function evaluateMemberProperty(node, context) {
    const property = await evaluateNode(node, context);
    if (property.kind !== "normal") {
        return {
            ok: false,
            result: property
        };
    }
    if (typeof property.value === "string" || typeof property.value === "number") {
        return {
            ok: true,
            value: property.value
        };
    }
    throw new TypeError("Computed property access requires a string or number key.");
}
async function evaluateObjectPropertyKey(node, context) {
    if (!node.computed) {
        return {
            ok: true,
            value: getStaticPropertyName(node.key)
        };
    }
    return evaluateMemberProperty(node.key, context);
}
function getStaticPropertyName(node) {
    if (node.type === "Identifier") {
        return node.name;
    }
    if (node.type === "StringLiteral" || node.type === "NumericLiteral") {
        return node.value;
    }
    throw new TypeError(`Unsupported static property node '${node.type}'.`);
}
async function evaluateMemberCallExpression(node, context) {
    if (node.callee.type !== "MemberExpression") {
        throw new TypeError("Expected member call expression.");
    }
    const member = await evaluateMemberAccess(node.callee, context);
    if (member.kind === "error") {
        return member;
    }
    if (member.kind === "completion") {
        return member.result;
    }
    if (member.kind === "nullish") {
        if (node.optional || node.callee.optional) {
            return {
                kind: "normal",
                hasValue: true,
                value: undefined
            };
        }
        throw new TypeError("Cannot read properties of null or undefined.");
    }
    if (typeof member.object === "string" && isStringMethodName(member.property)) {
        return evaluateStringMethodCall(node, member.object, member.property, context);
    }
    if (typeof member.object === "number" && isNumberMethodName(member.property)) {
        return evaluateNumberMethodCall(node, member.object, member.property, context);
    }
    if (Array.isArray(member.object) && isArrayMethodName(member.property)) {
        return evaluateArrayMethodCall(node, member.object, member.property, context);
    }
    if (isSandboxMap(member.object) && isMapMethodName(member.property)) {
        return evaluateMapMethodCall(node, member.object, member.property, context);
    }
    if (isSandboxSet(member.object) && isSetMethodName(member.property)) {
        return evaluateSetMethodCall(node, member.object, member.property, context);
    }
    if (typeof member.object === "string") {
        return evaluatePrimitiveMemberCall(node, "String", member.property, getStringMember(member.object, member.property, context.budget), context);
    }
    if (typeof member.object === "number") {
        return evaluatePrimitiveMemberCall(node, "Number", member.property, getNumberMember(member.object, member.property, context.budget), context);
    }
    if (Array.isArray(member.object)) {
        return evaluatePrimitiveMemberCall(node, "Array", member.property, getArrayMemberValue(member.object, member.property, context), context);
    }
    if (isSandboxMap(member.object)) {
        return evaluatePrimitiveMemberCall(node, "Map", member.property, getMapMember(member.object, member.property, createMapMethodOptions(context)), context);
    }
    if (isSandboxSet(member.object)) {
        return evaluatePrimitiveMemberCall(node, "Set", member.property, getSetMember(member.object, member.property, createSetMethodOptions(context)), context);
    }
    if (isSandboxGenerator(member.object)) {
        const memberValue = getGeneratorMember(member.object, member.property, context.budget);
        if (memberValue === undefined) {
            throw new TypeError(`Generator#${String(member.property)} is not a supported method.`);
        }
        return evaluateResolvedCallExpression(node, memberValue, context, member.object);
    }
    if (isSandboxClosure(member.object)) {
        const memberValue = getClosureMemberValue(member.object, member.property, context);
        if (memberValue === undefined) {
            throw new TypeError(`Function#${String(member.property)} is not a supported method.`);
        }
        return evaluateResolvedCallExpression(node, memberValue, context, member.object);
    }
    if (isSandboxPromise(member.object)) {
        return evaluateResolvedCallExpression(node, getPromiseMember(member.object, member.property, context.budget), context, member.object);
    }
    if (isSandboxRegex(member.object) && isRegexMethodName(member.property)) {
        return evaluateResolvedCallExpression(node, getRegexMember(member.object, member.property), context, member.object);
    }
    if (!isIndexableSandboxValue(member.object)) {
        throw new TypeError("Attempted to read a property from a non-object value.");
    }
    return evaluateResolvedCallExpression(node, getMemberValue(member.object, member.property, context), context, member.object);
}
function evaluatePrimitiveMemberCall(node, receiverType, property, value, context) {
    if (value === undefined) {
        throw new TypeError(`${receiverType}#${String(property)} is not a supported method.`);
    }
    return evaluateResolvedCallExpression(node, value, context);
}
async function evaluateStringMethodCall(node, target, methodName, context) {
    validateStringMethodArguments(methodName, node.arguments);
    const args = await evaluateCallArguments(node.arguments, context);
    if (!args.ok) {
        return args.result;
    }
    const leaveCall = context.budget.enterCall();
    try {
        return {
            kind: "normal",
            hasValue: true,
            value: await callStringMethod(target, methodName, args.value, context.budget, (closure, closureArgs) => invokeSandboxClosure(closure, closureArgs, context, context.callStack))
        };
    }
    catch (error) {
        if (isFatalSandboxError(error)) {
            throw error;
        }
        throw captureException(error, [...context.callStack, formatStackFrame(node, methodName)]);
    }
    finally {
        leaveCall();
    }
}
async function evaluateArrayMethodCall(node, target, methodName, context) {
    const args = await evaluateCallArguments(node.arguments, context);
    if (!args.ok) {
        return args.result;
    }
    const leaveCall = context.budget.enterCall();
    try {
        return {
            kind: "normal",
            hasValue: true,
            value: await callArrayMethod(target, methodName, args.value, createArrayMethodOptions(context), context.callStack)
        };
    }
    catch (error) {
        if (isFatalSandboxError(error)) {
            throw error;
        }
        throw captureException(error, [...context.callStack, formatStackFrame(node, methodName)]);
    }
    finally {
        leaveCall();
    }
}
async function evaluateMapMethodCall(node, target, methodName, context) {
    const args = await evaluateCallArguments(node.arguments, context);
    if (!args.ok) {
        return args.result;
    }
    const leaveCall = context.budget.enterCall();
    try {
        return {
            kind: "normal",
            hasValue: true,
            value: await callMapMethod(target, methodName, args.value, createMapMethodOptions(context), context.callStack)
        };
    }
    catch (error) {
        if (isFatalSandboxError(error)) {
            throw error;
        }
        throw captureException(error, [...context.callStack, formatStackFrame(node, methodName)]);
    }
    finally {
        leaveCall();
    }
}
async function evaluateSetMethodCall(node, target, methodName, context) {
    const args = await evaluateCallArguments(node.arguments, context);
    if (!args.ok) {
        return args.result;
    }
    const leaveCall = context.budget.enterCall();
    try {
        return {
            kind: "normal",
            hasValue: true,
            value: await callSetMethod(target, methodName, args.value, createSetMethodOptions(context), context.callStack)
        };
    }
    catch (error) {
        if (isFatalSandboxError(error)) {
            throw error;
        }
        throw captureException(error, [...context.callStack, formatStackFrame(node, methodName)]);
    }
    finally {
        leaveCall();
    }
}
async function applyUnaryOperator(operator, value, context) {
    switch (operator) {
        case "!":
            return !value;
        case "delete":
            return true;
        case "typeof":
            return describeTypeofValue(value);
        case "void":
            return undefined;
        case "+":
            return toNumber(await toNumericPrimitive(value, context));
        case "-":
            return -toNumber(await toNumericPrimitive(value, context));
        case "~":
            return ~toNumber(await toNumericPrimitive(value, context));
    }
}
function describeTypeofValue(value) {
    if (isSandboxClosure(value)) {
        return "function";
    }
    if (value === null || typeof value === "object") {
        return "object";
    }
    return typeof value;
}
function isTruthy(value) {
    return Boolean(value);
}
function applyBinaryOperator(node, left, right, context) {
    switch (node.operator) {
        case "+":
            return applyAdditionOperator(left, right, context);
        case "-":
            return toNumber(left) - toNumber(right);
        case "*":
            return toNumber(left) * toNumber(right);
        case "/":
            return toNumber(left) / toNumber(right);
        case "%":
            return toNumber(left) % toNumber(right);
        case "**":
            return toNumber(left) ** toNumber(right);
        case "<":
            return compareRelational(left, right, "<");
        case "<=":
            return compareRelational(left, right, "<=");
        case ">":
            return compareRelational(left, right, ">");
        case ">=":
            return compareRelational(left, right, ">=");
        case "===":
            return left === right;
        case "!==":
            return left !== right;
        case "==":
            return isLooselyEqual(left, right);
        case "!=":
            return !isLooselyEqual(left, right);
        case "&":
            return toNumber(left) & toNumber(right);
        case "|":
            return toNumber(left) | toNumber(right);
        case "^":
            return toNumber(left) ^ toNumber(right);
        case "<<":
            return toNumber(left) << toNumber(right);
        case ">>":
            return toNumber(left) >> toNumber(right);
        case ">>>":
            return toNumber(left) >>> toNumber(right);
        case "instanceof":
            if (isSandboxMapConstructor(right) && isSandboxMap(left)) {
                return true;
            }
            if (isSandboxSetConstructor(right) && isSandboxSet(left)) {
                return true;
            }
            if (isSandboxErrorConstructorInstance(left, right)) {
                return true;
            }
            if (isSandboxClosure(right) &&
                right.construct !== undefined &&
                !isSandboxErrorConstructor(right)) {
                throw new TypeError("Constructor prototypes are not supported; check a brand property instead.");
            }
            return false;
        case "in":
            throw createError("UNSUPPORTED_NODE", node, "Binary operator 'in' is not supported.");
    }
}
function applyCompoundAssignmentOperator(operator, left, right, context) {
    switch (operator) {
        case "+=":
            return applyAdditionOperator(left, right, context);
        case "-=":
            return toNumber(left) - toNumber(right);
        case "*=":
            return toNumber(left) * toNumber(right);
        case "/=":
            return toNumber(left) / toNumber(right);
        case "%=":
            return toNumber(left) % toNumber(right);
        case "**=":
            return toNumber(left) ** toNumber(right);
        case "&=":
            return toNumber(left) & toNumber(right);
        case "|=":
            return toNumber(left) | toNumber(right);
        case "^=":
            return toNumber(left) ^ toNumber(right);
        case "<<=":
            return toNumber(left) << toNumber(right);
        case ">>=":
            return toNumber(left) >> toNumber(right);
        case ">>>=":
            return toNumber(left) >>> toNumber(right);
    }
}
function applyAdditionOperator(left, right, context) {
    const leftPrimitive = toPrimitive(left);
    const rightPrimitive = toPrimitive(right);
    if (typeof leftPrimitive === "string" || typeof rightPrimitive === "string") {
        return context.budget.allocateString(toString(leftPrimitive) + toString(rightPrimitive));
    }
    return toNumber(leftPrimitive) + toNumber(rightPrimitive);
}
function compareRelational(left, right, operator) {
    const leftPrimitive = toPrimitive(left);
    const rightPrimitive = toPrimitive(right);
    if (typeof leftPrimitive === "string" && typeof rightPrimitive === "string") {
        switch (operator) {
            case "<":
                return leftPrimitive < rightPrimitive;
            case "<=":
                return leftPrimitive <= rightPrimitive;
            case ">":
                return leftPrimitive > rightPrimitive;
            case ">=":
                return leftPrimitive >= rightPrimitive;
        }
    }
    const leftNumber = toNumber(leftPrimitive);
    const rightNumber = toNumber(rightPrimitive);
    switch (operator) {
        case "<":
            return leftNumber < rightNumber;
        case "<=":
            return leftNumber <= rightNumber;
        case ">":
            return leftNumber > rightNumber;
        case ">=":
            return leftNumber >= rightNumber;
    }
}
function isLooselyEqual(left, right) {
    const leftType = getCoercionType(left);
    const rightType = getCoercionType(right);
    if (leftType === rightType) {
        return left === right;
    }
    if ((left === null && right === undefined) || (left === undefined && right === null)) {
        return true;
    }
    if (leftType === "number" && rightType === "string") {
        return isLooselyEqual(left, toNumber(right));
    }
    if (leftType === "string" && rightType === "number") {
        return isLooselyEqual(toNumber(left), right);
    }
    if (leftType === "boolean") {
        return isLooselyEqual(toNumber(left), right);
    }
    if (rightType === "boolean") {
        return isLooselyEqual(left, toNumber(right));
    }
    if (isPrimitiveCoercionType(leftType) && rightType === "object") {
        return isLooselyEqual(left, toPrimitive(right));
    }
    if (leftType === "object" && isPrimitiveCoercionType(rightType)) {
        return isLooselyEqual(toPrimitive(left), right);
    }
    return false;
}
function isPrimitiveCoercionType(type) {
    return type !== "object";
}
function getCoercionType(value) {
    if (value === null) {
        return "null";
    }
    if (value === undefined) {
        return "undefined";
    }
    if (typeof value === "string") {
        return "string";
    }
    if (typeof value === "number") {
        return "number";
    }
    if (typeof value === "boolean") {
        return "boolean";
    }
    return "object";
}
function toPrimitive(value) {
    if (isPrimitiveCoercionType(getCoercionType(value))) {
        return value;
    }
    return toString(value);
}
async function toNumericPrimitive(value, context) {
    if (isPrimitiveCoercionType(getCoercionType(value))) {
        return value;
    }
    if (isIndexableSandboxValue(value)) {
        for (const methodName of ["valueOf", "toString"]) {
            const method = getMemberValue(value, methodName, context);
            if (!isSandboxClosure(method)) {
                continue;
            }
            const result = await invokeSandboxClosure(method, [], context, context.callStack, undefined, value);
            if (isPrimitiveCoercionType(getCoercionType(result))) {
                return result;
            }
        }
    }
    return toString(value);
}
function toNumber(value) {
    if (typeof value === "number") {
        return value;
    }
    if (typeof value === "string") {
        return Number(value);
    }
    if (typeof value === "boolean") {
        return value ? 1 : 0;
    }
    if (value === null) {
        return 0;
    }
    if (value === undefined) {
        return NaN;
    }
    return toNumber(toPrimitive(value));
}
function toString(value) {
    if (Array.isArray(value)) {
        return value
            .map((entry) => (entry === null || entry === undefined ? "" : toString(entry)))
            .join(",");
    }
    if (typeof value === "object" && value !== null) {
        return "[object Object]";
    }
    return String(value);
}
function isIndexableSandboxValue(value) {
    return Array.isArray(value) || isPlainSandboxObject(value);
}
function appendArrayValues(target, values) {
    for (const value of values) {
        target.push(value);
    }
}
function isPlainSandboxObject(value) {
    return (typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        !isSandboxClosure(value) &&
        !isSandboxMap(value) &&
        !isSandboxSet(value) &&
        !isSandboxPromise(value) &&
        !isSandboxRegex(value));
}
function getMemberValue(target, property, context) {
    if (Array.isArray(target)) {
        return getArrayMemberValue(target, property, context);
    }
    return Object.hasOwn(target, String(property)) ? target[String(property)] : undefined;
}
function getArrayMemberValue(target, property, context) {
    if (property === "raw") {
        return taggedTemplateRawArrays.get(target);
    }
    return getArrayMember(target, property, createArrayMethodOptions(context));
}
function setSandboxProperty(target, property, value) {
    if (Array.isArray(target)) {
        assertCollectionMutable(target);
        const key = String(property);
        if (key === "length" || isArrayIndexKey(key)) {
            target[key] = value;
            return;
        }
        defineSandboxProperty(target, key, value);
        return;
    }
    defineSandboxProperty(target, String(property), value);
}
function deleteSandboxProperty(target, property) {
    if (Array.isArray(target)) {
        assertCollectionMutable(target);
    }
    delete target[String(property)];
}
function getClosureMemberValue(target, property, context) {
    return getFunctionMember(target, property, createFunctionMethodOptions(context));
}
async function evaluateResolvedCallExpression(node, callee, context, thisValue = undefined) {
    if (callee === null || callee === undefined) {
        if (node.optional) {
            return {
                kind: "normal",
                hasValue: true,
                value: undefined
            };
        }
        throw new TypeError("Attempted to call a non-function value.");
    }
    if (!isSandboxClosure(callee)) {
        throw new TypeError("Attempted to call a non-function value.");
    }
    const args = await evaluateCallArguments(node.arguments, context);
    if (!args.ok) {
        return args.result;
    }
    return {
        kind: "normal",
        hasValue: true,
        value: await invokeSandboxClosure(callee, args.value, context, [...context.callStack, formatStackFrame(node, callee.name)], node.span, thisValue)
    };
}
async function evaluateNumberMethodCall(node, target, methodName, context) {
    const args = await evaluateCallArguments(node.arguments, context);
    if (!args.ok) {
        return args.result;
    }
    try {
        return {
            kind: "normal",
            hasValue: true,
            value: callNumberMethod(target, methodName, args.value, context.budget)
        };
    }
    catch (error) {
        if (isFatalSandboxError(error)) {
            throw error;
        }
        throw captureException(error, [...context.callStack, formatStackFrame(node, methodName)]);
    }
}
function createArrayMethodOptions(context) {
    return {
        budget: context.budget,
        callClosure: (closure, args, stack) => invokeSandboxClosure(closure, args, context, stack)
    };
}
function createMapMethodOptions(context) {
    return {
        budget: context.budget,
        callClosure: (closure, args, stack) => invokeSandboxClosure(closure, args, context, stack)
    };
}
function createSetMethodOptions(context) {
    return {
        budget: context.budget,
        callClosure: (closure, args, stack) => invokeSandboxClosure(closure, args, context, stack)
    };
}
function createFunctionMethodOptions(context) {
    return {
        callClosure: (closure, args, stack, thisValue) => invokeSandboxClosure(closure, args, context, stack, undefined, thisValue)
    };
}
async function invokeSandboxClosure(callee, args, context, stack, span, thisValue = undefined) {
    const leaveCall = context.budget.enterCall();
    try {
        const result = Reflect.apply(callee.call, undefined, [
            args,
            {
                stack,
                thisValue,
                ...(span === undefined ? {} : { span })
            }
        ]);
        if (isSandboxPromise(result) && result.synchronousPrefix !== undefined) {
            await result.synchronousPrefix;
        }
        return callee.async === true
            ? normalizeClosureResult(wrapHostResult(result, stack), context.budget)
            : await wrapHostResult(result, stack);
    }
    catch (error) {
        if (isFatalSandboxError(error)) {
            throw error;
        }
        throw captureException(error, stack);
    }
    finally {
        leaveCall();
    }
}
async function evaluateCallArguments(args, context) {
    const values = [];
    for (const arg of args) {
        if (arg.type === "SpreadElement") {
            const spreadValues = await evaluateSpreadElement(arg, context);
            if (!spreadValues.ok) {
                return spreadValues;
            }
            appendArrayValues(values, spreadValues.value);
            context.budget.allocateArrayLength(values.length);
            continue;
        }
        const result = await evaluateNode(arg, context);
        if (result.kind !== "normal") {
            return {
                ok: false,
                result
            };
        }
        values.push(result.value);
        context.budget.allocateArrayLength(values.length);
    }
    return {
        ok: true,
        value: values
    };
}
async function evaluateSpreadElement(node, context) {
    const value = await evaluateNode(node.argument, context);
    if (value.kind !== "normal") {
        return {
            ok: false,
            result: value
        };
    }
    const iterator = getSpreadIterator(value.value);
    if (iterator === undefined) {
        throw new TypeError("Spread arguments must evaluate to an iterable.");
    }
    const spreadValues = [];
    while (true) {
        const next = await iterator.next();
        if (typeof next !== "object" || next === null) {
            throw new TypeError("Iterator result must be an object.");
        }
        if (next.done === true) {
            break;
        }
        spreadValues.push(next.value);
        context.budget.allocateArrayLength(spreadValues.length);
    }
    return {
        ok: true,
        value: spreadValues
    };
}
async function evaluateObjectSpread(node, context) {
    const value = await evaluateNode(node.argument, context);
    if (value.kind !== "normal") {
        return {
            ok: false,
            result: value
        };
    }
    if (value.value === null || value.value === undefined) {
        return {
            ok: true,
            value: []
        };
    }
    if (isSandboxClosure(value.value) || isSandboxPromise(value.value)) {
        throw new TypeError(`Cannot spread ${describeObjectSpreadValue(value.value)} into object literal.`);
    }
    const spreadValue = Object(value.value);
    const keys = Object.keys(spreadValue);
    context.budget.allocateArrayLength(keys.length);
    return {
        ok: true,
        value: keys.map((key) => [key, spreadValue[key]])
    };
}
function describeObjectSpreadValue(value) {
    if (value === null) {
        return "null";
    }
    if (value === undefined) {
        return "undefined";
    }
    if (isSandboxClosure(value)) {
        return "function";
    }
    if (isSandboxPromise(value)) {
        return "promise";
    }
    return typeof value;
}
function getSpreadIterator(value) {
    return getSandboxIterator(value);
}
async function closeIterator(iterator) {
    if (iterator.generator && iterator.return !== undefined) {
        await iterator.return();
    }
}
function defineSandboxProperty(target, key, value) {
    Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true
    });
}
function isInterpreterError(value) {
    return (typeof value === "object" &&
        value !== null &&
        hasOwnProperty(value, "code") &&
        hasOwnProperty(value, "message") &&
        hasOwnProperty(value, "nodeType") &&
        hasOwnProperty(value, "span") &&
        (value.code === "UNBOUND_IDENTIFIER" || value.code === "UNSUPPORTED_NODE"));
}
function hasOwnProperty(value, name) {
    return Object.prototype.hasOwnProperty.call(value, name);
}
function wrapHostResult(result, stack) {
    if (!isPromiseLikeResult(result)) {
        return result;
    }
    return Promise.resolve(result).then((value) => value, (reason) => Promise.reject(isInterpreterError(reason) || reason instanceof SandboxError || isCapturedException(reason)
        ? reason
        : createCapturedException(reason, stack)));
}
function captureException(error, stack) {
    return isCapturedException(error) ? error : createCapturedException(error, stack);
}
function isFatalSandboxError(error) {
    return (error instanceof SandboxError && (error.code === "budgetExceeded" || error.code === "reentry"));
}
function isPromiseLikeResult(value) {
    return typeof value === "object" && value !== null && "then" in value;
}
