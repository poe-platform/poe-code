import { parseModule } from "../../parse/parser.js";
const MESSAGE = "Unbounded loop or generator source has no static exit with break, return, or throw.";
export function AS_UNBOUNDED_LOOP(source, options = {}) {
    return new ASUnboundedLoopScanner(options.filename ?? "<input>").scan(source);
}
class ASUnboundedLoopScanner {
    filename;
    diagnostics = [];
    labelStack = [];
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
                this.visitWhileStatement(node);
                return;
            case "DoWhileStatement":
                this.visitDoWhileStatement(node);
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
        this.visitLoopBody(node, () => {
            this.reportIfUnboundedWithoutExit(node);
            this.visitStatement(node.body);
        });
    }
    visitForOfStatement(node) {
        if (node.left.type === "VariableDeclaration") {
            this.visitVariableDeclaration(node.left);
        }
        this.visitExpression(node.right);
        this.visitLoopBody(node, () => {
            this.visitStatement(node.body);
        });
    }
    visitWhileStatement(node) {
        this.visitExpression(node.test);
        this.visitLoopBody(node, () => {
            this.reportIfUnboundedWithoutExit(node);
            this.visitStatement(node.body);
        });
    }
    visitDoWhileStatement(node) {
        this.visitExpression(node.test);
        this.visitLoopBody(node, () => {
            this.reportIfUnboundedWithoutExit(node);
            this.visitStatement(node.body);
        });
    }
    visitLoopBody(node, callback) {
        const labels = getLoopLabels(node);
        this.labelStack.push(...labels);
        callback();
        this.labelStack.length -= labels.length;
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
        this.visitBlockStatement(node.body);
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
            case "TemplateLiteral":
                this.visitTemplateLiteral(node);
                return;
            case "TaggedTemplateExpression":
                this.visitTaggedTemplateExpression(node);
                return;
            case "Identifier":
            case "BooleanLiteral":
            case "NullLiteral":
            case "NumericLiteral":
            case "StringLiteral":
            case "RegexLiteral":
            case "MetaProperty":
            case "UndefinedLiteral":
                return;
        }
    }
    visitArrowFunction(node) {
        const labels = this.labelStack.splice(0);
        try {
            if (node.body.type === "BlockStatement") {
                this.visitBlockStatement(node.body);
                return;
            }
            this.visitExpression(node.body);
        }
        finally {
            this.labelStack.push(...labels);
        }
    }
    visitArrayExpression(node) {
        for (const element of node.elements) {
            if (element.type === "SpreadElement") {
                this.visitExpression(element.argument);
            }
            else {
                this.visitExpression(element);
            }
        }
    }
    visitObjectExpression(node) {
        for (const property of node.properties) {
            if (property.type === "SpreadElement") {
                this.visitExpression(property.argument);
            }
            else {
                this.visitProperty(property);
            }
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
        this.visitExpression(node.right);
    }
    visitCallExpression(node) {
        this.visitExpression(node.callee);
        for (const argument of node.arguments) {
            if (argument.type === "SpreadElement") {
                this.visitExpression(argument.argument);
            }
            else {
                this.visitExpression(argument);
            }
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
    reportIfUnboundedWithoutExit(node) {
        if (!isUnboundedLoop(node)) {
            return;
        }
        const exitingLabels = new Set([...this.labelStack, ...getLoopLabels(node)]);
        if (bodyHasExit(node.body, exitingLabels, true)) {
            return;
        }
        this.diagnostics.push({
            code: "AS-UNBOUNDED-LOOP",
            severity: "warning",
            message: MESSAGE,
            filename: this.filename,
            line: node.span.start.line,
            column: node.span.start.column,
            span: node.span
        });
    }
}
function isUnboundedLoop(node) {
    switch (node.type) {
        case "ForStatement":
            return node.test === undefined;
        case "WhileStatement":
        case "DoWhileStatement":
            return isTrueLiteral(node.test);
    }
}
function getLoopLabels(node) {
    return node.labels ?? (node.label === undefined ? [] : [node.label]);
}
function isTrueLiteral(node) {
    return node.type === "BooleanLiteral" && node.value;
}
function bodyHasExit(node, exitingLabels, allowUnlabeledBreak) {
    switch (node.type) {
        case "BlockStatement":
            return node.body.some((statement) => bodyHasExit(statement, exitingLabels, allowUnlabeledBreak));
        case "IfStatement":
            return (bodyHasExit(node.consequent, exitingLabels, allowUnlabeledBreak) ||
                (node.alternate !== undefined &&
                    bodyHasExit(node.alternate, exitingLabels, allowUnlabeledBreak)));
        case "ForStatement":
        case "ForInStatement":
        case "ForOfStatement":
        case "WhileStatement":
        case "DoWhileStatement":
            return bodyHasExit(node.body, exitingLabels, false);
        case "TryStatement":
            return (bodyHasExit(node.block, exitingLabels, allowUnlabeledBreak) ||
                (node.handler !== undefined &&
                    bodyHasExit(node.handler.body, exitingLabels, allowUnlabeledBreak)) ||
                (node.finalizer !== undefined &&
                    bodyHasExit(node.finalizer, exitingLabels, allowUnlabeledBreak)));
        case "SwitchStatement":
            return node.cases.some((switchCase) => switchCase.consequent.some((statement) => bodyHasExit(statement, exitingLabels, false)));
        case "ReturnStatement":
        case "ThrowStatement":
            return true;
        case "BreakStatement":
            return node.label === undefined ? allowUnlabeledBreak : exitingLabels.has(node.label);
        case "ExportNamedDeclaration":
            return false;
        case "ExportDefaultDeclaration":
        case "ExpressionStatement":
        case "ImportDeclaration":
        case "FunctionDeclaration":
        case "ContinueStatement":
        case "EmptyStatement":
        case "VariableDeclaration":
            return false;
    }
}
