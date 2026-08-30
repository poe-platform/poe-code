import { parseModule } from "../../parse/parser.js";
export function AS_UNREACHABLE(source, options = {}) {
    return new ASUnreachableScanner(options.filename ?? "<input>").scan(source);
}
class ASUnreachableScanner {
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
        this.visitStatements(node.body);
    }
    visitStatements(statements) {
        let terminated = false;
        for (const statement of statements) {
            if (terminated) {
                if (isEmptyBlockStatement(statement)) {
                    continue;
                }
                this.report(statement.span);
                return true;
            }
            terminated = this.visitStatement(statement);
        }
        return terminated;
    }
    visitStatement(node) {
        switch (node.type) {
            case "FunctionDeclaration":
                this.visitArrowFunction(node);
                return false;
            case "BlockStatement":
                return this.visitBlock(node);
            case "ExpressionStatement":
                this.visitExpression(node.expression);
                return false;
            case "IfStatement":
                return this.visitIfStatement(node);
            case "ForStatement":
                this.visitForStatement(node);
                return false;
            case "ForInStatement":
            case "ForOfStatement":
                this.visitForOfStatement(node);
                return false;
            case "WhileStatement":
            case "DoWhileStatement":
                this.visitWhileStatement(node);
                return false;
            case "TryStatement":
                return this.visitTryStatement(node);
            case "SwitchStatement":
                this.visitSwitchStatement(node);
                return false;
            case "VariableDeclaration":
                this.visitVariableDeclaration(node);
                return false;
            case "ReturnStatement":
                if (node.argument !== undefined) {
                    this.visitExpression(node.argument);
                }
                return true;
            case "ThrowStatement":
                this.visitThrowStatement(node);
                return true;
            case "BreakStatement":
            case "ContinueStatement":
                return true;
            case "ExportNamedDeclaration":
                this.visitVariableDeclaration(node.declaration);
                return false;
            case "ExportDefaultDeclaration":
                this.visitExpression(node.declaration);
                return false;
            case "ImportDeclaration":
            case "EmptyStatement":
                return false;
        }
    }
    visitBlock(node) {
        return this.visitStatements(node.body);
    }
    visitIfStatement(node) {
        this.visitExpression(node.test);
        const consequentTerminates = this.visitStatement(node.consequent);
        const alternateTerminates = node.alternate === undefined ? false : this.visitStatement(node.alternate);
        return node.alternate !== undefined && consequentTerminates && alternateTerminates;
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
        const tryTerminates = this.visitBlock(node.block);
        const catchTerminates = node.handler === undefined ? false : this.visitCatchClause(node.handler);
        const finallyTerminates = node.finalizer === undefined ? false : this.visitBlock(node.finalizer);
        if (finallyTerminates) {
            return true;
        }
        if (node.handler === undefined) {
            return tryTerminates;
        }
        return tryTerminates && catchTerminates;
    }
    visitSwitchStatement(node) {
        this.visitExpression(node.discriminant);
        for (const switchCase of node.cases) {
            if (switchCase.test !== undefined) {
                this.visitExpression(switchCase.test);
            }
            this.visitStatements(switchCase.consequent);
        }
    }
    visitCatchClause(node) {
        return this.visitBlock(node.body);
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
            case "TaggedTemplateExpression":
                this.visitTaggedTemplateExpression(node);
                return;
            case "TemplateLiteral":
                this.visitTemplateLiteral(node);
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
        if (node.body.type === "BlockStatement") {
            this.visitBlock(node.body);
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
        if (node.left.type === "MemberExpression") {
            this.visitMemberExpression(node.left);
        }
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
    visitTaggedTemplateExpression(node) {
        this.visitExpression(node.tag);
        this.visitTemplateLiteral(node.quasi);
    }
    visitTemplateLiteral(node) {
        for (const expression of node.expressions) {
            this.visitExpression(expression);
        }
    }
    report(span) {
        this.diagnostics.push({
            code: "AS-UNREACHABLE",
            severity: "warning",
            message: "Statement is unreachable because a prior statement in the same block always exits.",
            filename: this.filename,
            line: span.start.line,
            column: span.start.column,
            span
        });
    }
}
function isEmptyBlockStatement(statement) {
    return statement.type === "BlockStatement" && statement.body.length === 0;
}
