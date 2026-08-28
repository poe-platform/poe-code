import { parseModule } from "../../parse/parser.js";
export function AS_UNUSED_IMPORT(source, options = {}) {
    const filename = options.filename ?? "<input>";
    const unusedImports = collectUnusedImports(source, filename);
    const unusedByDeclaration = groupUnusedSpecifiers(unusedImports);
    return unusedImports.map((unusedImport) => createDiagnostic(filename, source, unusedImport, unusedByDeclaration.get(unusedImport.declaration) ?? new Set([unusedImport.specifier])));
}
export function fixASUnusedImports(source, options = {}) {
    const unusedImports = collectUnusedImports(source, options.filename ?? "<input>");
    if (unusedImports.length === 0) {
        return source;
    }
    const unusedByDeclaration = groupUnusedSpecifiers(unusedImports);
    const replacements = [];
    for (const [declaration, unusedSpecifiers] of unusedByDeclaration.entries()) {
        replacements.push(createUnusedImportReplacement(source, declaration, unusedSpecifiers));
    }
    return applyReplacements(source, replacements);
}
function groupUnusedSpecifiers(unusedImports) {
    const unusedByDeclaration = new Map();
    for (const unusedImport of unusedImports) {
        const specifiers = unusedByDeclaration.get(unusedImport.declaration) ?? new Set();
        specifiers.add(unusedImport.specifier);
        unusedByDeclaration.set(unusedImport.declaration, specifiers);
    }
    return unusedByDeclaration;
}
function collectUnusedImports(source, filename) {
    return new ASUnusedImportScanner(filename).scan(source);
}
class ASUnusedImportScanner {
    filename;
    imports = [];
    scopes = [];
    constructor(filename) {
        this.filename = filename;
    }
    scan(source) {
        const module = parseModule(source, this.filename);
        this.visitModule(module);
        return this.imports
            .filter((binding) => binding.reads === 0)
            .map((binding) => ({
            declaration: binding.declaration,
            specifier: binding.specifier
        }));
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
                this.visitExpression(node.argument);
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
                this.markRead(node);
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
                this.visitExpression(node.argument);
                return;
            case "BinaryExpression":
            case "LogicalExpression":
                this.visitExpression(node.left);
                this.visitExpression(node.right);
                return;
            case "ConditionalExpression":
                this.visitExpression(node.test);
                this.visitExpression(node.consequent);
                this.visitExpression(node.alternate);
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
                this.visitExpression(node.tag);
                this.visitTemplateLiteral(node.quasi);
                return;
            case "MetaProperty":
                return;
            case "BooleanLiteral":
            case "NullLiteral":
            case "NumericLiteral":
            case "RegexLiteral":
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
                return;
            }
            this.visitExpression(node.body);
        });
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
                this.markRead(node);
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
            case "MetaProperty":
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
        this.scopes.pop();
    }
    markRead(node) {
        const binding = this.resolveBinding(node.name);
        if (binding?.kind === "import") {
            binding.reads += 1;
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
            bindings.push({ kind: "param", name: "arguments" });
            if (node.type === "FunctionExpression" && node.id !== undefined) {
                bindings.push({ kind: "param", name: node.id.name });
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
            this.collectBindingNamesFromPattern(node.param, "param", bindings);
        }
        return bindings;
    }
    collectImportBindings(node) {
        return node.specifiers.map((specifier) => {
            const binding = {
                declaration: node,
                kind: "import",
                name: specifier.local.name,
                reads: 0,
                specifier,
                span: specifier.span
            };
            this.imports.push(binding);
            return binding;
        });
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
                bindings.push({
                    kind,
                    name: node.name
                });
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
function createDiagnostic(filename, source, unusedImport, unusedSpecifiers) {
    const { declaration, specifier } = unusedImport;
    const replacement = createUnusedImportReplacement(source, declaration, unusedSpecifiers);
    return {
        code: "AS-UNUSED-IMPORT",
        severity: "warning",
        message: `Import '${specifier.local.name}' is never referenced.`,
        filename,
        line: specifier.span.start.line,
        column: specifier.span.start.column,
        span: specifier.span,
        fix: {
            range: [replacement.start, replacement.end],
            replacement: replacement.text
        }
    };
}
function createUnusedImportReplacement(source, declaration, unusedSpecifiers) {
    const keptSpecifiers = declaration.specifiers.filter((specifier) => !unusedSpecifiers.has(specifier));
    if (keptSpecifiers.length === 0) {
        return createImportLineDeletion(source, declaration);
    }
    return {
        start: declaration.specifiers[0]?.span.start.offset ?? declaration.span.start.offset,
        end: createSpecifierListReplacementEnd(source, declaration),
        text: keptSpecifiers
            .map((specifier) => source.slice(specifier.span.start.offset, specifier.span.end.offset))
            .join(", ")
    };
}
function createImportLineDeletion(source, declaration) {
    const lineStart = source.lastIndexOf("\n", declaration.span.start.offset - 1) + 1;
    let end = declaration.span.end.offset;
    while (source[end] === " " || source[end] === "\t") {
        end += 1;
    }
    if (source[end] === ";") {
        end += 1;
    }
    while (source[end] === " " || source[end] === "\t") {
        end += 1;
    }
    if (source.slice(end, end + 2) === "\r\n") {
        end += 2;
    }
    else if (source[end] === "\n") {
        end += 1;
    }
    return {
        start: lineStart,
        end,
        text: lineStart === 0 && end >= source.length && hasTrailingLineBreak(source)
            ? readTrailingLineBreak(source)
            : ""
    };
}
function hasTrailingLineBreak(source) {
    return source.endsWith("\n") || source.endsWith("\r");
}
function readTrailingLineBreak(source) {
    return source.endsWith("\r\n") ? "\r\n" : "\n";
}
function createSpecifierListReplacementEnd(source, declaration) {
    const lastSpecifier = declaration.specifiers[declaration.specifiers.length - 1];
    if (lastSpecifier === undefined) {
        return declaration.span.end.offset;
    }
    const end = skipInlineWhitespace(source, lastSpecifier.span.end.offset);
    if (source[end] !== ",") {
        return lastSpecifier.span.end.offset;
    }
    return end + 1;
}
function skipInlineWhitespace(source, offset) {
    let index = offset;
    while (source[index] === " " ||
        source[index] === "\t" ||
        source[index] === "\r" ||
        source[index] === "\n") {
        index += 1;
    }
    return index;
}
function applyReplacements(source, replacements) {
    return [...replacements]
        .sort((left, right) => right.start - left.start)
        .reduce((result, replacement) => {
        return `${result.slice(0, replacement.start)}${replacement.text}${result.slice(replacement.end)}`;
    }, source);
}
