export function hoistVarDeclarations(node, scope) {
    if (node.type === "BlockStatement") {
        for (const statement of node.body) {
            hoistVarStatement(statement, scope);
        }
        return;
    }
    switch (node.type) {
        case "VariableDeclaration":
        case "IfStatement":
        case "ForStatement":
        case "ForInStatement":
        case "ForOfStatement":
        case "WhileStatement":
        case "DoWhileStatement":
        case "TryStatement":
        case "SwitchStatement":
        case "ExportNamedDeclaration":
            hoistVarStatement(node, scope);
            return;
        default:
            return;
    }
}
function hoistVarStatement(statement, scope) {
    switch (statement.type) {
        case "VariableDeclaration":
            declareVarBindings(statement, scope);
            return;
        case "BlockStatement":
            hoistVarDeclarations(statement, scope);
            return;
        case "IfStatement":
            hoistVarStatement(statement.consequent, scope);
            if (statement.alternate !== undefined) {
                hoistVarStatement(statement.alternate, scope);
            }
            return;
        case "ForStatement":
            if (statement.init?.type === "VariableDeclaration") {
                declareVarBindings(statement.init, scope);
            }
            hoistVarStatement(statement.body, scope);
            return;
        case "ForInStatement":
        case "ForOfStatement":
            if (statement.left.type === "VariableDeclaration") {
                declareVarBindings(statement.left, scope);
            }
            hoistVarStatement(statement.body, scope);
            return;
        case "WhileStatement":
        case "DoWhileStatement":
            hoistVarStatement(statement.body, scope);
            return;
        case "TryStatement":
            hoistVarDeclarations(statement.block, scope);
            if (statement.handler !== undefined) {
                hoistVarDeclarations(statement.handler.body, scope);
            }
            if (statement.finalizer !== undefined) {
                hoistVarDeclarations(statement.finalizer, scope);
            }
            return;
        case "SwitchStatement":
            for (const switchCase of statement.cases) {
                for (const consequent of switchCase.consequent) {
                    hoistVarStatement(consequent, scope);
                }
            }
            return;
        case "ExportNamedDeclaration":
            hoistVarStatement(statement.declaration, scope);
            return;
        case "FunctionDeclaration":
        case "ExportDefaultDeclaration":
        case "ImportDeclaration":
        case "BreakStatement":
        case "ContinueStatement":
        case "EmptyStatement":
        case "ExpressionStatement":
        case "ReturnStatement":
        case "ThrowStatement":
            return;
    }
}
function declareVarBindings(declaration, scope) {
    if (declaration.kind !== "var") {
        return;
    }
    for (const declarator of declaration.declarations) {
        for (const name of getPatternBindingNames(declarator.id)) {
            scope.declareVar(name);
        }
    }
}
function getPatternBindingNames(pattern) {
    switch (pattern.type) {
        case "Identifier":
            return [pattern.name];
        case "ArrayPattern":
            return pattern.elements.flatMap((element) => element === null || element.type === "MemberExpression"
                ? []
                : getNestedPatternBindingNames(element));
        case "ObjectPattern":
            return pattern.properties.flatMap((property) => property.type === "RestElement"
                ? property.argument.type === "MemberExpression"
                    ? []
                    : getNestedPatternBindingNames(property.argument)
                : property.value.type === "MemberExpression"
                    ? []
                    : getNestedPatternBindingNames(property.value));
    }
}
function getNestedPatternBindingNames(pattern) {
    switch (pattern.type) {
        case "Identifier":
            return [pattern.name];
        case "AssignmentPattern":
            return pattern.left.type === "MemberExpression"
                ? []
                : getNestedPatternBindingNames(pattern.left);
        case "RestElement":
            return pattern.argument.type === "MemberExpression"
                ? []
                : getNestedPatternBindingNames(pattern.argument);
        case "ArrayPattern":
            return pattern.elements.flatMap((element) => element === null || element.type === "MemberExpression"
                ? []
                : getNestedPatternBindingNames(element));
        case "ObjectPattern":
            return pattern.properties.flatMap((property) => property.type === "RestElement"
                ? property.argument.type === "MemberExpression"
                    ? []
                    : getNestedPatternBindingNames(property.argument)
                : property.value.type === "MemberExpression"
                    ? []
                    : getNestedPatternBindingNames(property.value));
    }
}
