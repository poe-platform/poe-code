import { parseModule } from "../../parse/parser.js";
export function AS_FRONTMATTER_FIELD_UNUSED(source, options = {}) {
    if (options.frontmatterFields === undefined) {
        return [];
    }
    return new ASFrontmatterFieldUnusedScanner(options.filename ?? "<input>", new Set(options.frontmatterFields)).scan(source);
}
class ASFrontmatterFieldUnusedScanner {
    filename;
    fields;
    reads = new Set();
    suppressDiagnostics = false;
    constructor(filename, fields) {
        this.filename = filename;
        this.fields = fields;
    }
    scan(source) {
        if (this.fields.size === 0) {
            return [];
        }
        const module = parseModule(source, this.filename);
        this.visitModule(module);
        if (this.suppressDiagnostics) {
            return [];
        }
        return [...this.fields]
            .filter((field) => !this.reads.has(field))
            .sort()
            .map((field) => this.createDiagnostic(module.span, field));
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
        if (node.init !== undefined && isFrontmatterIdentifier(node.init)) {
            this.collectObjectPatternReads(node.id);
        }
        else {
            this.visitBindingPattern(node.id);
            if (node.init !== undefined) {
                this.visitExpression(node.init);
            }
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
        for (const parameter of node.params) {
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
        if (isFrontmatterIdentifier(node.object)) {
            this.collectMemberRead(node);
        }
        else {
            this.visitExpression(node.object);
        }
        if (node.computed) {
            this.visitExpression(node.property);
        }
    }
    visitAssignmentExpression(node) {
        if (isFrontmatterIdentifier(node.right)) {
            this.collectObjectPatternReads(node.left);
            return;
        }
        this.visitAssignmentTarget(node.left);
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
            if (element !== null) {
                this.visitBindingElement(element);
            }
        }
    }
    visitObjectPattern(node) {
        for (const property of node.properties) {
            if (property.type === "RestElement") {
                this.visitBindingPattern(property.argument);
            }
            else {
                this.visitAssignmentProperty(property);
            }
        }
    }
    visitAssignmentProperty(node) {
        if (node.computed) {
            this.visitExpression(node.key);
        }
        this.visitBindingPattern(node.value);
    }
    visitAssignmentTarget(node) {
        if (node.type !== "MetaProperty") {
            this.visitBindingPattern(node);
        }
    }
    collectMemberRead(node) {
        if (!node.computed && node.property.type === "Identifier") {
            this.markRead(node.property.name);
            return;
        }
        if (node.computed && node.property.type === "StringLiteral") {
            this.markRead(node.property.value);
            return;
        }
        if (node.computed) {
            this.suppressDiagnostics = true;
        }
    }
    collectObjectPatternReads(node) {
        if (node.type !== "ObjectPattern") {
            if (node.type !== "MetaProperty") {
                this.visitBindingPattern(node);
            }
            return;
        }
        for (const property of node.properties) {
            if (property.type === "RestElement") {
                this.suppressDiagnostics = true;
                continue;
            }
            const field = readStaticPropertyKey(property);
            if (field === undefined) {
                this.suppressDiagnostics = true;
                continue;
            }
            this.markRead(field);
            this.visitBindingPattern(property.value);
        }
    }
    markRead(field) {
        if (this.fields.has(field)) {
            this.reads.add(field);
        }
    }
    createDiagnostic(span, field) {
        return {
            code: "AS-FRONTMATTER-FIELD-UNUSED",
            severity: "info",
            message: `Frontmatter field '${field}' is declared by the schema but never read.`,
            filename: this.filename,
            line: span.start.line,
            column: span.start.column,
            span
        };
    }
}
function isFrontmatterIdentifier(node) {
    return node.type === "Identifier" && node.name === "frontmatter";
}
function readStaticPropertyKey(property) {
    if (property.computed) {
        return property.key.type === "StringLiteral" ? property.key.value : undefined;
    }
    return readPropertyKey(property.key);
}
function readPropertyKey(node) {
    if (node.type === "Identifier") {
        return node.name;
    }
    if (node.type === "StringLiteral") {
        return node.value;
    }
    return undefined;
}
