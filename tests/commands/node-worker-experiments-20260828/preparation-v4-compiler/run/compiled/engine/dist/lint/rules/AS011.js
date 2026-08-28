import { parseModule } from "../../parse/parser.js";
const FORBIDDEN_PROPERTY_NAMES = new Set(["__proto__", "prototype", "constructor"]);
const MESSAGE = "Property access to '__proto__', 'prototype', and 'constructor' is not allowed.";
export function AS011(source, options = {}) {
    return new AS011Scanner(options.filename ?? "<input>").scan(source);
}
class AS011Scanner {
    filename;
    diagnostics = [];
    constructor(filename) {
        this.filename = filename;
    }
    scan(source) {
        this.visitModule(parseModule(source, this.filename));
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
                for (const statement of node.body) {
                    this.visitStatement(statement);
                }
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
                this.visitExpression(node.test);
                this.visitStatement(node.body);
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
        if (node.param !== undefined) {
            this.visitAssignmentTarget(node.param);
        }
        this.visitStatement(node.body);
    }
    visitVariableDeclaration(node) {
        for (const declarator of node.declarations) {
            this.visitVariableDeclarator(declarator);
        }
    }
    visitVariableDeclarator(node) {
        this.visitBindingTarget(node.id);
        if (node.init !== undefined) {
            this.visitExpression(node.init);
        }
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
        for (const parameter of node.params) {
            this.visitBindingTarget(parameter);
        }
        if (node.body.type === "BlockStatement") {
            for (const statement of node.body.body) {
                this.visitStatement(statement);
            }
            return;
        }
        this.visitExpression(node.body);
    }
    visitArrayExpression(node) {
        for (const element of node.elements) {
            if (element === null) {
                continue;
            }
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
        if (this.isForbiddenMemberProperty(node)) {
            this.report(node.property.span);
        }
        this.visitExpression(node.property);
    }
    visitAssignmentExpression(node) {
        this.visitAssignmentTarget(node.left);
        this.visitExpression(node.right);
    }
    visitCallExpression(node) {
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
    visitBindingTarget(node) {
        switch (node.type) {
            case "AssignmentPattern":
                this.visitBindingTarget(node.left);
                this.visitExpression(node.right);
                return;
            case "RestElement":
                this.visitBindingTarget(node.argument);
                return;
            default:
                this.visitAssignmentTarget(node);
                return;
        }
    }
    isForbiddenMemberProperty(node) {
        if (!node.computed) {
            return (node.property.type === "Identifier" && FORBIDDEN_PROPERTY_NAMES.has(node.property.name));
        }
        return (node.property.type === "StringLiteral" && FORBIDDEN_PROPERTY_NAMES.has(node.property.value));
    }
    report(span) {
        this.diagnostics.push({
            code: "AS011",
            severity: "error",
            message: MESSAGE,
            filename: this.filename,
            line: span.start.line,
            column: span.start.column,
            span
        });
    }
}
