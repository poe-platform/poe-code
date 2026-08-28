import { attachErrorSpan, attachWrappedErrorCause, describeThrownValue, formatErrorStack, readErrorCause, readErrorSpan } from "../error/shape.js";
import { SandboxError } from "./budget.js";
import { HostCallResumabilityError } from "./host-call.js";
import { deepCopyToSandbox } from "./values.js";
const capturedExceptionBrand = Symbol("CapturedException");
const sandboxErrorBrand = Symbol("SandboxError");
const sandboxErrorNames = [
    "Error",
    "TypeError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "AbortError",
    "AggregateError",
    "HarnessFailure"
];
export async function evaluateThrowStatement(node, context, evaluateNode) {
    const argument = await evaluateNode(node.argument, context);
    if (argument.kind !== "normal") {
        return argument;
    }
    return {
        kind: "throw",
        hasValue: true,
        span: node.span,
        stackFrames: context.callStack,
        value: argument.value
    };
}
export async function evaluateTryStatement(node, context, evaluateNode) {
    let fatalBudgetError;
    let tryResult;
    try {
        tryResult = await evaluateBlockCompletion(node.block, context, evaluateNode);
    }
    catch (error) {
        if (!isBudgetExceeded(error) || node.finalizer === undefined) {
            throw error;
        }
        fatalBudgetError = error;
        tryResult = {
            kind: "throw",
            hasValue: true,
            value: undefined
        };
    }
    const tryOrCatchResult = fatalBudgetError === undefined && tryResult.kind === "throw" && node.handler !== undefined
        ? await evaluateCatchClause(node.handler, tryResult.value, context, evaluateNode)
        : tryResult;
    if (node.finalizer === undefined || tryOrCatchResult.kind === "error") {
        return tryOrCatchResult;
    }
    const finalizerResult = fatalBudgetError?.budget === "deadline"
        ? await evaluateWithoutDeadlineChecks(context, () => evaluateBlockCompletion(node.finalizer, context, evaluateNode))
        : await evaluateBlockCompletion(node.finalizer, context, evaluateNode);
    if (fatalBudgetError !== undefined) {
        throw fatalBudgetError;
    }
    if (finalizerResult.kind === "normal") {
        return tryOrCatchResult;
    }
    return finalizerResult;
}
export function createCapturedException(reason, stackFrames) {
    return {
        reason,
        stackFrames,
        [capturedExceptionBrand]: true
    };
}
export function isCapturedException(value) {
    return typeof value === "object" && value !== null && capturedExceptionBrand in value;
}
export function coerceThrownValue(reason, budget, stackFrames, span) {
    if (isSubsetErrorValue(reason)) {
        attachErrorSpan(reason, readErrorSpan(reason) ?? span);
        return reason;
    }
    if (reason instanceof Error) {
        return createSubsetErrorValue(reason.name || "Error", reason.message, stackFrames, budget, {
            chargeBudget: false,
            cause: readErrorCause(reason),
            span
        });
    }
    if (isErrorLikeValue(reason)) {
        return createSubsetErrorValue(reason.name || "Error", reason.message, stackFrames, budget, {
            chargeBudget: false,
            cause: readErrorCause(reason),
            span
        });
    }
    return deepCopyToSandbox(reason);
}
export function surfaceThrownValue(reason, budget, stackFrames = [], span) {
    if (reason instanceof HostCallResumabilityError) {
        throw reason;
    }
    if (isSubsetErrorValue(reason)) {
        normalizeSurfacedSubsetError(reason, budget, stackFrames, span);
        return reason;
    }
    if (reason instanceof Error) {
        const error = createSubsetErrorValue(reason.name || "Error", reason.message, stackFrames, budget, {
            cause: reason,
            chargeBudget: false,
            span
        });
        normalizeSurfacedSubsetError(error, budget, stackFrames, span);
        return error;
    }
    if (isErrorLikeValue(reason)) {
        const error = createSubsetErrorValue(reason.name || "Error", reason.message, stackFrames, budget, {
            cause: readErrorCause(reason),
            chargeBudget: false,
            span
        });
        normalizeSurfacedSubsetError(error, budget, stackFrames, span);
        return error;
    }
    return createSubsetErrorValue("Error", describeThrownValue(reason), stackFrames, budget, {
        chargeBudget: false,
        span
    });
}
export function createSubsetErrorValue(name, message, stackFrames, budget, options = {}) {
    const resumeChecks = options.chargeBudget === false ? budget.suspendChecks() : undefined;
    try {
        const errorName = budget.allocateString(name === "" ? "Error" : name);
        const errorMessage = budget.allocateString(coerceErrorMessage(message));
        const header = errorMessage === "" ? errorName : `${errorName}: ${errorMessage}`;
        const stack = budget.allocateString([header, ...[...stackFrames].reverse()].join("\n"));
        const error = {
            name: errorName,
            message: errorMessage,
            stack
        };
        defineSandboxErrorMetadata(error, errorName);
        attachErrorSpan(error, options.span);
        attachWrappedErrorCause(error, options.cause);
        return error;
    }
    finally {
        resumeChecks?.();
    }
}
export function isSandboxErrorConstructorInstance(value, name) {
    return isSandboxErrorObject(value) && value[sandboxErrorBrand].chain.includes(name);
}
function defineSandboxErrorMetadata(error, name) {
    const metadataName = toSandboxErrorName(name);
    Object.defineProperty(error, sandboxErrorBrand, {
        enumerable: false,
        value: {
            chain: metadataName === "Error" ? ["Error"] : [metadataName, "Error"],
            name: metadataName
        }
    });
}
function toSandboxErrorName(name) {
    return isSandboxErrorName(name) ? name : "Error";
}
function isSandboxErrorName(name) {
    return sandboxErrorNames.includes(name);
}
function isSandboxErrorObject(value) {
    return typeof value === "object" && value !== null && sandboxErrorBrand in value;
}
function isSubsetErrorValue(value) {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return ((prototype === Object.prototype || prototype === null) &&
        typeof value.name === "string" &&
        typeof value.message === "string" &&
        typeof value.stack === "string");
}
function normalizeSurfacedSubsetError(error, budget, stackFrames, span) {
    const resumeChecks = budget.suspendChecks();
    try {
        const name = budget.allocateString(toSandboxErrorName(readErrorName(error)));
        const message = budget.allocateString(readSurfacedErrorMessage(error, name));
        const frames = readSandboxStackFrames(error.stack);
        error.name = name;
        error.message = message;
        error.stack = budget.allocateString(formatErrorStack(name, message, frames.length > 0 ? frames : [...stackFrames].reverse()));
        attachErrorSpan(error, readErrorSpan(error) ?? span);
    }
    finally {
        resumeChecks();
    }
}
function readErrorName(error) {
    return typeof error.name === "string" && error.name.length > 0 ? error.name : "Error";
}
function readSurfacedErrorMessage(error, name) {
    const message = typeof error.message === "string" ? error.message : "";
    if (message === "") {
        return `${name} thrown`;
    }
    if (message === "[object Object]") {
        return `${name} thrown with non-string message`;
    }
    return message;
}
function readSandboxStackFrames(stack) {
    if (typeof stack !== "string") {
        return [];
    }
    const [, ...frames] = stack.split("\n");
    return frames;
}
function isErrorLikeValue(value) {
    return (typeof value === "object" &&
        value !== null &&
        typeof value.name === "string" &&
        typeof value.message === "string");
}
function coerceErrorMessage(message) {
    if (message === undefined) {
        return "";
    }
    if (Array.isArray(message)) {
        return message
            .map((value) => (value === null || value === undefined ? "" : String(value)))
            .join(",");
    }
    if (typeof message === "object" && message !== null) {
        return "[object Object]";
    }
    return String(message);
}
async function evaluateWithoutDeadlineChecks(context, evaluate) {
    const resumeDeadlineChecks = context.budget.suspendDeadlineChecks();
    try {
        return await evaluate();
    }
    finally {
        resumeDeadlineChecks();
    }
}
function isBudgetExceeded(error) {
    return error instanceof SandboxError && error.code === "budgetExceeded";
}
async function evaluateCatchClause(node, thrownValue, context, evaluateNode) {
    const scope = context.scope.child();
    const catchContext = {
        ...context,
        scope
    };
    if (node.param !== undefined) {
        const binding = await bindPattern(node.param, thrownValue, catchContext, evaluateNode);
        if (!binding.ok) {
            return binding.result;
        }
    }
    return evaluateBlockCompletion(node.body, catchContext, evaluateNode);
}
async function evaluateBlockCompletion(node, context, evaluateNode) {
    const blockContext = {
        ...context,
        scope: context.scope.child()
    };
    predeclareBlockBindings(node, blockContext.scope);
    let result = {
        kind: "normal",
        hasValue: false,
        value: undefined
    };
    for (const statement of node.body) {
        result = await evaluateNode(statement, blockContext);
        if (result.kind !== "normal") {
            return result;
        }
    }
    return result;
}
function predeclareBlockBindings(node, scope) {
    const names = new Set();
    for (const statement of node.body) {
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
async function bindPattern(pattern, value, context, evaluateNode) {
    switch (pattern.type) {
        case "Identifier":
            context.scope.declare(pattern.name, "let", value);
            return { ok: true };
        case "MemberExpression":
            throw new TypeError("Catch bindings do not support member expressions.");
        case "AssignmentPattern":
            return bindAssignmentPattern(pattern, value, context, evaluateNode);
        case "ArrayPattern":
            return bindArrayPattern(pattern, value, context, evaluateNode);
        case "ObjectPattern":
            return bindObjectPattern(pattern, value, context, evaluateNode);
        case "RestElement":
            return bindPattern(pattern.argument, value, context, evaluateNode);
    }
}
async function bindAssignmentPattern(pattern, value, context, evaluateNode) {
    let nextValue = value;
    if (nextValue === undefined) {
        const defaultValue = await evaluateNode(pattern.right, context);
        if (defaultValue.kind !== "normal") {
            return {
                ok: false,
                result: defaultValue
            };
        }
        nextValue = defaultValue.value;
    }
    return bindPattern(pattern.left, nextValue, context, evaluateNode);
}
async function bindArrayPattern(pattern, value, context, evaluateNode) {
    if (!Array.isArray(value)) {
        throw new TypeError("Array catch bindings require an array value.");
    }
    for (let index = 0; index < pattern.elements.length; index += 1) {
        const element = pattern.elements[index];
        if (element === null) {
            continue;
        }
        const elementValue = element.type === "RestElement" ? value.slice(index) : value[index];
        const binding = await bindPattern(element, elementValue, context, evaluateNode);
        if (!binding.ok) {
            return binding;
        }
    }
    return { ok: true };
}
async function bindObjectPattern(pattern, value, context, evaluateNode) {
    if ((typeof value !== "object" && !Array.isArray(value)) || value === null) {
        throw new TypeError("Object catch bindings require a non-null object value.");
    }
    const excludedKeys = new Set();
    for (const property of pattern.properties) {
        if (property.type === "RestElement") {
            const restValue = copyObjectRest(value, excludedKeys);
            const binding = await bindPattern(property, restValue, context, evaluateNode);
            if (!binding.ok) {
                return binding;
            }
            continue;
        }
        const key = await resolvePatternPropertyKey(property, context, evaluateNode);
        if (!key.ok) {
            return key;
        }
        excludedKeys.add(String(key.value));
        const binding = await bindPattern(property.value, getObjectPatternValue(value, key.value), context, evaluateNode);
        if (!binding.ok) {
            return binding;
        }
    }
    return { ok: true };
}
async function resolvePatternPropertyKey(property, context, evaluateNode) {
    if (!property.computed) {
        return {
            ok: true,
            value: getStaticPropertyKey(property.key)
        };
    }
    const computedKey = await evaluateNode(property.key, context);
    if (computedKey.kind !== "normal") {
        return {
            ok: false,
            result: computedKey
        };
    }
    if (typeof computedKey.value !== "string" && typeof computedKey.value !== "number") {
        throw new TypeError("Computed catch binding keys must evaluate to a string or number.");
    }
    return {
        ok: true,
        value: computedKey.value
    };
}
function getStaticPropertyKey(property) {
    switch (property.type) {
        case "Identifier":
            return property.name;
        case "StringLiteral":
        case "NumericLiteral":
            return property.value;
        default:
            throw new TypeError(`Unsupported catch binding property key '${property.type}'.`);
    }
}
function getObjectPatternValue(value, key) {
    return value[key];
}
function copyObjectRest(value, excludedKeys) {
    const rest = Object.create(null);
    for (const [key, entryValue] of Object.entries(value)) {
        if (excludedKeys.has(key)) {
            continue;
        }
        rest[key] = entryValue;
    }
    return rest;
}
