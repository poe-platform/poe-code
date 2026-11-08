import { createGeneratorChannel } from "./generator.js";
import { getBoundOtelSpan } from "../observability/otel.js";
import { bindPattern } from "./patterns.js";
import { getThenable, resolveSandboxValue } from "./promise.js";
import { runAsyncPrefix, suspendJob } from "./jobs.js";
import { awaitSandboxValue } from "./cancel.js";
import { hoistVarDeclarations } from "./var-hoist.js";
import { createSandboxArguments, createSandboxClosure, createSandboxGenerator, createSandboxPromise, isSandboxPromise } from "./values.js";
export function emitResumeBreakpoint(context, breakpoint) {
    context.onYield?.({
        ...breakpoint,
        snapshot: () => context.snapshot?.(context.scope) ?? context.scope.snapshot()
    });
}
export async function evaluateArrowFunctionExpression(node, context, evaluateNode) {
    return {
        kind: "normal",
        hasValue: true,
        value: createInterpretedClosure(node, context, evaluateNode)
    };
}
export async function evaluateFunctionExpression(node, context, evaluateNode) {
    if (node.id === undefined) {
        return {
            kind: "normal",
            hasValue: true,
            value: createInterpretedClosure(node, context, evaluateNode)
        };
    }
    const wrapperScope = context.scope.child();
    const closure = createInterpretedClosure(node, { ...context, scope: wrapperScope }, evaluateNode);
    wrapperScope.declare(node.id.name, "const", closure);
    return {
        kind: "normal",
        hasValue: true,
        value: closure
    };
}
export function createInterpretedClosure(node, context, evaluateNode) {
    if (node.type !== "ArrowFunctionExpression" && node.generator) {
        return createGeneratorClosure(node, context, evaluateNode);
    }
    const construct = node.type !== "ArrowFunctionExpression" &&
        !(node.type === "FunctionExpression" && node.method === true) &&
        !node.async
        ? async (args, callContext) => {
            const thisValue = {};
            const result = await executeClosure(node, args, thisValue, {
                ...context,
                callStack: [...(callContext?.stack ?? context.callStack)]
            }, evaluateNode);
            return isConstructResult(result) ? result : thisValue;
        }
        : undefined;
    return createSandboxClosure({
        ...(node.async ? { async: true } : {}),
        ...(node.type === "FunctionDeclaration" || node.type === "FunctionExpression"
            ? node.id === undefined
                ? {}
                : { name: node.id.name }
            : {}),
        ...(construct === undefined ? {} : { construct }),
        retainedValues: () => context.scope.retainedValues(),
        call: (args, callContext) => {
            const invocationContext = {
                ...context,
                callStack: [...(callContext?.stack ?? context.callStack)]
            };
            if (!node.async)
                return executeClosure(node, args, callContext?.thisValue, invocationContext, evaluateNode);
            let completePrefix;
            const synchronousPrefix = new Promise((resolve) => {
                completePrefix = resolve;
            });
            const execution = runAsyncPrefix(() => executeClosure(node, args, callContext?.thisValue, { ...invocationContext, onSuspend: completePrefix }, evaluateNode));
            execution.then(completePrefix, completePrefix);
            return createSandboxPromise(resolveSandboxValue(execution.then((value) => isSandboxPromise(value) || getThenable(value) !== undefined
                ? awaitSandboxValue(value, context.signal)
                : value), { budget: context.budget }), { synchronousPrefix });
        }
    });
}
function createGeneratorClosure(node, context, evaluateNode) {
    return createSandboxClosure({
        ...(node.id === undefined ? {} : { name: node.id.name }),
        retainedValues: () => context.scope.retainedValues(),
        call: async (args, callContext) => {
            const closureContext = {
                ...context,
                callStack: [...(callContext?.stack ?? context.callStack)]
            };
            const scope = await createClosureScope(node, args, callContext?.thisValue, closureContext, evaluateNode);
            const channel = createGeneratorChannel(async (generatorYield) => {
                const result = await evaluateNode(node.body, {
                    ...closureContext,
                    generatorYield: (value, yieldNodeId) => {
                        generator.state = "suspended";
                        return generatorYield(value, yieldNodeId);
                    },
                    scope
                });
                if (result.kind === "error") {
                    throw result.error;
                }
                if (result.kind === "throw") {
                    throw result.value;
                }
                return result.hasValue ? result.value : undefined;
            });
            const generator = createSandboxGenerator(channel);
            return generator;
        }
    });
}
function isConstructResult(value) {
    return typeof value === "object" && value !== null;
}
export async function evaluateAwaitExpression(node, context, evaluateNode) {
    const replayState = context.captureReplayState?.();
    const argument = await evaluateNode(node.argument, context);
    if (argument.kind !== "normal") {
        return argument;
    }
    context.onSuspend?.();
    emitResumeBreakpoint(context, {
        kind: "await",
        replayState,
        nodeId: node.nodeId,
        ...(getBoundOtelSpan(argument.value) === undefined
            ? {}
            : { otelSpan: getBoundOtelSpan(argument.value) }),
        span: node.span
    });
    const leaveAwait = context.budget.enterAwait();
    try {
        return {
            kind: "normal",
            hasValue: true,
            value: await suspendJob(awaitSandboxValue(argument.value, context.signal))
        };
    }
    finally {
        leaveAwait();
    }
}
async function executeClosure(node, args, thisValue, context, evaluateNode) {
    const scope = await createClosureScope(node, args, thisValue, context, evaluateNode);
    const result = await evaluateNode(node.body, {
        ...context,
        scope
    });
    if (result.kind === "error") {
        throw result.error;
    }
    if (result.kind === "throw") {
        throw result.value;
    }
    if (isBlockBody(node.body)) {
        return result.hasValue ? result.value : undefined;
    }
    return result.value;
}
async function createClosureScope(node, args, thisValue, context, evaluateNode) {
    const scope = context.scope.child({}, { functionBoundary: true });
    if (node.type !== "ArrowFunctionExpression") {
        scope.declare("this", "const", thisValue);
        context.budget.allocateArrayLength(args.length);
        scope.declare("arguments", "let", createSandboxArguments(args));
    }
    await bindParameters(node.params, args, scope, context, evaluateNode);
    hoistVarDeclarations(node.body, scope);
    return scope;
}
function isBlockBody(body) {
    return body.type === "BlockStatement";
}
async function bindParameters(params, args, scope, context, evaluateNode) {
    for (const param of params) {
        for (const name of getParameterBindingNames(param)) {
            scope.predeclare(name, "let");
        }
    }
    for (let index = 0; index < params.length; index += 1) {
        const param = params[index];
        if (param.type === "RestElement") {
            const rest = args.slice(index);
            context.budget.allocateArrayLength(rest.length);
            const binding = await bindPattern(param, rest, { kind: "let" }, scope, {
                evaluate: (defaultNode) => evaluateNode(defaultNode, { ...context, scope })
            });
            if (!binding.ok) {
                if (binding.result.kind === "error") {
                    throw binding.result.error;
                }
                if (binding.result.kind === "throw") {
                    throw binding.result.value;
                }
            }
            return;
        }
        const binding = await bindPattern(param, args[index], { kind: "let" }, scope, {
            evaluate: (defaultNode) => evaluateNode(defaultNode, { ...context, scope })
        });
        if (!binding.ok) {
            if (binding.result.kind === "error") {
                throw binding.result.error;
            }
            if (binding.result.kind === "throw") {
                throw binding.result.value;
            }
        }
    }
}
function getParameterBindingNames(pattern) {
    switch (pattern.type) {
        case "Identifier":
            return [pattern.name];
        case "MemberExpression":
            return [];
        case "AssignmentPattern":
            return getParameterBindingNames(pattern.left);
        case "RestElement":
            return getParameterBindingNames(pattern.argument);
        case "ArrayPattern":
            return pattern.elements.flatMap((element) => element === null ? [] : getParameterBindingNames(element));
        case "ObjectPattern":
            return pattern.properties.flatMap((property) => property.type === "RestElement"
                ? getParameterBindingNames(property)
                : getParameterBindingNames(property.value));
    }
}
export function normalizeClosureResult(result, budget) {
    if (isSandboxPromise(result)) {
        return result;
    }
    return createSandboxPromise(resolveSandboxValue(result, { budget }));
}
