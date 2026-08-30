import { parseModule } from "../../parse/parser.js";
import { KNOWN_RUNTIME_GLOBALS } from "./known-globals.js";
export function AS003(source, options = {}) {
    return new AS003Scanner(options.filename ?? "<input>", new Set([...KNOWN_RUNTIME_GLOBALS, ...(options.allowedGlobals ?? [])])).scan(source);
}
class AS003Scanner {
    filename;
    allowedGlobals;
    diagnostics = [];
    scopes = [];
    constructor(filename, allowedGlobals) {
        this.filename = filename;
        this.allowedGlobals = allowedGlobals;
    }
    scan(source) {
        const module = parseModule(source, this.filename);
        this.visitModule(module);
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
                this.visitBlock(node);
                return;
            case "ExpressionStatement":
                this.visitExpressionStatement(node);
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
    visitExpressionStatement(node) {
        this.visitExpression(node.expression);
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
            case "Identifier":
                this.visitIdentifier(node);
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
        this.withScope(this.collectParameterBindings(node), () => {
            for (const parameter of node.params) {
                this.visitBindingElement(parameter);
            }
            if (node.body.type === "BlockStatement") {
                this.visitBlock(node.body);
            }
            else {
                this.visitExpression(node.body);
            }
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
                this.visitExpression(node.right);
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
                this.visitIdentifier(node);
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
    visitIdentifier(node) {
        if (this.resolveBinding(node.name) !== undefined) {
            return;
        }
        if (this.allowedGlobals.has(node.name)) {
            return;
        }
        const visibleNames = this.collectVisibleNames();
        const nearMatches = this.collectSuggestionNames(visibleNames)
            .map((name) => ({ distance: getLevenshteinDistance(node.name, name), name }))
            .filter((entry) => entry.distance <= 2)
            .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name))
            .map((entry) => entry.name);
        const message = nearMatches.length > 0
            ? `Unknown identifier '${node.name}'. ${formatNearMatchMessage(nearMatches)}`
            : `Unknown identifier '${node.name}'. ${formatVisibleNamesMessage(visibleNames)}`;
        this.diagnostics.push({
            code: "AS003",
            severity: "error",
            message,
            filename: this.filename,
            line: node.span.start.line,
            column: node.span.start.column,
            span: node.span
        });
    }
    withScope(bindings, visit) {
        const scope = new Map();
        for (const binding of bindings) {
            scope.set(binding.name, binding);
        }
        this.scopes.push(scope);
        visit();
        this.scopes.pop();
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
    collectVisibleNames() {
        const names = new Set();
        for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
            for (const name of this.scopes[index]?.keys() ?? []) {
                names.add(name);
            }
        }
        return [...names].sort((left, right) => left.localeCompare(right));
    }
    collectSuggestionNames(visibleNames) {
        const names = new Set([...visibleNames, ...this.allowedGlobals]);
        return [...names].sort((left, right) => left.localeCompare(right));
    }
    collectModuleBindings(body) {
        const bindings = [];
        for (const statement of body) {
            if (statement.type === "ImportDeclaration") {
                bindings.push(...this.collectImportBindings(statement));
                continue;
            }
            if (statement.type === "FunctionDeclaration") {
                bindings.push({ kind: "let", name: statement.id.name });
                continue;
            }
            if (statement.type === "VariableDeclaration") {
                bindings.push(...this.collectDeclarationBindings(statement));
                continue;
            }
            if (statement.type === "ExportNamedDeclaration") {
                bindings.push(...this.collectDeclarationBindings(statement.declaration));
            }
        }
        return bindings;
    }
    collectBlockBindings(body) {
        const bindings = [];
        for (const statement of body) {
            if (statement.type === "FunctionDeclaration") {
                bindings.push({ kind: "let", name: statement.id.name });
            }
            if (statement.type === "VariableDeclaration") {
                bindings.push(...this.collectDeclarationBindings(statement));
            }
        }
        return bindings;
    }
    collectParameterBindings(node) {
        const bindings = [];
        if (node.type !== "ArrowFunctionExpression") {
            bindings.push({ kind: "let", name: "arguments" });
            if (node.type === "FunctionExpression" && node.id !== undefined) {
                bindings.push({ kind: "const", name: node.id.name });
            }
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
    collectCatchBindings(node) {
        const bindings = [];
        if (node.param !== undefined) {
            this.collectBindingNamesFromPattern(node.param, "let", bindings);
        }
        return bindings;
    }
    collectImportBindings(node) {
        const bindings = [];
        for (const specifier of node.specifiers) {
            bindings.push({ kind: "import", name: specifier.local.name });
        }
        return bindings;
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
                bindings.push({ kind, name: node.name });
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
}
function formatNearMatchMessage(names) {
    if (names.length === 1) {
        return `Did you mean '${names[0]}'?`;
    }
    return `Did you mean one of: ${names.map((name) => `'${name}'`).join(", ")}?`;
}
function formatVisibleNamesMessage(names) {
    if (names.length === 0) {
        return "No names are in scope.";
    }
    return `In-scope names: ${names.join(", ")}.`;
}
function getLevenshteinDistance(left, right) {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    const current = new Array(right.length + 1);
    for (let row = 1; row <= left.length; row += 1) {
        current[0] = row;
        for (let column = 1; column <= right.length; column += 1) {
            const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
            current[column] = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + substitutionCost);
        }
        for (let column = 0; column <= right.length; column += 1) {
            previous[column] = current[column];
        }
    }
    return previous[right.length];
}
