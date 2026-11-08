import { parseModule } from "../../parse/parser.js";
const MESSAGE = "Destructuring default values only apply to undefined, not null.";
const HINT = "Handle null explicitly before destructuring or use ?? after binding.";
export function AS_DESTRUCTURE_NULL_DEFAULT(source, options = {}) {
    return new ASDestructureNullDefaultScanner(options.filename ?? "<input>").scan(source);
}
class ASDestructureNullDefaultScanner {
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
        this.visitStatement(node.body);
    }
    visitForOfStatement(node) {
        if (node.left.type === "VariableDeclaration") {
            this.visitVariableDeclaration(node.left);
        }
        else {
            this.visitBindingPattern(node.left);
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
            this.visitBindingPattern(node.param);
        }
        this.visitBlockStatement(node.body);
    }
    visitVariableDeclaration(node) {
        for (const declarator of node.declarations) {
            this.visitVariableDeclarator(declarator);
        }
    }
    visitVariableDeclarator(node) {
        if (node.init !== undefined) {
            this.matchPatternAgainstExpression(node.id, node.init);
            this.visitBindingPattern(node.id);
            this.visitExpression(node.init);
        }
        else {
            this.visitBindingPattern(node.id);
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
            case "ArrayExpression":
                this.visitArrayExpression(node);
                return;
            case "AwaitExpression":
                this.visitExpression(node.argument);
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
        for (const parameter of node.params) {
            if (parameter.type === "AssignmentPattern") {
                this.matchPatternAgainstExpression(parameter.left, parameter.right);
            }
            this.visitBindingElement(parameter);
        }
        if (node.body.type === "BlockStatement") {
            this.visitBlockStatement(node.body);
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
        this.matchPatternAgainstExpression(node.left, node.right);
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
    visitTaggedTemplateExpression(node) {
        this.visitExpression(node.tag);
        this.visitTemplateLiteral(node.quasi);
    }
    visitProperty(node) {
        if (node.computed) {
            this.visitExpression(node.key);
        }
        this.visitExpression(node.value);
    }
    visitBindingElement(node) {
        if (node.type === "RestElement") {
            this.visitBindingPattern(node.argument);
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
            this.visitBindingElement(element);
        }
    }
    visitObjectPattern(node) {
        for (const property of node.properties) {
            if (property.type === "RestElement") {
                this.visitBindingPattern(property.argument);
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
    visitAssignmentTarget(node) {
        if (node.type === "MetaProperty") {
            return;
        }
        this.visitBindingPattern(node);
    }
    matchPatternAgainstExpression(pattern, expression) {
        if (pattern.type === "ObjectPattern" && expression.type === "ObjectExpression") {
            this.matchObjectPattern(pattern, expression);
            return;
        }
        if (pattern.type === "ArrayPattern" && expression.type === "ArrayExpression") {
            this.matchArrayPattern(pattern, expression);
        }
    }
    matchObjectPattern(pattern, expression) {
        for (const property of pattern.properties) {
            if (property.type === "RestElement") {
                continue;
            }
            if (property.computed) {
                continue;
            }
            const key = getStaticPropertyKey(property.key);
            if (key === undefined) {
                continue;
            }
            const value = getKnownObjectProperty(expression, key);
            if (value === undefined || value === "missing") {
                continue;
            }
            this.matchPropertyValue(property.value, value);
        }
    }
    matchArrayPattern(pattern, expression) {
        for (const [index, element] of pattern.elements.entries()) {
            if (element === null) {
                continue;
            }
            const value = getKnownArrayElement(expression, index);
            if (value === undefined || value === "missing") {
                continue;
            }
            this.matchPropertyValue(element, value);
        }
    }
    matchPropertyValue(pattern, expression) {
        if (pattern.type === "RestElement") {
            return;
        }
        if (pattern.type === "AssignmentPattern") {
            if (expression.type === "NullLiteral") {
                this.report(pattern.span);
                return;
            }
            this.matchPatternAgainstExpression(pattern.left, expression);
            return;
        }
        this.matchPatternAgainstExpression(pattern, expression);
    }
    report(span) {
        this.diagnostics.push({
            code: "AS-DESTRUCTURE-NULL-DEFAULT",
            severity: "warning",
            message: MESSAGE,
            filename: this.filename,
            line: span.start.line,
            column: span.start.column,
            span,
            hint: HINT
        });
    }
}
function getKnownObjectProperty(expression, key) {
    for (let index = expression.properties.length - 1; index >= 0; index -= 1) {
        const property = expression.properties[index];
        if (property.type === "SpreadElement" || property.computed) {
            return undefined;
        }
        if (getStaticPropertyKey(property.key) === key) {
            return property.value;
        }
    }
    return "missing";
}
function getKnownArrayElement(expression, index) {
    for (let currentIndex = 0; currentIndex <= index; currentIndex += 1) {
        const element = expression.elements[currentIndex];
        if (element === undefined) {
            return "missing";
        }
        if (element.type === "SpreadElement") {
            return undefined;
        }
        if (currentIndex === index) {
            return element;
        }
    }
    return "missing";
}
function getStaticPropertyKey(key) {
    switch (key.type) {
        case "Identifier":
            return key.name;
        case "NumericLiteral":
            return String(key.value);
        case "StringLiteral":
            return key.value;
        default:
            return undefined;
    }
}
