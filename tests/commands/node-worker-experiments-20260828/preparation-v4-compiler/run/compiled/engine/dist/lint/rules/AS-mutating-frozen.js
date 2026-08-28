import { parseModule } from "../../parse/parser.js";
const MUTATING_ARRAY_METHODS = new Set([
    "copyWithin",
    "fill",
    "pop",
    "push",
    "reverse",
    "shift",
    "sort",
    "splice",
    "unshift"
]);
export function AS_MUTATING_FROZEN(source, options = {}) {
    return new ASMutatingFrozenScanner(options.filename ?? "<input>").scan(source);
}
class ASMutatingFrozenScanner {
    filename;
    diagnostics = [];
    scopes = [];
    constructor(filename) {
        this.filename = filename;
    }
    scan(source) {
        this.visitModule(parseModule(source, this.filename));
        return this.diagnostics;
    }
    visitModule(node) {
        this.withScope(this.collectStatementBindings(node.body), () => {
            for (const statement of node.body) {
                this.visitStatement(statement);
            }
        });
    }
    visitStatement(node) {
        switch (node.type) {
            case "FunctionDeclaration":
                this.visitArrowFunction(node);
                return;
            case "BlockStatement":
                this.visitBlockStatement(node);
                return;
            case "ExpressionStatement":
                this.visitExpression(node.expression);
                return;
            case "IfStatement":
                this.visitIfStatement(node);
                return;
            case "ForStatement":
                this.visitForStatement(node);
                return;
            case "ForInStatement":
            case "ForOfStatement":
                this.visitForOfStatement(node);
                return;
            case "WhileStatement":
            case "DoWhileStatement":
                this.visitWhileStatement(node);
                return;
            case "TryStatement":
                this.visitTryStatement(node);
                return;
            case "VariableDeclaration":
                this.visitVariableDeclaration(node);
                return;
            case "ReturnStatement":
                this.visitReturnStatement(node);
                return;
            case "ThrowStatement":
                this.visitThrowStatement(node);
                return;
            case "ExportNamedDeclaration":
                this.visitVariableDeclaration(node.declaration);
                return;
            case "ExportDefaultDeclaration":
                this.visitExpression(node.declaration);
                return;
            case "ImportDeclaration":
            case "BreakStatement":
            case "ContinueStatement":
                return;
        }
    }
    visitBlockStatement(node) {
        this.withScope(this.collectStatementBindings(node.body), () => {
            for (const statement of node.body) {
                this.visitStatement(statement);
            }
        });
    }
    visitIfStatement(node) {
        this.visitExpression(node.test);
        this.visitStatement(node.consequent);
        if (node.alternate !== undefined) {
            this.visitStatement(node.alternate);
        }
    }
    visitForStatement(node) {
        const bindings = node.init?.type === "VariableDeclaration" ? this.collectDeclarationBindings(node.init) : [];
        this.withScope(bindings, () => {
            if (node.init !== undefined) {
                if (node.init.type === "VariableDeclaration") {
                    this.visitVariableDeclaration(node.init);
                }
                else {
                    this.visitExpression(node.init);
                }
            }
            if (node.test !== undefined) {
                this.visitExpression(node.test);
            }
            if (node.update !== undefined) {
                this.visitExpression(node.update);
            }
            this.visitStatement(node.body);
        });
    }
    visitForOfStatement(node) {
        const bindings = node.left.type === "VariableDeclaration" ? this.collectDeclarationBindings(node.left) : [];
        this.withScope(bindings, () => {
            if (node.left.type === "VariableDeclaration") {
                this.visitVariableDeclaration(node.left);
            }
            else {
                this.visitAssignmentTarget(node.left);
            }
            this.visitExpression(node.right);
            this.visitStatement(node.body);
        });
    }
    visitWhileStatement(node) {
        this.visitExpression(node.test);
        this.visitStatement(node.body);
    }
    visitTryStatement(node) {
        this.visitBlockStatement(node.block);
        if (node.handler !== undefined) {
            this.visitCatchClause(node.handler);
        }
        if (node.finalizer !== undefined) {
            this.visitBlockStatement(node.finalizer);
        }
    }
    visitCatchClause(node) {
        const bindings = node.param === undefined
            ? []
            : this.createUnknownBindings(this.collectPatternBindings(node.param));
        this.withScope(bindings, () => {
            this.visitBlockStatement(node.body);
        });
    }
    visitVariableDeclaration(node) {
        for (const declarator of node.declarations) {
            this.visitVariableDeclarator(declarator);
        }
    }
    visitVariableDeclarator(node) {
        if (node.init !== undefined) {
            this.visitExpression(node.init);
        }
        if (node.id.type !== "Identifier") {
            this.visitBindingPattern(node.id);
            return;
        }
        this.setBinding(node.id.name, isImmutableArrayOrigin(node.init, (name) => this.lookup(name), (name) => this.isBound(name)));
    }
    visitReturnStatement(node) {
        if (node.argument !== undefined) {
            this.visitExpression(node.argument);
        }
    }
    visitThrowStatement(node) {
        this.visitExpression(node.argument);
    }
    visitExpression(node) {
        switch (node.type) {
            case "YieldExpression":
                if (node.argument !== undefined) {
                    this.visitExpression(node.argument);
                }
                return;
            case "FunctionExpression":
            case "ArrowFunctionExpression":
                this.visitArrowFunction(node);
                return;
            case "AwaitExpression":
                this.visitExpression(node.argument);
                return;
            case "ArrayExpression":
                this.visitArrayExpression(node);
                return;
            case "ObjectExpression":
                this.visitObjectExpression(node);
                return;
            case "UnaryExpression":
                this.visitUnaryExpression(node);
                return;
            case "BinaryExpression":
            case "LogicalExpression":
                this.visitBinaryLikeExpression(node);
                return;
            case "ConditionalExpression":
                this.visitConditionalExpression(node);
                return;
            case "MemberExpression":
                this.visitMemberExpression(node);
                return;
            case "AssignmentExpression":
                this.visitAssignmentExpression(node);
                return;
            case "CallExpression":
                this.visitCallExpression(node);
                return;
            case "TemplateLiteral":
                this.visitTemplateLiteral(node);
                return;
            case "TaggedTemplateExpression":
                this.visitTaggedTemplateExpression(node);
                return;
            case "Identifier":
            case "BooleanLiteral":
            case "MetaProperty":
            case "NullLiteral":
            case "NumericLiteral":
            case "RegexLiteral":
            case "StringLiteral":
            case "UndefinedLiteral":
                return;
        }
    }
    visitArrowFunction(node) {
        this.withScope(this.collectArrowFunctionBindings(node), () => {
            if (node.body.type === "BlockStatement") {
                this.visitBlockStatement(node.body);
                return;
            }
            this.visitExpression(node.body);
        });
    }
    visitArrayExpression(node) {
        for (const element of node.elements) {
            if (element.type === "SpreadElement") {
                this.visitExpression(element.argument);
                continue;
            }
            this.visitExpression(element);
        }
    }
    visitObjectExpression(node) {
        for (const property of node.properties) {
            if (property.type === "SpreadElement") {
                this.visitExpression(property.argument);
                continue;
            }
            this.visitProperty(property);
        }
    }
    visitProperty(node) {
        if (node.computed) {
            this.visitExpression(node.key);
        }
        this.visitExpression(node.value);
    }
    visitUnaryExpression(node) {
        this.visitExpression(node.argument);
    }
    visitBinaryLikeExpression(node) {
        this.visitExpression(node.left);
        this.visitExpression(node.right);
    }
    visitConditionalExpression(node) {
        this.visitExpression(node.test);
        this.visitExpression(node.consequent);
        this.visitExpression(node.alternate);
    }
    visitMemberExpression(node) {
        this.visitExpression(node.object);
        if (node.computed) {
            this.visitExpression(node.property);
        }
    }
    visitAssignmentExpression(node) {
        this.visitAssignmentTarget(node.left);
        this.visitExpression(node.right);
        if (node.left.type === "Identifier" && node.operator === "=") {
            this.setBinding(node.left.name, isImmutableArrayOrigin(node.right, (name) => this.lookup(name), (name) => this.isBound(name)));
        }
    }
    visitCallExpression(node) {
        if (isMutatingFrozenCall(node, (name) => this.lookup(name), (name) => this.isBound(name))) {
            const methodName = getCalledMethodName(node);
            this.report(node.span, methodName ?? "method");
        }
        this.visitExpression(node.callee);
        for (const argument of node.arguments) {
            if (argument.type === "SpreadElement") {
                this.visitExpression(argument.argument);
                continue;
            }
            this.visitExpression(argument);
        }
    }
    visitTemplateLiteral(node) {
        for (const expression of node.expressions) {
            this.visitExpression(expression);
        }
    }
    visitTaggedTemplateExpression(node) {
        this.visitExpression(node.tag);
        this.visitTemplateLiteral(node.quasi);
    }
    visitAssignmentTarget(node) {
        switch (node.type) {
            case "Identifier":
            case "MetaProperty":
                return;
            case "MemberExpression":
                this.visitMemberExpression(node);
                return;
            case "ArrayPattern":
            case "ObjectPattern":
                this.visitBindingPattern(node);
                return;
        }
    }
    visitBindingPattern(node) {
        switch (node.type) {
            case "Identifier":
                return;
            case "ArrayPattern":
                for (const element of node.elements) {
                    if (element === null) {
                        continue;
                    }
                    this.visitBindingElement(element);
                }
                return;
            case "ObjectPattern":
                for (const property of node.properties) {
                    if (property.type === "RestElement") {
                        this.visitBindingElement(property);
                        continue;
                    }
                    this.visitAssignmentProperty(property);
                }
                return;
        }
    }
    visitAssignmentProperty(node) {
        if (node.computed) {
            this.visitExpression(node.key);
        }
        this.visitBindingElement(node.value);
    }
    visitBindingElement(node) {
        switch (node.type) {
            case "AssignmentPattern":
                this.visitAssignmentTarget(node.left);
                this.visitExpression(node.right);
                return;
            case "RestElement":
                this.visitAssignmentTarget(node.argument);
                return;
            case "ArrayPattern":
            case "ObjectPattern":
            case "Identifier":
                this.visitBindingPattern(node);
                return;
            case "MemberExpression":
                this.visitMemberExpression(node);
                return;
        }
    }
    collectStatementBindings(statements) {
        return statements.flatMap((statement) => {
            if (statement.type === "VariableDeclaration") {
                return this.collectDeclarationBindings(statement);
            }
            if (statement.type === "ExportNamedDeclaration") {
                return this.collectDeclarationBindings(statement.declaration);
            }
            if (statement.type === "ImportDeclaration") {
                return statement.specifiers.map((specifier) => [
                    specifier.local.name,
                    "unknown"
                ]);
            }
            return [];
        });
    }
    collectDeclarationBindings(node) {
        return node.declarations.flatMap((declarator) => this.createUnknownBindings(this.collectPatternBindings(declarator.id)));
    }
    collectArrowFunctionBindings(node) {
        return node.params.flatMap((param) => this.createUnknownBindings(this.collectBindingElementNames(param)));
    }
    createUnknownBindings(names) {
        return names.map((name) => [name, "unknown"]);
    }
    collectPatternBindings(node) {
        switch (node.type) {
            case "Identifier":
                return [node.name];
            case "ArrayPattern":
                return node.elements.flatMap((element) => element === null ? [] : this.collectBindingElementNames(element));
            case "ObjectPattern":
                return node.properties.flatMap((property) => property.type === "RestElement"
                    ? this.collectBindingElementNames(property)
                    : this.collectBindingElementNames(property.value));
        }
    }
    collectBindingElementNames(node) {
        switch (node.type) {
            case "Identifier":
                return [node.name];
            case "AssignmentPattern":
                return this.collectBindingElementNames(node.left);
            case "RestElement":
                return this.collectBindingElementNames(node.argument);
            case "ArrayPattern":
            case "ObjectPattern":
                return this.collectPatternBindings(node);
            case "MemberExpression":
                return [];
        }
    }
    withScope(bindings, callback) {
        this.scopes.push(new Map(bindings));
        try {
            callback();
        }
        finally {
            this.scopes.pop();
        }
    }
    lookup(name) {
        for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
            const binding = this.scopes[index].get(name);
            if (binding !== undefined) {
                return binding;
            }
        }
        return "unknown";
    }
    isBound(name) {
        return this.scopes.some((scope) => scope.has(name));
    }
    setBinding(name, state) {
        for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
            const scope = this.scopes[index];
            if (scope.has(name)) {
                scope.set(name, state);
                return;
            }
        }
    }
    report(span, methodName) {
        this.diagnostics.push({
            code: "AS-MUTATING-FROZEN",
            severity: "warning",
            message: `Mutating array method '${methodName}' cannot be called on an immutable array.`,
            filename: this.filename,
            line: span.start.line,
            column: span.start.column,
            span
        });
    }
}
function isMutatingFrozenCall(node, lookup, isBound) {
    const methodName = getCalledMethodName(node);
    return (methodName !== undefined &&
        MUTATING_ARRAY_METHODS.has(methodName) &&
        node.callee.type === "MemberExpression" &&
        isImmutableArrayOrigin(node.callee.object, lookup, isBound) === "frozen");
}
function getCalledMethodName(node) {
    if (node.callee.type !== "MemberExpression") {
        return undefined;
    }
    if (!node.callee.computed) {
        return node.callee.property.type === "Identifier" ? node.callee.property.name : undefined;
    }
    return node.callee.property.type === "StringLiteral" ? node.callee.property.value : undefined;
}
function isImmutableArrayOrigin(node, lookup, isBound) {
    if (node === undefined) {
        return "unknown";
    }
    if (node.type === "Identifier") {
        return lookup(node.name);
    }
    return isImmutableArrayFactoryCall(node, isBound) ? "frozen" : "unknown";
}
function isImmutableArrayFactoryCall(node, isBound) {
    if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") {
        return false;
    }
    if (node.callee.computed) {
        return false;
    }
    const objectName = node.callee.object.type === "Identifier" ? node.callee.object.name : undefined;
    const propertyName = node.callee.property.type === "Identifier" ? node.callee.property.name : undefined;
    return ((objectName === "Object" && propertyName === "freeze" && !isBound(objectName)) ||
        (objectName === "Array" && propertyName === "of" && !isBound(objectName)));
}
