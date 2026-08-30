import { parseModule } from "../../parse/parser.js";
const MESSAGE = "Await is only allowed at the script top level or inside async arrow functions.";
export function AS008(source, options = {}) {
    return new AS008Scanner(options.filename ?? "<input>").scan(source);
}
class AS008Scanner {
    filename;
    diagnostics = [];
    functionStack = [];
    scopeDepth = 0;
    constructor(filename) {
        this.filename = filename;
    }
    scan(source) {
        const module = parseModule(source, this.filename);
        this.visitModule(module);
        return this.diagnostics;
    }
    visitModule(node) {
        for (const statement of node.body) {
            this.visitStatement(statement);
        }
    }
    visitStatement(node) {
        switch (node.type) {
            case "FunctionDeclaration":
                this.visitArrowFunction(node);
                return;
            case "BlockStatement":
                this.withNestedScope(() => {
                    this.visitBlock(node);
                });
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
                if (node.argument !== undefined) {
                    this.visitExpression(node.argument);
                }
                return;
            case "ThrowStatement":
                this.visitThrowStatement(node);
                return;
            case "ImportDeclaration":
            case "BreakStatement":
            case "ContinueStatement":
                return;
        }
    }
    visitBlock(node) {
        for (const statement of node.body) {
            this.visitStatement(statement);
        }
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
        this.withNestedScope(() => {
            if (node.param !== undefined) {
                this.visitBindingPattern(node.param);
            }
            this.visitBlock(node.body);
        });
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
        this.visitBindingPattern(node.id);
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
                this.visitAwaitExpression(node);
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
                this.visitBinaryExpression(node);
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
        this.functionStack.push(node.async);
        for (const parameter of node.params) {
            this.visitBindingElement(parameter);
        }
        const body = node.body;
        if (body.type === "BlockStatement") {
            this.withNestedScope(() => {
                this.visitBlock(body);
            });
        }
        else {
            this.visitExpression(body);
        }
        this.functionStack.pop();
    }
    visitAwaitExpression(node) {
        if (!this.isAwaitAllowed()) {
            this.diagnostics.push({
                code: "AS008",
                severity: "error",
                message: MESSAGE,
                filename: this.filename,
                line: node.span.start.line,
                column: node.span.start.column,
                span: node.span
            });
        }
        this.visitExpression(node.argument);
    }
    visitArrayExpression(node) {
        for (const element of node.elements) {
            if (element?.type === "SpreadElement") {
                this.visitSpreadElement(element);
                continue;
            }
            if (element !== undefined) {
                this.visitExpression(element);
            }
        }
    }
    visitObjectExpression(node) {
        for (const property of node.properties) {
            if (property.type === "SpreadElement") {
                this.visitSpreadElement(property);
                continue;
            }
            this.visitProperty(property);
        }
    }
    visitUnaryExpression(node) {
        this.visitExpression(node.argument);
    }
    visitBinaryExpression(node) {
        this.visitExpression(node.left);
        this.visitExpression(node.right);
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
        if (node.computed) {
            this.visitExpression(node.property);
        }
    }
    visitAssignmentExpression(node) {
        this.visitAssignmentTarget(node.left);
        this.visitExpression(node.right);
    }
    visitCallExpression(node) {
        this.visitExpression(node.callee);
        for (const argument of node.arguments) {
            if (argument.type === "SpreadElement") {
                this.visitSpreadElement(argument);
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
    visitProperty(node) {
        if (node.computed) {
            this.visitExpression(node.key);
        }
        this.visitExpression(node.value);
    }
    visitSpreadElement(node) {
        this.visitExpression(node.argument);
    }
    visitAssignmentTarget(node) {
        if (node.type === "Identifier") {
            return;
        }
        if (node.type === "MetaProperty") {
            return;
        }
        if (node.type === "MemberExpression") {
            this.visitMemberExpression(node);
            return;
        }
        this.visitBindingPattern(node);
    }
    visitBindingElement(node) {
        if (node.type === "RestElement") {
            this.visitRestElement(node);
            return;
        }
        this.visitBindingPattern(node);
    }
    visitBindingPattern(node) {
        switch (node.type) {
            case "Identifier":
                return;
            case "MemberExpression":
                this.visitMemberExpression(node);
                return;
            case "AssignmentPattern":
                this.visitAssignmentPattern(node);
                return;
            case "ArrayPattern":
                this.visitArrayPattern(node);
                return;
            case "ObjectPattern":
                this.visitObjectPattern(node);
                return;
        }
    }
    visitAssignmentPattern(node) {
        this.visitBindingPattern(node.left);
        this.visitExpression(node.right);
    }
    visitArrayPattern(node) {
        for (const element of node.elements) {
            if (element === null) {
                continue;
            }
            if (element.type === "RestElement") {
                this.visitRestElement(element);
                continue;
            }
            this.visitBindingPattern(element);
        }
    }
    visitObjectPattern(node) {
        for (const property of node.properties) {
            if (property.type === "RestElement") {
                this.visitRestElement(property);
                continue;
            }
            this.visitAssignmentProperty(property);
        }
    }
    visitAssignmentProperty(node) {
        if (node.computed) {
            this.visitExpression(node.key);
        }
        this.visitBindingPattern(node.value);
    }
    visitRestElement(node) {
        this.visitAssignmentTarget(node.argument);
    }
    isAwaitAllowed() {
        const currentFunction = this.functionStack.at(-1);
        if (currentFunction !== undefined) {
            return true;
        }
        return this.scopeDepth === 0;
    }
    withNestedScope(callback) {
        this.scopeDepth += 1;
        try {
            callback();
        }
        finally {
            this.scopeDepth -= 1;
        }
    }
}
