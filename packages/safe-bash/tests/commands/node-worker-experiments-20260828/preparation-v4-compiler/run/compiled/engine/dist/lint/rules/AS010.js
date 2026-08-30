import { parseModule } from "../../parse/parser.js";
export function AS010(source, options = {}) {
    return new AS010Scanner(options.filename ?? "<input>").scan(source);
}
class AS010Scanner {
    filename;
    candidates = [];
    ignoredReads = [];
    scopes = [];
    constructor(filename) {
        this.filename = filename;
    }
    scan(source) {
        const module = parseModule(source, this.filename);
        const moduleScope = this.collectModuleBindings(module.body);
        this.withScope(moduleScope, () => {
            this.collectCandidates(module.body, moduleScope);
        });
        this.withScope(moduleScope, () => {
            this.visitModule(module);
        });
        return this.candidates
            .filter((candidate) => candidate.reads === 0 && candidate.reassignments === 0)
            .map((candidate) => ({
            code: "AS010",
            severity: "warning",
            message: `Top-level let '${candidate.name}' stores a host call result but is never read again.`,
            filename: this.filename,
            line: candidate.span.start.line,
            column: candidate.span.start.column,
            span: candidate.span
        }));
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
        const scope = node.init?.type === "VariableDeclaration"
            ? this.collectDeclarationBindings(node.init)
            : new Map();
        this.withScope(scope, () => {
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
        const scope = node.left.type === "VariableDeclaration"
            ? this.collectDeclarationBindings(node.left)
            : new Map();
        this.withScope(scope, () => {
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
        if (node.init === undefined) {
            return;
        }
        const init = node.init;
        this.withIgnoredReads(this.resolveCandidates(this.collectPatternBindingNames(node.id)), () => {
            this.visitExpression(init);
        });
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
        const scope = this.collectParameterBindings(node);
        if (node.body.type === "BlockStatement") {
            this.mergeScope(scope, this.collectBlockBindings(node.body.body));
        }
        this.withScope(scope, () => {
            for (const parameter of node.params) {
                this.visitBindingElement(parameter);
            }
            if (node.body.type === "BlockStatement") {
                for (const statement of node.body.body) {
                    this.visitStatement(statement);
                }
                return;
            }
            this.visitExpression(node.body);
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
                this.withIgnoredReads(this.resolveCandidates(this.collectPatternBindingNames(node.left)), () => {
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
                this.markReassignment(node);
                return;
            case "MemberExpression":
                this.visitMemberExpression(node);
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
    markRead(node) {
        const candidate = this.resolveCandidate(node.name);
        if (candidate !== undefined && !this.isIgnoredRead(candidate)) {
            candidate.reads += 1;
        }
    }
    markReassignment(node) {
        const candidate = this.resolveCandidate(node.name);
        if (candidate !== undefined) {
            candidate.reassignments += 1;
        }
    }
    isIgnoredRead(candidate) {
        for (let index = this.ignoredReads.length - 1; index >= 0; index -= 1) {
            if (this.ignoredReads[index]?.has(candidate)) {
                return true;
            }
        }
        return false;
    }
    resolveCandidate(name) {
        for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
            const entry = this.scopes[index]?.get(name);
            if (entry === undefined) {
                continue;
            }
            return typeof entry === "object" && entry.kind === "candidate" ? entry : undefined;
        }
        return undefined;
    }
    collectModuleBindings(body) {
        const scope = new Map();
        for (const statement of body) {
            if (statement.type === "ImportDeclaration") {
                this.mergeScope(scope, this.collectImportBindings(statement));
                continue;
            }
            if (statement.type === "VariableDeclaration") {
                this.mergeScope(scope, this.collectDeclarationBindings(statement));
                continue;
            }
            if (statement.type === "ExportNamedDeclaration") {
                this.mergeScope(scope, this.collectDeclarationBindings(statement.declaration));
            }
        }
        return scope;
    }
    collectCandidates(body, scope) {
        for (const statement of body) {
            if (statement.type !== "VariableDeclaration" || statement.kind !== "let") {
                continue;
            }
            for (const declarator of statement.declarations) {
                if (declarator.id.type !== "Identifier") {
                    continue;
                }
                const hostCall = this.findHostCall(declarator.init);
                if (hostCall === undefined || !this.isHostCall(hostCall)) {
                    continue;
                }
                const candidate = {
                    kind: "candidate",
                    name: declarator.id.name,
                    reads: 0,
                    reassignments: 0,
                    span: declarator.id.span
                };
                this.candidates.push(candidate);
                scope.set(candidate.name, candidate);
            }
        }
    }
    collectBlockBindings(body) {
        const scope = new Map();
        for (const statement of body) {
            if (statement.type === "VariableDeclaration") {
                this.mergeScope(scope, this.collectDeclarationBindings(statement));
            }
        }
        return scope;
    }
    collectParameterBindings(node) {
        const scope = new Map();
        for (const parameter of node.params) {
            this.collectBindingNamesFromElement(parameter, scope);
        }
        return scope;
    }
    collectDeclarationBindings(node) {
        const scope = new Map();
        for (const declarator of node.declarations) {
            this.collectBindingNamesFromPattern(declarator.id, scope);
        }
        return scope;
    }
    collectCatchBindings(node) {
        const scope = new Map();
        if (node.param !== undefined) {
            this.collectBindingNamesFromPattern(node.param, scope);
        }
        return scope;
    }
    collectImportBindings(node) {
        const scope = new Map();
        for (const specifier of node.specifiers) {
            scope.set(specifier.local.name, this.getImportBindingKind(specifier));
        }
        return scope;
    }
    getImportBindingKind(specifier) {
        return specifier.type === "ImportNamespaceSpecifier" ? "namespace" : "import";
    }
    collectBindingNamesFromElement(node, scope) {
        switch (node.type) {
            case "AssignmentPattern":
                this.collectBindingNamesFromPattern(node.left, scope);
                return;
            case "RestElement":
                this.collectBindingNamesFromPattern(node.argument, scope);
                return;
            default:
                this.collectBindingNamesFromPattern(node, scope);
                return;
        }
    }
    collectBindingNamesFromPattern(node, scope) {
        switch (node.type) {
            case "Identifier":
                scope.set(node.name, "local");
                return;
            case "MemberExpression":
                return;
            case "ArrayPattern":
                for (const element of node.elements) {
                    if (element !== null) {
                        this.collectBindingNamesFromElement(element, scope);
                    }
                }
                return;
            case "ObjectPattern":
                for (const property of node.properties) {
                    if (property.type === "RestElement") {
                        this.collectBindingNamesFromPattern(property.argument, scope);
                        continue;
                    }
                    this.collectBindingNamesFromElement(property.value, scope);
                }
                return;
        }
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
    resolveCandidates(names) {
        return names.flatMap((name) => {
            const candidate = this.resolveCandidate(name);
            return candidate === undefined ? [] : [candidate];
        });
    }
    withIgnoredReads(candidates, visit) {
        if (candidates.length === 0) {
            visit();
            return;
        }
        this.ignoredReads.push(new Set(candidates));
        try {
            visit();
        }
        finally {
            this.ignoredReads.pop();
        }
    }
    withScope(scope, visit) {
        this.scopes.push(scope);
        try {
            visit();
        }
        finally {
            this.scopes.pop();
        }
    }
    mergeScope(target, source) {
        for (const [name, binding] of source) {
            target.set(name, binding);
        }
    }
    findHostCall(node) {
        if (node === undefined) {
            return undefined;
        }
        if (node.type === "CallExpression") {
            return node;
        }
        if (node.type === "AwaitExpression" && node.argument.type === "CallExpression") {
            return node.argument;
        }
        return undefined;
    }
    isHostCall(node) {
        const root = this.findRootIdentifier(node.callee);
        if (root === undefined) {
            return false;
        }
        for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
            const binding = this.scopes[index]?.get(root.name);
            if (binding === undefined) {
                continue;
            }
            return binding === "import" || binding === "namespace";
        }
        return false;
    }
    findRootIdentifier(node) {
        switch (node.type) {
            case "Identifier":
                return node;
            case "MemberExpression":
                return this.findRootIdentifier(node.object);
            default:
                return undefined;
        }
    }
}
