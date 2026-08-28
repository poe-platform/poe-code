import { parseModule } from "../../parse/parser.js";
import { KNOWN_RUNTIME_GLOBALS } from "./known-globals.js";
export function AS_SHADOW_GLOBAL(source, options = {}) {
    return new ASShadowGlobalScanner(options.filename ?? "<input>", new Set([...KNOWN_RUNTIME_GLOBALS, ...(options.allowedGlobals ?? [])])).scan(source);
}
class ASShadowGlobalScanner {
    filename;
    knownGlobals;
    diagnostics = [];
    constructor(filename, knownGlobals) {
        this.filename = filename;
        this.knownGlobals = knownGlobals;
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
                this.visitArrowFunctionExpression(node);
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
            this.visitAssignmentTargetPattern(node.left);
        }
        this.visitExpression(node.right);
        this.visitStatement(node.body);
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
        if (node.param !== undefined) {
            this.visitPatternTarget(node.param);
        }
        this.visitBlockStatement(node.body);
    }
    visitReturnStatement(node) {
        if (node.argument !== undefined) {
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
        this.visitPatternTarget(node.id);
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
                this.visitArrowFunctionExpression(node);
                return;
            case "ArrayExpression":
                this.visitArrayExpression(node);
                return;
            case "AwaitExpression":
                this.visitAwaitExpression(node);
                return;
            case "BinaryExpression":
                this.visitBinaryExpression(node);
                return;
            case "CallExpression":
                this.visitCallExpression(node);
                return;
            case "ConditionalExpression":
                this.visitConditionalExpression(node);
                return;
            case "LogicalExpression":
                this.visitLogicalExpression(node);
                return;
            case "MemberExpression":
                this.visitMemberExpression(node);
                return;
            case "ObjectExpression":
                this.visitObjectExpression(node);
                return;
            case "TaggedTemplateExpression":
                this.visitTaggedTemplateExpression(node);
                return;
            case "TemplateLiteral":
                this.visitTemplateLiteral(node);
                return;
            case "UnaryExpression":
                this.visitUnaryExpression(node);
                return;
            case "AssignmentExpression":
                this.visitAssignmentExpression(node);
                return;
            case "BooleanLiteral":
            case "Identifier":
            case "MetaProperty":
            case "NullLiteral":
            case "NumericLiteral":
            case "RegexLiteral":
            case "StringLiteral":
            case "UndefinedLiteral":
                return;
        }
    }
    visitArrowFunctionExpression(node) {
        if (node.type !== "ArrowFunctionExpression" && node.id !== undefined) {
            this.reportIfGlobalShadow(node.id);
        }
        for (const parameter of node.params) {
            this.visitBindingElement(parameter);
        }
        if (node.body.type === "BlockStatement") {
            this.visitBlockStatement(node.body);
        }
        else {
            this.visitExpression(node.body);
        }
    }
    visitArrayExpression(node) {
        for (const element of node.elements) {
            if (element.type === "SpreadElement") {
                this.visitSpreadElement(element);
            }
            else {
                this.visitExpression(element);
            }
        }
    }
    visitAwaitExpression(node) {
        this.visitExpression(node.argument);
    }
    visitBinaryExpression(node) {
        this.visitExpression(node.left);
        this.visitExpression(node.right);
    }
    visitCallExpression(node) {
        this.visitExpression(node.callee);
        for (const argument of node.arguments) {
            if (argument.type === "SpreadElement") {
                this.visitSpreadElement(argument);
            }
            else {
                this.visitExpression(argument);
            }
        }
    }
    visitConditionalExpression(node) {
        this.visitExpression(node.test);
        this.visitExpression(node.consequent);
        this.visitExpression(node.alternate);
    }
    visitLogicalExpression(node) {
        this.visitExpression(node.left);
        this.visitExpression(node.right);
    }
    visitMemberExpression(node) {
        this.visitExpression(node.object);
        if (node.computed) {
            this.visitExpression(node.property);
        }
    }
    visitObjectExpression(node) {
        for (const property of node.properties) {
            if (property.type === "SpreadElement") {
                this.visitSpreadElement(property);
            }
            else {
                this.visitProperty(property);
            }
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
    visitUnaryExpression(node) {
        this.visitExpression(node.argument);
    }
    visitAssignmentExpression(node) {
        this.visitAssignmentTargetPattern(node.left);
        this.visitExpression(node.right);
    }
    visitAssignmentTargetPattern(node) {
        switch (node.type) {
            case "AssignmentPattern":
                this.visitAssignmentTargetPattern(node.left);
                this.visitExpression(node.right);
                return;
            case "RestElement":
                this.visitAssignmentTargetPattern(node.argument);
                return;
            case "ArrayPattern":
                this.visitAssignmentArrayPattern(node);
                return;
            case "ObjectPattern":
                this.visitAssignmentObjectPattern(node);
                return;
            case "MemberExpression":
                this.visitMemberExpression(node);
                return;
            case "Identifier":
            case "MetaProperty":
                return;
        }
    }
    visitAssignmentArrayPattern(node) {
        for (const element of node.elements) {
            if (element !== null) {
                this.visitAssignmentTargetPattern(element);
            }
        }
    }
    visitAssignmentObjectPattern(node) {
        for (const property of node.properties) {
            if (property.type === "RestElement") {
                this.visitAssignmentTargetPattern(property.argument);
                continue;
            }
            if (property.computed) {
                this.visitExpression(property.key);
            }
            this.visitAssignmentTargetPattern(property.value);
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
    visitBindingElement(node) {
        switch (node.type) {
            case "AssignmentPattern":
                this.visitPatternTarget(node.left);
                this.visitExpression(node.right);
                return;
            case "RestElement":
                this.visitPatternTarget(node.argument);
                return;
            default:
                this.visitPatternTarget(node);
                return;
        }
    }
    visitPatternTarget(node) {
        switch (node.type) {
            case "Identifier":
                this.reportIfGlobalShadow(node);
                return;
            case "MemberExpression":
                this.visitMemberExpression(node);
                return;
            case "ArrayPattern":
                this.visitArrayPattern(node);
                return;
            case "ObjectPattern":
                this.visitObjectPattern(node);
                return;
        }
    }
    visitArrayPattern(node) {
        for (const element of node.elements) {
            if (element !== null) {
                this.visitBindingElement(element);
            }
        }
    }
    visitObjectPattern(node) {
        for (const property of node.properties) {
            if (property.type === "RestElement") {
                this.visitPatternTarget(property.argument);
                continue;
            }
            this.visitAssignmentProperty(property);
        }
    }
    visitAssignmentProperty(node) {
        if (node.computed) {
            this.visitExpression(node.key);
        }
        this.visitBindingElement(node.value);
    }
    reportIfGlobalShadow(node) {
        if (!this.knownGlobals.has(node.name)) {
            return;
        }
        this.diagnostics.push({
            code: "AS-SHADOW-GLOBAL",
            severity: "warning",
            message: `Local binding '${node.name}' shadows a runtime global.`,
            filename: this.filename,
            line: node.span.start.line,
            column: node.span.start.column,
            span: node.span
        });
    }
}
