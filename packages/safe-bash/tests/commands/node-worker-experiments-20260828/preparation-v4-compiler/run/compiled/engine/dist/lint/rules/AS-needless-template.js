import { parseModule } from "../../parse/parser.js";
export const AS_NEEDLESS_TEMPLATE_MESSAGE = "Template literals with only one interpolation should use the value or String(value).";
export function AS_NEEDLESS_TEMPLATE(source, options = {}) {
    return new ASNeedlessTemplateScanner(source, options.filename ?? "<input>").scan();
}
export function fixASNeedlessTemplate(source, options = {}) {
    const filename = options.filename ?? "<input>";
    let result = source;
    while (true) {
        const diagnostics = new ASNeedlessTemplateScanner(result, filename).collect();
        if (diagnostics.length === 0) {
            return result;
        }
        const next = selectInnermostDiagnostics(diagnostics)
            .sort((left, right) => right.span.start.offset - left.span.start.offset)
            .reduce((current, diagnostic) => {
            return `${current.slice(0, diagnostic.span.start.offset)}${createReplacement(current, diagnostic)}${current.slice(diagnostic.span.end.offset)}`;
        }, result);
        if (next === result) {
            return result;
        }
        result = next;
    }
}
class ASNeedlessTemplateScanner {
    source;
    filename;
    diagnostics = [];
    constructor(source, filename) {
        this.source = source;
        this.filename = filename;
    }
    scan() {
        this.visitModule(parseModule(this.source, this.filename));
        return this.diagnostics.map(({ expression: _expression, expressionSpan: _expressionSpan, ...diagnostic }) => diagnostic);
    }
    collect() {
        this.visitModule(parseModule(this.source, this.filename));
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
        this.visitBindingPattern(node.id);
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
                this.visitTemplateLiteral(node, true);
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
        for (const param of node.params) {
            this.visitBindingElement(param);
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
    visitTemplateLiteral(node, canReport) {
        if (canReport && isNeedlessTemplate(node)) {
            this.report(node, node.expressions[0]);
        }
        for (const expression of node.expressions) {
            this.visitExpression(expression);
        }
    }
    visitTaggedTemplateExpression(node) {
        this.visitExpression(node.tag);
        this.visitTemplateLiteral(node.quasi, false);
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
    visitBindingElement(node) {
        if (node.type === "RestElement") {
            this.visitAssignmentTarget(node.argument);
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
                this.visitBindingPattern(node.left);
                this.visitExpression(node.right);
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
                        this.visitAssignmentTarget(property.argument);
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
        this.visitBindingPattern(node.value);
    }
    report(template, expression) {
        this.diagnostics.push({
            code: "AS-NEEDLESS-TEMPLATE",
            severity: "info",
            message: AS_NEEDLESS_TEMPLATE_MESSAGE,
            hint: `Use ${createStringReplacement(this.source.slice(expression.span.start.offset, expression.span.end.offset), expression)}.`,
            filename: this.filename,
            line: template.span.start.line,
            column: template.span.start.column,
            span: template.span,
            fix: {
                range: [template.span.start.offset, template.span.end.offset],
                replacement: createStringReplacement(this.source.slice(expression.span.start.offset, expression.span.end.offset), expression)
            },
            expression,
            expressionSpan: expression.span
        });
    }
}
function selectInnermostDiagnostics(diagnostics) {
    return diagnostics.filter((candidate) => !diagnostics.some((other) => other !== candidate && containsSpan(candidate.span, other.span)));
}
function containsSpan(outer, inner) {
    return outer.start.offset <= inner.start.offset && inner.end.offset <= outer.end.offset;
}
function createReplacement(source, diagnostic) {
    return createStringReplacement(source.slice(diagnostic.expressionSpan.start.offset, diagnostic.expressionSpan.end.offset), diagnostic.expression);
}
function createStringReplacement(expressionSource, expression) {
    if (isStringCallExpression(expression)) {
        return expressionSource;
    }
    return `String(${expressionSource})`;
}
function isStringCallExpression(expression) {
    return (expression.type === "CallExpression" &&
        expression.callee.type === "Identifier" &&
        expression.callee.name === "String");
}
function isNeedlessTemplate(node) {
    if (node.expressions.length !== 1 || node.quasis.length !== 2) {
        return false;
    }
    return (node.expressions[0]?.type !== "TemplateLiteral" &&
        node.quasis.every((quasi) => quasi.value.raw === ""));
}
