export function assignIds(root) {
    const visited = new Set();
    const children = [];
    let nextId = 0;
    const stack = [root];
    while (stack.length > 0) {
        const node = stack.pop();
        if (visited.has(node)) {
            continue;
        }
        visited.add(node);
        Object.defineProperty(node, "nodeId", {
            value: nextId,
            writable: true,
            configurable: true,
            enumerable: false
        });
        nextId += 1;
        if (node.type === "UnaryExpression") {
            const argument = node.argument;
            if (isAstNode(argument)) {
                stack.push(argument);
            }
            continue;
        }
        if (node.type === "ExpressionStatement") {
            const expression = node.expression;
            if (isAstNode(expression)) {
                stack.push(expression);
            }
            continue;
        }
        if (node.type === "Module") {
            const body = node.body;
            if (Array.isArray(body)) {
                for (let index = body.length - 1; index >= 0; index -= 1) {
                    const statement = body[index];
                    if (isAstNode(statement)) {
                        stack.push(statement);
                    }
                }
            }
            continue;
        }
        collectChildren(node, children);
        for (let index = children.length - 1; index >= 0; index -= 1) {
            stack.push(children[index]);
        }
        children.length = 0;
    }
    return root;
}
function collectChildren(node, children) {
    for (const key in node) {
        if (key === "nodeId" || key === "span" || key === "type") {
            continue;
        }
        collectChild(node[key], children);
    }
    if (children.length <= 1) {
        return;
    }
    children.sort(compareBySourceOrder);
    const seen = new Set();
    let writeIndex = 0;
    for (const child of children) {
        if (seen.has(child)) {
            continue;
        }
        seen.add(child);
        children[writeIndex] = child;
        writeIndex += 1;
    }
    children.length = writeIndex;
}
function collectChild(value, discovered) {
    if (isAstNode(value)) {
        discovered.push(value);
        return;
    }
    if (!Array.isArray(value)) {
        return;
    }
    for (const entry of value) {
        if (isAstNode(entry)) {
            discovered.push(entry);
        }
    }
}
function compareBySourceOrder(left, right) {
    const startOffset = left.span.start.offset - right.span.start.offset;
    if (startOffset !== 0) {
        return startOffset;
    }
    return left.span.end.offset - right.span.end.offset;
}
function isAstNode(value) {
    return (typeof value === "object" &&
        value !== null &&
        "type" in value &&
        typeof value.type === "string" &&
        "span" in value &&
        typeof value.span?.start.offset === "number" &&
        typeof value.span?.end.offset === "number");
}
