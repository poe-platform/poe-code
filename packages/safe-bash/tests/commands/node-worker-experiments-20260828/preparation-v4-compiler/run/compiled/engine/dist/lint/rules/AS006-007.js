import { parseModule } from "../../parse/parser.js";
export function AS006_007(source, options = {}) {
    return new AS006007Scanner(options.filename ?? "<input>").scan(source);
}
class AS006007Scanner {
    filename;
    diagnostics = [];
    ignoredReads = [];
    scopes = [];
    constructor(filename) {
        this.filename = filename;
    }
    scan(source) {
        const module = parseModule(source, this.filename);
        this.visitModule(module);
        return this.diagnostics.sort((left, right) => left.span.start.offset - right.span.start.offset ||
            left.span.end.offset - right.span.end.offset ||
            left.code.localeCompare(right.code));
    }
    visitModule(node) {
        this.withScope(this.collectModuleBindings(node.body), () => {
            for (const statement of node.body) {
                this.visitStatement(statement);
            }
        });
    }
    visitStatement(node) {
        switch (node.type) {
            case "FunctionDeclaration":
                this.visitArrowFunction(node);
                return;
            case "ExportNamedDeclaration":
                this.visitVariableDeclaration(node.declaration);
                return;
            case "ExportDefaultDeclaration":
                this.visitExpression(node.declaration);
                return;
            case "BlockStatement":
                this.visitBlock(node);
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
        this.withScope(this.collectBlockBindings(node.body), () => {
            for (const statement of node.body) {
                this.visitStatement(statement);
            }
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
        const bindings = node.init?.type === "VariableDeclaration" ? this.collectDeclarationBindings(node.init) : [];
        this.withScope(bindings, () => {
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
        });
    }
    visitForOfStatement(node) {
        const bindings = node.left.type === "VariableDeclaration" ? this.collectDeclarationBindings(node.left) : [];
        this.withScope(bindings, () => {
            if (node.left.type === "VariableDeclaration") {
                this.visitVariableDeclaration(node.left);
            }
            else {
                this.visitAssignmentTarget(node.left);
            }
            this.visitExpression(node.right);
            this.visitStatement(node.body);
        });
    }
    visitWhileStatement(node) {
        this.visitExpression(node.test);
        this.visitStatement(node.body);
    }
    visitTryStatement(node) {
        this.visitBlock(node.block);
        if (node.handler !== undefined) {
            this.visitCatchClause(node.handler);
        }
        if (node.finalizer !== undefined) {
            this.visitBlock(node.finalizer);
        }
    }
    visitCatchClause(node) {
        this.withScope(this.collectCatchBindings(node), () => {
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
        const init = node.init;
        if (init !== undefined) {
            this.withIgnoredReads(this.resolveBindings(this.collectPatternBindingNames(node.id)), () => {
                this.visitExpression(init);
            });
        }
    }
    visitExpression(node) {
        switch (node.type) {
            case "YieldExpression":
                if (node.argument !== undefined) {
                    this.visitExpression(node.argument);
                }
                return;
            case "Identifier":
                this.markRead(node);
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
            case "BooleanLiteral":
            case "NullLiteral":
            case "NumericLiteral":
            case "StringLiteral":
            case "UndefinedLiteral":
                return;
        }
    }
    visitArrowFunction(node) {
        this.withDeferredReads(() => {
            this.withScope(this.collectParameterBindings(node), () => {
                for (const parameter of node.params) {
                    this.visitBindingElement(parameter);
                }
                if (node.body.type === "BlockStatement") {
                    this.visitBlock(node.body);
                    return;
                }
                this.visitExpression(node.body);
            });
        });
    }
    visitAwaitExpression(node) {
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
    visitBindingElement(node) {
        switch (node.type) {
            case "AssignmentPattern":
                this.visitBindingPattern(node.left);
                this.withIgnoredReads(this.resolveBindings(this.collectPatternBindingNames(node.left)), () => {
                    this.visitExpression(node.right);
                });
                return;
            case "RestElement":
                this.visitBindingPattern(node.argument);
                return;
            default:
                this.visitBindingPattern(node);
                return;
        }
    }
    visitBindingPattern(node) {
        switch (node.type) {
            case "Identifier":
                return;
            case "MemberExpression":
                this.visitMemberExpression(node);
                return;
            case "ArrayPattern":
                for (const element of node.elements) {
                    if (element !== null) {
                        this.visitBindingElement(element);
                    }
                }
                return;
            case "ObjectPattern":
                for (const property of node.properties) {
                    if (property.type === "RestElement") {
                        this.visitBindingPattern(property.argument);
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
        this.visitBindingElement(node.value);
    }
    visitAssignmentTarget(node) {
        switch (node.type) {
            case "AssignmentPattern":
                this.visitAssignmentTarget(node.left);
                this.visitExpression(node.right);
                return;
            case "RestElement":
                this.visitAssignmentTarget(node.argument);
                return;
            case "Identifier":
                return;
            case "MemberExpression":
                this.visitMemberExpression(node);
                return;
            case "ArrayPattern":
                for (const element of node.elements) {
                    if (element === null) {
                        continue;
                    }
                    this.visitAssignmentTarget(element);
                }
                return;
            case "ObjectPattern":
                for (const property of node.properties) {
                    if (property.type === "RestElement") {
                        this.visitAssignmentTarget(property);
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
    withScope(bindings, visit) {
        const scope = new Map();
        for (const binding of bindings) {
            scope.set(binding.name, binding);
        }
        this.scopes.push(scope);
        visit();
        this.reportUnreadBindings(scope);
        this.scopes.pop();
    }
    reportUnreadBindings(scope) {
        for (const binding of scope.values()) {
            if (binding.code === undefined || binding.reads > 0 || binding.name.startsWith("_")) {
                continue;
            }
            this.diagnostics.push({
                code: binding.code,
                severity: "warning",
                message: binding.message,
                filename: this.filename,
                line: binding.span.start.line,
                column: binding.span.start.column,
                span: binding.span
            });
        }
    }
    markRead(node) {
        const binding = this.resolveBinding(node.name);
        if (binding !== undefined && !this.isIgnoredRead(binding)) {
            binding.reads += 1;
        }
    }
    isIgnoredRead(binding) {
        for (let index = this.ignoredReads.length - 1; index >= 0; index -= 1) {
            if (this.ignoredReads[index]?.has(binding)) {
                return true;
            }
        }
        return false;
    }
    resolveBinding(name) {
        for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
            const binding = this.scopes[index]?.get(name);
            if (binding !== undefined) {
                return binding;
            }
        }
        return undefined;
    }
    collectModuleBindings(body) {
        const bindings = [];
        for (const statement of body) {
            if (statement.type === "ImportDeclaration") {
                bindings.push(...this.collectImportBindings(statement));
                continue;
            }
            if (statement.type === "FunctionDeclaration") {
                bindings.push(this.createBinding(statement.id, "let"));
                continue;
            }
            if (statement.type === "VariableDeclaration") {
                bindings.push(...this.collectDeclarationBindings(statement));
                continue;
            }
            if (statement.type === "ExportNamedDeclaration") {
                bindings.push(...this.collectExportDeclarationBindings(statement.declaration));
            }
        }
        return bindings;
    }
    collectBlockBindings(body) {
        const bindings = [];
        for (const statement of body) {
            if (statement.type === "FunctionDeclaration") {
                bindings.push(this.createBinding(statement.id, "let"));
            }
            if (statement.type === "VariableDeclaration") {
                bindings.push(...this.collectDeclarationBindings(statement));
            }
        }
        return bindings;
    }
    collectParameterBindings(node) {
        const bindings = [];
        if (node.type === "FunctionExpression" && node.id !== undefined) {
            bindings.push(this.createBinding(node.id, "param"));
        }
        for (const parameter of node.params) {
            this.collectBindingNamesFromElement(parameter, "param", bindings);
        }
        return bindings;
    }
    collectDeclarationBindings(node) {
        const bindings = [];
        for (const declarator of node.declarations) {
            this.collectBindingNamesFromPattern(declarator.id, node.kind, bindings);
        }
        return bindings;
    }
    collectExportDeclarationBindings(node) {
        return this.collectDeclarationBindings(node).map((binding) => ({
            ...binding,
            code: undefined
        }));
    }
    collectCatchBindings(node) {
        const bindings = [];
        if (node.param !== undefined) {
            this.collectBindingNamesFromPattern(node.param, "param", bindings);
        }
        return bindings;
    }
    collectImportBindings(node) {
        return node.specifiers.map((specifier) => this.createImportBinding(specifier));
    }
    createImportBinding(specifier) {
        return {
            kind: "import",
            message: `Import '${specifier.local.name}' is never referenced.`,
            name: specifier.local.name,
            reads: 0,
            span: specifier.local.span
        };
    }
    collectBindingNamesFromElement(node, kind, bindings) {
        switch (node.type) {
            case "AssignmentPattern":
                this.collectBindingNamesFromPattern(node.left, kind, bindings);
                return;
            case "RestElement":
                this.collectBindingNamesFromPattern(node.argument, kind, bindings);
                return;
            default:
                this.collectBindingNamesFromPattern(node, kind, bindings);
                return;
        }
    }
    collectBindingNamesFromPattern(node, kind, bindings) {
        switch (node.type) {
            case "Identifier":
                bindings.push(this.createBinding(node, kind));
                return;
            case "MemberExpression":
                return;
            case "ArrayPattern":
                for (const element of node.elements) {
                    if (element !== null) {
                        this.collectBindingNamesFromElement(element, kind, bindings);
                    }
                }
                return;
            case "ObjectPattern":
                for (const property of node.properties) {
                    if (property.type === "RestElement") {
                        this.collectBindingNamesFromPattern(property.argument, kind, bindings);
                        continue;
                    }
                    this.collectBindingNamesFromElement(property.value, kind, bindings);
                }
                return;
        }
    }
    createBinding(node, kind) {
        return {
            code: kind === "const" || kind === "let" ? "AS007" : undefined,
            kind,
            message: `Binding '${node.name}' is declared but never read.`,
            name: node.name,
            reads: 0,
            span: node.span
        };
    }
    collectPatternBindingNames(node) {
        const names = [];
        this.collectBindingNames(node, names);
        return names;
    }
    collectBindingNames(node, names) {
        switch (node.type) {
            case "AssignmentPattern":
                this.collectBindingNames(node.left, names);
                return;
            case "RestElement":
                this.collectBindingNames(node.argument, names);
                return;
            case "Identifier":
                names.push(node.name);
                return;
            case "MemberExpression":
                return;
            case "ArrayPattern":
                for (const element of node.elements) {
                    if (element !== null) {
                        this.collectBindingNames(element, names);
                    }
                }
                return;
            case "ObjectPattern":
                for (const property of node.properties) {
                    this.collectBindingNames(property.type === "RestElement" ? property.argument : property.value, names);
                }
                return;
        }
    }
    resolveBindings(names) {
        return names.flatMap((name) => {
            const binding = this.resolveBinding(name);
            return binding === undefined ? [] : [binding];
        });
    }
    withIgnoredReads(bindings, visit) {
        if (bindings.length === 0) {
            visit();
            return;
        }
        this.ignoredReads.push(new Set(bindings));
        visit();
        this.ignoredReads.pop();
    }
    withDeferredReads(visit) {
        const ignoredReads = this.ignoredReads.splice(0);
        visit();
        this.ignoredReads.push(...ignoredReads);
    }
}
