import { parseModule } from "../../parse/parser.js";
import { normalizeModuleRegistrations } from "./module-registry.js";
const AS_FLOATING_PROMISE_MESSAGE = "Promise-returning call is not awaited, returned, stored, or chained.";
const PROMISE_CONSUMERS = new Set(["all", "allSettled", "any", "race"]);
const PROMISE_FACTORIES = new Set(["reject", "resolve"]);
const PROMISE_CHAIN_METHODS = new Set(["then"]);
export function AS_FLOATING_PROMISE(source, options = {}) {
    return new ASFloatingPromiseScanner(options.filename ?? "<input>", options.modules).scan(source);
}
class ASFloatingPromiseScanner {
    filename;
    diagnostics = [];
    moduleRegistrations;
    scopes = [];
    constructor(filename, modules) {
        this.filename = filename;
        this.moduleRegistrations = normalizeModuleRegistrations(modules);
    }
    scan(source) {
        this.visitModule(parseModule(source, this.filename));
        return this.diagnostics;
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
            case "BlockStatement":
                this.visitBlockStatement(node);
                return;
            case "ExpressionStatement":
                this.reportUnhandledLikelyPromiseStatementExpression(node.expression);
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
        this.visitBlockStatement(node.block);
        if (node.handler !== undefined) {
            this.visitCatchClause(node.handler);
        }
        if (node.finalizer !== undefined) {
            this.visitBlockStatement(node.finalizer);
        }
    }
    visitCatchClause(node) {
        const bindings = node.param === undefined ? [] : this.collectPatternBindings(node.param);
        this.withScope(bindings, () => {
            this.visitBlockStatement(node.body);
        });
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
        this.withScope(this.collectArrowFunctionBindings(node), () => {
            if (node.body.type === "BlockStatement") {
                this.visitBlockStatement(node.body);
                return;
            }
            this.visitExpression(node.body);
        });
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
    visitTemplateLiteral(node) {
        for (const expression of node.expressions) {
            this.visitExpression(expression);
        }
    }
    visitTaggedTemplateExpression(node) {
        this.visitExpression(node.tag);
        this.visitTemplateLiteral(node.quasi);
    }
    visitAssignmentTarget(node) {
        switch (node.type) {
            case "ArrayPattern":
            case "ObjectPattern":
                this.visitBindingPattern(node);
                return;
            case "MemberExpression":
                this.visitMemberExpression(node);
                return;
            case "Identifier":
            case "MetaProperty":
                return;
        }
    }
    visitBindingPattern(node) {
        switch (node.type) {
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
                        this.visitBindingElement(property);
                        continue;
                    }
                    this.visitAssignmentProperty(property);
                }
                return;
            case "Identifier":
                return;
        }
    }
    visitAssignmentProperty(node) {
        if (node.computed) {
            this.visitExpression(node.key);
        }
        this.visitBindingElement(node.value);
    }
    visitBindingElement(node) {
        switch (node.type) {
            case "AssignmentPattern":
                this.visitAssignmentTarget(node.left);
                this.visitExpression(node.right);
                return;
            case "RestElement":
                this.visitAssignmentTarget(node.argument);
                return;
            case "ArrayPattern":
            case "ObjectPattern":
            case "Identifier":
                this.visitBindingPattern(node);
                return;
            case "MemberExpression":
                this.visitMemberExpression(node);
                return;
        }
    }
    isUnhandledLikelyPromiseExpression(node) {
        if (node.type !== "CallExpression") {
            return false;
        }
        if (this.isPromiseConsumerCall(node) || this.isPromiseChainCall(node)) {
            return false;
        }
        return this.isLikelyPromiseCall(node);
    }
    reportUnhandledLikelyPromiseStatementExpression(node) {
        if (this.isUnhandledLikelyPromiseExpression(node)) {
            this.report(node.span);
            return;
        }
        switch (node.type) {
            case "LogicalExpression":
                this.reportUnhandledLikelyPromiseStatementExpression(node.left);
                this.reportUnhandledLikelyPromiseStatementExpression(node.right);
                return;
            case "ConditionalExpression":
                this.reportUnhandledLikelyPromiseStatementExpression(node.consequent);
                this.reportUnhandledLikelyPromiseStatementExpression(node.alternate);
                return;
            case "CallExpression":
            case "FunctionExpression":
            case "ArrowFunctionExpression":
            case "AwaitExpression":
            case "ArrayExpression":
            case "ObjectExpression":
            case "UnaryExpression":
            case "BinaryExpression":
            case "MemberExpression":
            case "AssignmentExpression":
            case "TemplateLiteral":
            case "TaggedTemplateExpression":
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
    isLikelyPromiseCall(node) {
        if (node.callee.type === "ArrowFunctionExpression") {
            return node.callee.async;
        }
        if (node.callee.type === "Identifier") {
            return this.resolveAsyncFunctionBinding(node.callee.name);
        }
        if (node.callee.type !== "MemberExpression") {
            return false;
        }
        if (this.isPromiseFactoryCall(node)) {
            return true;
        }
        return this.isAsyncNamespaceMemberCall(node.callee);
    }
    isPromiseConsumerCall(node) {
        return this.isPromiseStaticMethodCall(node, PROMISE_CONSUMERS);
    }
    isPromiseFactoryCall(node) {
        return this.isPromiseStaticMethodCall(node, PROMISE_FACTORIES);
    }
    isPromiseStaticMethodCall(node, methodNames) {
        const member = node.callee.type === "MemberExpression" ? node.callee : undefined;
        return (member !== undefined &&
            !member.computed &&
            member.object.type === "Identifier" &&
            member.object.name === "Promise" &&
            member.property.type === "Identifier" &&
            methodNames.has(member.property.name));
    }
    isPromiseChainCall(node) {
        const member = node.callee.type === "MemberExpression" ? node.callee : undefined;
        return (member !== undefined &&
            !member.computed &&
            member.property.type === "Identifier" &&
            PROMISE_CHAIN_METHODS.has(member.property.name) &&
            this.isLikelyPromiseExpression(member.object));
    }
    isLikelyPromiseExpression(node) {
        return node.type === "CallExpression" && this.isLikelyPromiseCall(node);
    }
    resolveAsyncFunctionBinding(name) {
        const binding = this.resolveBinding(name);
        return (binding?.kind === "import" || binding?.kind === "local") && binding.async === true;
    }
    isAsyncNamespaceMemberCall(member) {
        if (member.computed ||
            member.object.type !== "Identifier" ||
            member.property.type !== "Identifier") {
            return false;
        }
        const binding = this.resolveBinding(member.object.name);
        if (binding?.kind !== "namespace-import") {
            return false;
        }
        return (this.moduleRegistrations.get(binding.moduleName)?.asyncExports.has(member.property.name) ===
            true);
    }
    collectModuleBindings(statements) {
        return [
            ...statements.flatMap((statement) => {
                if (statement.type !== "ImportDeclaration") {
                    return [];
                }
                return statement.specifiers.flatMap((specifier) => {
                    if (specifier.type === "ImportNamespaceSpecifier") {
                        return [
                            {
                                kind: "namespace-import",
                                moduleName: statement.source.value,
                                name: specifier.local.name
                            }
                        ];
                    }
                    const exportName = specifier.type === "ImportDefaultSpecifier" ? "default" : specifier.imported.name;
                    return [
                        {
                            async: this.moduleRegistrations
                                .get(statement.source.value)
                                ?.asyncExports.has(exportName) === true,
                            kind: "import",
                            name: specifier.local.name
                        }
                    ];
                });
            }),
            ...this.collectBlockBindings(statements)
        ];
    }
    collectBlockBindings(statements) {
        return statements.flatMap((statement) => {
            if (statement.type === "FunctionDeclaration") {
                return [
                    { async: statement.async && !statement.generator, kind: "local", name: statement.id.name }
                ];
            }
            if (statement.type === "VariableDeclaration") {
                return this.collectDeclarationBindings(statement);
            }
            if (statement.type === "ExportNamedDeclaration") {
                return this.collectDeclarationBindings(statement.declaration);
            }
            return [];
        });
    }
    collectDeclarationBindings(node) {
        return node.declarations.flatMap((declarator) => this.collectDeclaratorBindings(declarator).map((name) => ({
            async: (declarator.init?.type === "ArrowFunctionExpression" ||
                (declarator.init?.type === "FunctionExpression" && !declarator.init.generator)) &&
                declarator.init.async,
            kind: "local",
            name
        })));
    }
    collectDeclaratorBindings(node) {
        return this.collectPatternBindingNames(node.id);
    }
    collectArrowFunctionBindings(node) {
        const bindings = node.params.flatMap((param) => this.collectParameterBindingNames(param).map((name) => ({
            async: false,
            kind: "local",
            name
        })));
        if (node.type === "FunctionExpression" && node.id !== undefined) {
            bindings.unshift({ async: node.async && !node.generator, kind: "local", name: node.id.name });
        }
        return bindings;
    }
    collectPatternBindings(node) {
        return this.collectPatternBindingNames(node).map((name) => ({
            async: false,
            kind: "local",
            name
        }));
    }
    collectParameterBindingNames(node) {
        switch (node.type) {
            case "AssignmentPattern":
                return this.collectPatternBindingNames(node.left);
            case "RestElement":
                return this.collectPatternBindingNames(node.argument);
            case "ArrayPattern":
            case "ObjectPattern":
            case "Identifier":
                return this.collectPatternBindingNames(node);
        }
    }
    collectPatternBindingNames(node) {
        switch (node.type) {
            case "Identifier":
                return [node.name];
            case "ArrayPattern":
                return node.elements.flatMap((element) => {
                    if (element === null) {
                        return [];
                    }
                    return this.collectBindingElementNames(element);
                });
            case "ObjectPattern":
                return node.properties.flatMap((property) => {
                    if (property.type === "RestElement") {
                        return this.collectBindingElementNames(property);
                    }
                    return this.collectBindingElementNames(property.value);
                });
            case "MemberExpression":
                return [];
        }
    }
    collectBindingElementNames(node) {
        switch (node.type) {
            case "AssignmentPattern":
                return this.collectPatternBindingNames(node.left);
            case "RestElement":
                return this.collectPatternBindingNames(node.argument);
            case "ArrayPattern":
            case "ObjectPattern":
            case "Identifier":
                return this.collectPatternBindingNames(node);
            case "MemberExpression":
                return [];
        }
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
    withScope(bindings, callback) {
        this.scopes.push(new Map(bindings.map((binding) => [binding.name, binding])));
        try {
            callback();
        }
        finally {
            this.scopes.pop();
        }
    }
    report(span) {
        this.diagnostics.push({
            code: "AS-FLOATING-PROMISE",
            severity: "warning",
            message: AS_FLOATING_PROMISE_MESSAGE,
            filename: this.filename,
            line: span.start.line,
            column: span.start.column,
            span
        });
    }
}
