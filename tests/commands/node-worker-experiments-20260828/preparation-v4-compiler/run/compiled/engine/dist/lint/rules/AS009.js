import { parseModule } from "../../parse/parser.js";
const MESSAGE = "Async arrow returns a host call without awaiting it. Add 'await' or document that this function intentionally returns a Promise.";
export function AS009(source, options = {}) {
    return new AS009Scanner(options.filename ?? "<input>").scan(source);
}
class AS009Scanner {
    filename;
    diagnostics = [];
    scopes = [];
    functionStack = [];
    constructor(filename) {
        this.filename = filename;
    }
    scan(source) {
        const module = parseModule(source, this.filename);
        this.pushScope(this.collectModuleBindings(module));
        this.visitModule(module);
        this.popScope();
        return this.diagnostics;
    }
    visitModule(node) {
        this.visitStatements(node.body);
    }
    visitStatements(body) {
        for (const statement of body) {
            this.visitStatement(statement);
        }
    }
    visitStatement(node) {
        switch (node.type) {
            case "FunctionDeclaration":
                this.visitArrowFunction(node);
                return;
            case "BlockStatement":
                this.visitBlockStatement(node.body);
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
    visitBlockStatement(body) {
        this.withScope(this.collectBlockBindings(body), () => {
            this.visitStatements(body);
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
    }
    visitForOfStatement(node) {
        if (node.left.type === "VariableDeclaration") {
            this.visitVariableDeclaration(node.left);
        }
        else {
            this.visitAssignmentTarget(node.left);
        }
        this.visitExpression(node.right);
        this.visitStatement(node.body);
    }
    visitWhileStatement(node) {
        this.visitExpression(node.test);
        this.visitStatement(node.body);
    }
    visitTryStatement(node) {
        this.visitStatement(node.block);
        if (node.handler !== undefined) {
            this.visitCatchClause(node.handler);
        }
        if (node.finalizer !== undefined) {
            this.visitStatement(node.finalizer);
        }
    }
    visitCatchClause(node) {
        const scope = new Map();
        if (node.param !== undefined) {
            this.collectBindingNamesFromPattern(node.param, scope);
        }
        this.withScope(scope, () => {
            this.visitBlockStatement(node.body.body);
        });
    }
    visitReturnStatement(node) {
        if (node.argument !== undefined) {
            if (this.isInsideAsyncArrow()) {
                this.reportMissingAwait(node.argument);
            }
            this.visitExpression(node.argument);
        }
    }
    visitThrowStatement(node) {
        this.visitExpression(node.argument);
    }
    visitVariableDeclaration(node) {
        for (const declarator of node.declarations) {
            this.visitVariableDeclarator(declarator);
        }
    }
    visitVariableDeclarator(node) {
        this.visitBindingElement(node.id);
        if (node.init !== undefined) {
            this.visitExpression(node.init);
        }
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
                this.visitExpression(node.left);
                this.visitExpression(node.right);
                return;
            case "LogicalExpression":
                this.visitLogicalExpression(node);
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
            case "Identifier":
            case "BooleanLiteral":
            case "NullLiteral":
            case "NumericLiteral":
            case "StringLiteral":
            case "UndefinedLiteral":
                return;
        }
    }
    visitArrowFunction(node) {
        const scope = new Map();
        for (const parameter of node.params) {
            this.collectBindingNamesFromElement(parameter, scope);
        }
        if (node.body.type === "BlockStatement") {
            this.mergeScope(scope, this.collectBlockBindings(node.body.body));
        }
        this.functionStack.push(node.async);
        this.pushScope(scope);
        if (node.async && node.body.type !== "BlockStatement") {
            this.reportMissingAwait(node.body);
        }
        if (node.body.type === "BlockStatement") {
            this.visitStatements(node.body.body);
        }
        else {
            this.visitExpression(node.body);
        }
        this.popScope();
        this.functionStack.pop();
    }
    visitArrayExpression(node) {
        for (const element of node.elements) {
            if (element !== null) {
                if (element.type === "SpreadElement") {
                    this.visitExpression(element.argument);
                }
                else {
                    this.visitExpression(element);
                }
            }
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
    visitLogicalExpression(node) {
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
        this.visitExpression(node.property);
    }
    visitAssignmentExpression(node) {
        this.visitAssignmentTarget(node.left);
        this.visitExpression(node.right);
    }
    visitCallExpression(node) {
        this.visitExpression(node.callee);
        for (const arg of node.arguments) {
            if (arg.type === "SpreadElement") {
                this.visitExpression(arg.argument);
            }
            else {
                this.visitExpression(arg);
            }
        }
    }
    visitTemplateLiteral(node) {
        for (const expression of node.expressions) {
            this.visitExpression(expression);
        }
    }
    visitAssignmentTarget(node) {
        switch (node.type) {
            case "Identifier":
            case "MetaProperty":
                return;
            case "MemberExpression":
                this.visitMemberExpression(node);
                return;
            case "AssignmentPattern":
                this.visitAssignmentTarget(node.left);
                this.visitExpression(node.right);
                return;
            case "RestElement":
                this.visitAssignmentTarget(node.argument);
                return;
            case "ArrayPattern":
                for (const element of node.elements) {
                    if (element !== null) {
                        this.visitAssignmentTarget(element);
                    }
                }
                return;
            case "ObjectPattern":
                for (const property of node.properties) {
                    if (property.type === "RestElement") {
                        this.visitAssignmentTarget(property.argument);
                        continue;
                    }
                    if (property.computed) {
                        this.visitExpression(property.key);
                    }
                    this.visitAssignmentTarget(property.value);
                }
                return;
        }
    }
    visitBindingElement(node) {
        switch (node.type) {
            case "AssignmentPattern":
                this.visitBindingElement(node.left);
                this.visitExpression(node.right);
                return;
            case "RestElement":
                this.visitBindingElement(node.argument);
                return;
            default:
                this.visitAssignmentTarget(node);
                return;
        }
    }
    reportMissingAwait(node) {
        if (node.type !== "CallExpression") {
            return;
        }
        if (!this.isHostCall(node)) {
            return;
        }
        this.diagnostics.push({
            code: "AS009",
            severity: "error",
            message: MESSAGE,
            filename: this.filename,
            line: node.span.start.line,
            column: node.span.start.column,
            span: node.span
        });
    }
    isHostCall(node) {
        const root = this.findRootIdentifier(node.callee);
        if (root === undefined) {
            return false;
        }
        const binding = this.resolveBinding(root.name);
        return binding === "import" || binding === "namespace";
    }
    findRootIdentifier(node) {
        switch (node.type) {
            case "Identifier":
                return node;
            case "MemberExpression":
                return this.findRootIdentifier(node.object);
            default:
                return undefined;
        }
    }
    isInsideAsyncArrow() {
        return this.functionStack[this.functionStack.length - 1] === true;
    }
    resolveBinding(name) {
        for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
            const binding = this.scopes[index].get(name);
            if (binding !== undefined) {
                return binding;
            }
        }
        return undefined;
    }
    collectModuleBindings(node) {
        const scope = new Map();
        for (const statement of node.body) {
            if (statement.type === "ImportDeclaration") {
                this.mergeScope(scope, this.collectImportBindings(statement));
            }
        }
        return scope;
    }
    collectBlockBindings(body) {
        const scope = new Map();
        for (const statement of body) {
            if (statement.type === "VariableDeclaration") {
                for (const declarator of statement.declarations) {
                    this.collectBindingNamesFromPattern(declarator.id, scope);
                }
            }
        }
        return scope;
    }
    collectImportBindings(node) {
        const scope = new Map();
        for (const specifier of node.specifiers) {
            scope.set(specifier.local.name, this.getImportBindingKind(specifier));
        }
        return scope;
    }
    getImportBindingKind(specifier) {
        return specifier.type === "ImportNamespaceSpecifier" ? "namespace" : "import";
    }
    collectBindingNamesFromElement(node, scope) {
        switch (node.type) {
            case "AssignmentPattern":
                this.collectBindingNamesFromPattern(node.left, scope);
                return;
            case "RestElement":
                this.collectBindingNamesFromPattern(node.argument, scope);
                return;
            default:
                this.collectBindingNamesFromPattern(node, scope);
                return;
        }
    }
    collectBindingNamesFromPattern(node, scope) {
        switch (node.type) {
            case "Identifier":
                scope.set(node.name, "local");
                return;
            case "MemberExpression":
                return;
            case "ArrayPattern":
                for (const element of node.elements) {
                    if (element !== null) {
                        this.collectBindingNamesFromElement(element, scope);
                    }
                }
                return;
            case "ObjectPattern":
                for (const property of node.properties) {
                    if (property.type === "RestElement") {
                        this.collectBindingNamesFromPattern(property.argument, scope);
                        continue;
                    }
                    this.collectBindingNamesFromElement(property.value, scope);
                }
                return;
        }
    }
    withScope(scope, callback) {
        this.pushScope(scope);
        try {
            callback();
        }
        finally {
            this.popScope();
        }
    }
    pushScope(scope) {
        this.scopes.push(scope);
    }
    popScope() {
        this.scopes.pop();
    }
    mergeScope(target, source) {
        for (const [name, binding] of source) {
            target.set(name, binding);
        }
    }
}
