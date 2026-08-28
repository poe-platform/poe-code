import { parseModule } from "../../parse/parser.js";
export function AS015(source, options = {}) {
    return new AS015Scanner(options.filename ?? "<input>").scan(source);
}
class AS015Scanner {
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
        if (node.param !== undefined) {
            this.visitPattern(node.param);
        }
        this.visitStatement(node.body);
    }
    visitVariableDeclaration(node) {
        for (const declarator of node.declarations) {
            this.visitVariableDeclarator(declarator);
        }
    }
    visitVariableDeclarator(node) {
        this.visitPattern(node.id);
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
            this.visitPattern(parameter);
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
        this.visitExpression(node.key);
        this.visitExpression(node.value);
    }
    visitUnaryExpression(node) {
        this.visitExpression(node.argument);
    }
    visitBinaryLikeExpression(node) {
        if ("left" in node) {
            this.visitExpression(node.left);
            this.visitExpression(node.right);
            return;
        }
        this.visitExpression(node.test);
        this.visitExpression(node.consequent);
        this.visitExpression(node.alternate);
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
        this.visitExpression(node.right);
    }
    visitCallExpression(node) {
        if (isSingleElementPromiseRace(node)) {
            this.diagnostics.push({
                code: "AS015",
                severity: "warning",
                message: "Promise.race() with a single-element iterable literal is unnecessary. Use 'await' instead.",
                filename: this.filename,
                line: node.span.start.line,
                column: node.span.start.column,
                span: node.span
            });
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
    visitPattern(node) {
        switch (node.type) {
            case "AssignmentPattern":
                this.visitPattern(node.left);
                this.visitExpression(node.right);
                return;
            case "RestElement":
                this.visitPattern(node.argument);
                return;
            case "ArrayPattern":
                for (const element of node.elements) {
                    if (element !== null) {
                        this.visitPattern(element);
                    }
                }
                return;
            case "ObjectPattern":
                for (const property of node.properties) {
                    this.visitPattern(property.type === "RestElement" ? property : property.value);
                }
                return;
            case "MemberExpression":
                this.visitMemberExpression(node);
                return;
            case "Identifier":
                return;
        }
    }
}
function isSingleElementPromiseRace(node) {
    if (!isPromiseRace(node.callee) || node.arguments.length !== 1) {
        return false;
    }
    const iterable = node.arguments[0];
    if (iterable.type !== "ArrayExpression" || iterable.elements.length !== 1) {
        return false;
    }
    return iterable.elements[0].type !== "SpreadElement";
}
function isPromiseRace(node) {
    return (node.type === "MemberExpression" &&
        node.object.type === "Identifier" &&
        node.object.name === "Promise" &&
        ((node.computed && node.property.type === "StringLiteral" && node.property.value === "race") ||
            (!node.computed && node.property.type === "Identifier" && node.property.name === "race")));
}
