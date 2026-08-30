import { tokenize } from "./tokenizer.js";
import { assignIds } from "./assign-ids.js";
import { formatParseError } from "./format-error.js";
import { createExportDefaultDeclaration, createExportNamedDeclaration } from "./parse-export.js";
import { createImportMeta, isImportMetaTokenSequence } from "./parse-import-meta.js";
import { parseRegex } from "../interp/regex/parse.js";
const MAX_CONDITIONAL_EXPRESSION_DEPTH = 256;
const MAX_IF_STATEMENT_DEPTH = 2_048;
export class DisallowedSyntaxError extends Error {
    constructor(syntax, position) {
        super(`Disallowed syntax '${syntax}' at line ${position.line}, column ${position.column}.`);
        this.name = "DisallowedSyntaxError";
    }
}
const EQUALITY_OPERATORS = new Set(["==", "!=", "===", "!=="]);
const RELATIONAL_OPERATORS = new Set(["<", "<=", ">", ">=", "in", "instanceof"]);
const SHIFT_OPERATORS = new Set(["<<", ">>", ">>>"]);
const ADDITIVE_OPERATORS = new Set(["+", "-"]);
const MULTIPLICATIVE_OPERATORS = new Set(["*", "/", "%"]);
const BITWISE_OR_OPERATORS = new Set(["|"]);
const BITWISE_XOR_OPERATORS = new Set(["^"]);
const BITWISE_AND_OPERATORS = new Set(["&"]);
const MAX_UNICODE_CODE_POINT = 0x10ffff;
const TOP_LEVEL_STATEMENT_KEYWORDS = new Set([
    "break",
    "const",
    "continue",
    "do",
    "for",
    "function",
    "if",
    "import",
    "let",
    "return",
    "throw",
    "try",
    "while"
]);
export function parse(source, filename = "<input>") {
    try {
        const result = assignIds(parseTokens(tokenize(source, { allowRegexLiterals: true })));
        const regexLiteral = findRegexLiteral(result);
        if (regexLiteral !== undefined) {
            throw new Error(`Regular expression literals are not supported at line ${regexLiteral.span.start.line}, column ${regexLiteral.span.start.column}.`);
        }
        throwIfImportMetaAssignment(result);
        return result;
    }
    catch (error) {
        if (error instanceof DisallowedSyntaxError) {
            throw error;
        }
        if (error instanceof Error) {
            throw formatParseError(source, filename, error);
        }
        throw error;
    }
}
export function parseModule(source, filename = "<input>") {
    try {
        return assignIds(parseModuleTokens(tokenize(source, { allowRegexLiterals: true })));
    }
    catch (error) {
        if (error instanceof DisallowedSyntaxError) {
            throw error;
        }
        if (error instanceof Error) {
            throw formatParseError(source, filename, error);
        }
        throw error;
    }
}
export function parseExecutableModule(source, filename = "<input>") {
    try {
        const result = assignIds(parseModuleTokens(tokenize(source, { allowRegexLiterals: true })));
        throwIfImportMetaAssignment(result);
        return result;
    }
    catch (error) {
        if (error instanceof DisallowedSyntaxError) {
            throw error;
        }
        if (error instanceof Error) {
            throw formatParseError(source, filename, error);
        }
        throw error;
    }
}
function parseTokens(tokens) {
    return new Parser(tokens).parseTopLevel();
}
function parseModuleTokens(tokens) {
    return new Parser(tokens).parseModule();
}
function parseExpressionTokens(tokens) {
    return new Parser(tokens).parseExpressionOnly();
}
class Parser {
    tokens;
    index = 0;
    breakableDepth = 0;
    conditionalExpressionDepth = 0;
    ifStatementDepth = 0;
    loopDepth = 0;
    generatorBody = false;
    scopes = [new Map()];
    constructor(tokens) {
        this.tokens = tokens;
    }
    parseTopLevel() {
        if (this.isExportToken(this.currentToken())) {
            throw new DisallowedSyntaxError("export", this.currentToken().start);
        }
        const node = this.shouldParseTopLevelStatement()
            ? this.parseStatement()
            : this.parseExpression({ allowSequence: true }).node;
        while (this.consumePunctuator(";") !== undefined) {
            continue;
        }
        this.expectEof();
        return node;
    }
    parseModule() {
        const body = [];
        while (this.currentToken().type !== "eof") {
            const statement = this.parseTopLevelItem();
            body.push(statement);
            while (statement.type !== "EmptyStatement" && this.consumePunctuator(";") !== undefined) {
                continue;
            }
        }
        const end = this.currentToken().end;
        return {
            type: "Module",
            body,
            span: createSpan(body[0]?.span.start ?? end, body[body.length - 1]?.span.end ?? end)
        };
    }
    parseExpressionOnly() {
        const expression = this.parseExpression({ allowSequence: true }).node;
        while (this.consumePunctuator(";") !== undefined) {
            continue;
        }
        this.expectEof();
        return expression;
    }
    parseTopLevelItem() {
        const emptyStatement = this.parseEmptyStatement();
        if (emptyStatement !== undefined) {
            return emptyStatement;
        }
        if (this.isExportToken(this.currentToken())) {
            return this.parseExportDeclaration();
        }
        const token = this.currentToken();
        if (token.type === "keyword" &&
            token.value === "return" &&
            !this.hasReturnArgument(token, this.peekToken(1))) {
            throw new Error(`Top-level return statements must return a value at line ${token.start.line}, column ${token.start.column}.`);
        }
        if (this.shouldParseTopLevelStatement() ||
            (this.currentToken().type === "punctuator" && this.currentToken().value === "{")) {
            return this.parseStatement();
        }
        const expression = this.parseExpression({ allowSequence: true }).node;
        return {
            type: "ExpressionStatement",
            expression,
            span: expression.span
        };
    }
    parseExpression(options = {}) {
        const first = this.parseAssignmentExpression();
        if (options.allowSequence !== true || this.consumePunctuator(",") === undefined) {
            return first;
        }
        const expressions = [first.node];
        do {
            expressions.push(this.parseAssignmentExpression().node);
        } while (this.consumePunctuator(",") !== undefined);
        return {
            node: {
                type: "SequenceExpression",
                expressions,
                span: createSpan(expressions[0].span.start, expressions[expressions.length - 1].span.end)
            },
            parenthesized: false
        };
    }
    parseAssignmentExpression() {
        const arrowFunction = this.tryParseArrowFunctionExpression();
        if (arrowFunction !== undefined) {
            return {
                node: arrowFunction,
                parenthesized: false
            };
        }
        const patternAssignment = this.tryParsePatternAssignmentExpression();
        if (patternAssignment !== undefined) {
            return {
                node: patternAssignment,
                parenthesized: false
            };
        }
        const left = this.parseConditionalExpression();
        const operator = this.consumeAssignmentOperator();
        if (operator === undefined) {
            return left;
        }
        const right = this.parseAssignmentExpression();
        return {
            node: {
                type: "AssignmentExpression",
                operator,
                left: this.toAssignmentTarget(left.node),
                right: right.node,
                span: createSpan(left.node.span.start, right.node.span.end)
            },
            parenthesized: false
        };
    }
    tryParseArrowFunctionExpression() {
        if (this.isAsyncArrowWithParenthesizedParams()) {
            const asyncToken = this.currentToken();
            this.index += 1;
            const params = this.parseArrowParameters();
            return this.finishArrowFunctionExpression(asyncToken.start, true, params);
        }
        if (this.isAsyncArrowWithSingleParam()) {
            const asyncToken = this.currentToken();
            this.index += 1;
            const param = this.parseBindingIdentifier();
            return this.finishArrowFunctionExpression(asyncToken.start, true, [param]);
        }
        if (this.isParenthesizedArrowFunction()) {
            const start = this.currentToken().start;
            const params = this.parseArrowParameters();
            return this.finishArrowFunctionExpression(start, false, params);
        }
        if (this.isSingleParamArrowFunction()) {
            const param = this.parseBindingIdentifier();
            return this.finishArrowFunctionExpression(param.span.start, false, [param]);
        }
        return undefined;
    }
    finishArrowFunctionExpression(start, isAsync, params) {
        this.expectPunctuator("=>");
        const body = this.parseArrowFunctionBody();
        return {
            type: "ArrowFunctionExpression",
            async: isAsync,
            body,
            expression: body.type !== "BlockStatement",
            params,
            span: createSpan(start, body.span.end)
        };
    }
    parseConditionalExpression() {
        if (this.conditionalExpressionDepth >= MAX_CONDITIONAL_EXPRESSION_DEPTH) {
            const token = this.currentToken();
            throw new Error(`Conditional expression nesting limit exceeded at line ${token.start.line}, column ${token.start.column}.`);
        }
        this.conditionalExpressionDepth += 1;
        try {
            const test = this.parseCoalesceExpression();
            if (this.consumePunctuator("?") === undefined) {
                return test;
            }
            const consequent = this.parseExpression();
            this.expectPunctuator(":");
            const alternate = this.parseAssignmentExpression();
            return {
                node: {
                    type: "ConditionalExpression",
                    test: test.node,
                    consequent: consequent.node,
                    alternate: alternate.node,
                    span: createSpan(test.node.span.start, alternate.node.span.end)
                },
                parenthesized: false
            };
        }
        finally {
            this.conditionalExpressionDepth -= 1;
        }
    }
    parseArrowFunctionBody() {
        if (this.currentToken().type === "punctuator" && this.currentToken().value === "{") {
            return this.withFunctionContext(false, () => this.parseBlockStatement());
        }
        return this.withFunctionContext(false, () => this.parseExpression().node);
    }
    parseBlockStatement() {
        const start = this.expectPunctuator("{");
        return this.withScope(() => this.parseBlockStatementBody(start));
    }
    parseBlockStatementBody(start) {
        const body = [];
        while (this.consumePunctuator("}") === undefined) {
            if (this.currentToken().type === "eof") {
                throw new Error(`Unterminated block at line ${start.start.line}, column ${start.start.column}.`);
            }
            const statement = this.parseStatement();
            body.push(statement);
            while (statement.type !== "EmptyStatement" && this.consumePunctuator(";") !== undefined) {
                continue;
            }
        }
        return {
            type: "BlockStatement",
            body,
            span: createSpan(start.start, this.previousToken().end)
        };
    }
    parseStatement() {
        const emptyStatement = this.parseEmptyStatement();
        if (emptyStatement !== undefined) {
            return emptyStatement;
        }
        const token = this.currentToken();
        if (token.type === "identifier" &&
            this.peekToken(1).type === "punctuator" &&
            this.peekToken(1).value === ":") {
            this.index += 2;
            return this.parseLabeledStatement([token.value], token);
        }
        this.assertAllowedStatementStart(token);
        if (token.type === "punctuator" && token.value === "{") {
            return this.parseBlockStatement();
        }
        if (token.type === "keyword" && token.value === "if") {
            return this.parseIfStatement();
        }
        if (token.type === "identifier" && token.value === "switch") {
            return this.parseSwitchStatement();
        }
        if ((token.type === "keyword" && token.value === "function") ||
            this.isAsyncFunctionDeclarationStart()) {
            return this.parseFunctionDeclaration();
        }
        if (token.type === "keyword" && token.value === "for") {
            return this.parseForStatement();
        }
        if (token.type === "keyword" && token.value === "while") {
            return this.parseWhileStatement();
        }
        if (token.type === "keyword" && token.value === "do") {
            return this.parseDoWhileStatement();
        }
        if (token.type === "keyword" && token.value === "try") {
            return this.parseTryStatement();
        }
        if (token.type === "keyword" && token.value === "import" && !this.isImportMetaStart()) {
            return this.parseImportDeclaration();
        }
        if (token.type === "keyword" && token.value === "return") {
            this.index += 1;
            const hasArgument = this.hasReturnArgument(token, this.currentToken());
            const argument = hasArgument ? this.parseExpression({ allowSequence: true }).node : undefined;
            const end = argument?.span.end ?? token.end;
            return {
                type: "ReturnStatement",
                argument,
                span: createSpan(token.start, end)
            };
        }
        if (token.type === "keyword" && token.value === "throw") {
            this.index += 1;
            if (hasLineBreakBetween(token, this.currentToken())) {
                throw new Error(`Illegal newline after throw at line ${token.start.line}, column ${token.start.column}.`);
            }
            if (this.currentToken().type === "punctuator" &&
                (this.currentToken().value === ";" || this.currentToken().value === "}")) {
                throw unexpectedTokenError(this.currentToken());
            }
            if (this.currentToken().type === "eof") {
                throw unexpectedTokenError(this.currentToken());
            }
            const argument = this.parseExpression({ allowSequence: true }).node;
            return {
                type: "ThrowStatement",
                argument,
                span: createSpan(token.start, argument.span.end)
            };
        }
        if ((token.type === "keyword" && (token.value === "const" || token.value === "let")) ||
            (token.type === "identifier" && token.value === "var")) {
            return this.parseVariableDeclaration();
        }
        if (token.type === "keyword" && token.value === "break") {
            if (this.breakableDepth === 0) {
                throw new Error(`Illegal break statement outside a loop or switch at line ${token.start.line}, column ${token.start.column}.`);
            }
            this.index += 1;
            const label = this.consumeControlLabel(token);
            return {
                type: "BreakStatement",
                ...(label === undefined ? {} : { label: label.value }),
                span: createSpan(token.start, label?.end ?? token.end)
            };
        }
        if (token.type === "keyword" && token.value === "continue") {
            if (this.loopDepth === 0) {
                throw new Error(`Illegal continue statement outside a loop at line ${token.start.line}, column ${token.start.column}.`);
            }
            this.index += 1;
            const label = this.consumeControlLabel(token);
            return {
                type: "ContinueStatement",
                ...(label === undefined ? {} : { label: label.value }),
                span: createSpan(token.start, label?.end ?? token.end)
            };
        }
        const expression = this.parseExpression({ allowSequence: true }).node;
        return {
            type: "ExpressionStatement",
            expression,
            span: createSpan(expression.span.start, expression.span.end)
        };
    }
    parseEmptyStatement() {
        const token = this.consumePunctuator(";");
        if (token === undefined) {
            return undefined;
        }
        return {
            type: "EmptyStatement",
            span: createTokenSpan(token)
        };
    }
    parseLabeledStatement(labels, firstLabelToken) {
        const token = this.currentToken();
        if (token.type === "identifier" &&
            this.peekToken(1).type === "punctuator" &&
            this.peekToken(1).value === ":") {
            this.index += 2;
            return this.parseLabeledStatement([...labels, token.value], firstLabelToken);
        }
        if (token.type === "keyword" && token.value === "for") {
            return this.parseForStatement(labels);
        }
        if (token.type === "keyword" && token.value === "while") {
            return this.parseWhileStatement(labels);
        }
        if (token.type === "keyword" && token.value === "do") {
            return this.parseDoWhileStatement(labels);
        }
        throw new DisallowedSyntaxError("label", firstLabelToken.start);
    }
    parseIfStatement() {
        if (this.ifStatementDepth >= MAX_IF_STATEMENT_DEPTH) {
            const token = this.currentToken();
            throw new Error(`If statement nesting limit exceeded at line ${token.start.line}, column ${token.start.column}.`);
        }
        this.ifStatementDepth += 1;
        try {
            const ifToken = this.expectKeyword("if");
            this.expectPunctuator("(");
            const test = this.parseExpression({ allowSequence: true }).node;
            this.expectPunctuator(")");
            const consequent = this.parseStatement();
            if (consequent.type !== "BlockStatement") {
                while (this.currentToken().type === "punctuator" &&
                    this.currentToken().value === ";" &&
                    this.peekToken(1).type === "keyword" &&
                    this.peekToken(1).value === "else") {
                    this.index += 1;
                }
            }
            const elseToken = this.consumeKeyword("else");
            const alternate = elseToken === undefined ? undefined : this.parseStatement();
            return {
                type: "IfStatement",
                test,
                consequent,
                alternate,
                span: createSpan(ifToken.start, alternate?.span.end ?? consequent.span.end)
            };
        }
        finally {
            this.ifStatementDepth -= 1;
        }
    }
    parseSwitchStatement() {
        const switchToken = this.currentToken();
        this.index += 1;
        this.expectPunctuator("(");
        const discriminant = this.parseExpression({ allowSequence: true }).node;
        this.expectPunctuator(")");
        const openBrace = this.expectPunctuator("{");
        return this.withScope(() => this.withBreakableContext(() => {
            const cases = [];
            let hasDefault = false;
            while (this.consumePunctuator("}") === undefined) {
                if (this.currentToken().type === "eof") {
                    throw new Error(`Unterminated switch statement at line ${openBrace.start.line}, column ${openBrace.start.column}.`);
                }
                const clauseToken = this.currentToken();
                let test;
                if (clauseToken.type === "identifier" && clauseToken.value === "case") {
                    this.index += 1;
                    test = this.parseExpression({ allowSequence: true }).node;
                }
                else if (clauseToken.type === "identifier" && clauseToken.value === "default") {
                    if (hasDefault) {
                        throw new Error(`Duplicate default clause at line ${clauseToken.start.line}, column ${clauseToken.start.column}.`);
                    }
                    hasDefault = true;
                    this.index += 1;
                }
                else {
                    throw unexpectedTokenError(clauseToken);
                }
                const colon = this.expectPunctuator(":");
                const consequent = [];
                while (!this.isSwitchClauseStart() && !this.isCurrentPunctuator("}")) {
                    const statement = this.parseStatement();
                    consequent.push(statement);
                    while (statement.type !== "EmptyStatement" &&
                        this.consumePunctuator(";") !== undefined) {
                        continue;
                    }
                }
                cases.push({
                    type: "SwitchCase",
                    test,
                    consequent,
                    span: createSpan(clauseToken.start, consequent.at(-1)?.span.end ?? colon.end)
                });
            }
            return {
                type: "SwitchStatement",
                discriminant,
                cases,
                span: createSpan(switchToken.start, this.previousToken().end)
            };
        }));
    }
    isSwitchClauseStart() {
        const token = this.currentToken();
        return token.type === "identifier" && (token.value === "case" || token.value === "default");
    }
    isCurrentPunctuator(value) {
        const token = this.currentToken();
        return token.type === "punctuator" && token.value === value;
    }
    parseForStatement(labels) {
        const forToken = this.expectKeyword("for");
        return this.withScope(() => {
            this.expectPunctuator("(");
            const iterationOperator = this.findTopLevelForIterationOperator(this.index);
            if (iterationOperator?.value === "in") {
                const left = this.parseForInLeft();
                this.expectKeyword("in");
                const right = this.parseExpression().node;
                this.expectPunctuator(")");
                const body = this.withLoopContext(() => this.parseStatement());
                return {
                    type: "ForInStatement",
                    left,
                    right,
                    body,
                    ...createLoopLabelFields(labels),
                    span: createSpan(forToken.start, body.span.end)
                };
            }
            if (iterationOperator?.value === "of") {
                const left = this.parseForOfLeft();
                this.expectKeyword("of");
                const right = this.parseExpression().node;
                this.expectPunctuator(")");
                const body = this.withLoopContext(() => this.parseStatement());
                return {
                    type: "ForOfStatement",
                    left,
                    right,
                    body,
                    ...createLoopLabelFields(labels),
                    span: createSpan(forToken.start, body.span.end)
                };
            }
            let init;
            if (this.consumePunctuator(";") === undefined) {
                init =
                    (this.currentToken().type === "keyword" || this.currentToken().type === "identifier") &&
                        (this.currentToken().value === "const" ||
                            this.currentToken().value === "let" ||
                            this.currentToken().value === "var")
                        ? this.parseVariableDeclaration()
                        : this.parseExpression({ allowSequence: true }).node;
                this.expectPunctuator(";");
            }
            let test;
            if (this.consumePunctuator(";") === undefined) {
                test = this.parseExpression({ allowSequence: true }).node;
                this.expectPunctuator(";");
            }
            const update = this.currentToken().type === "punctuator" && this.currentToken().value === ")"
                ? undefined
                : this.parseExpression({ allowSequence: true }).node;
            this.expectPunctuator(")");
            const body = this.withLoopContext(() => this.parseStatement());
            return {
                type: "ForStatement",
                init,
                test,
                update,
                body,
                ...createLoopLabelFields(labels),
                span: createSpan(forToken.start, body.span.end)
            };
        });
    }
    parseForInLeft() {
        const left = this.parseForOfLeft();
        const target = left.type === "VariableDeclaration" ? left.declarations[0]?.id : left;
        if (target?.type !== "Identifier") {
            throw new Error("for...in keys are strings; destructure inside the body");
        }
        return left;
    }
    parseForOfLeft() {
        if ((this.currentToken().type === "keyword" || this.currentToken().type === "identifier") &&
            (this.currentToken().value === "const" ||
                this.currentToken().value === "let" ||
                this.currentToken().value === "var")) {
            return this.parseForOfDeclaration();
        }
        return this.toPatternTarget(this.parseAssignmentTarget());
    }
    parseForOfDeclaration() {
        const kindToken = this.currentToken();
        if ((kindToken.type !== "keyword" && kindToken.type !== "identifier") ||
            (kindToken.value !== "const" && kindToken.value !== "let" && kindToken.value !== "var")) {
            throw unexpectedTokenError(kindToken);
        }
        this.index += 1;
        const id = this.parseBindingTarget();
        if (this.currentToken().type === "punctuator" && this.currentToken().value === "=") {
            throw new Error(`for...of declarations cannot include an initializer at line ${kindToken.start.line}, column ${kindToken.start.column}.`);
        }
        if (this.currentToken().type === "punctuator" && this.currentToken().value === ",") {
            throw new Error(`for...of declarations must include exactly one declarator at line ${kindToken.start.line}, column ${kindToken.start.column}.`);
        }
        const declarator = {
            type: "VariableDeclarator",
            id,
            span: id.span
        };
        this.declarePatternBindings(id);
        return {
            type: "VariableDeclaration",
            declarations: [declarator],
            kind: kindToken.value,
            span: createSpan(kindToken.start, id.span.end)
        };
    }
    parseWhileStatement(labels) {
        const whileToken = this.expectKeyword("while");
        this.expectPunctuator("(");
        const test = this.parseExpression({ allowSequence: true }).node;
        this.expectPunctuator(")");
        const body = this.withLoopContext(() => this.parseStatement());
        return {
            type: "WhileStatement",
            test,
            body,
            ...createLoopLabelFields(labels),
            span: createSpan(whileToken.start, body.span.end)
        };
    }
    parseDoWhileStatement(labels) {
        const doToken = this.expectKeyword("do");
        const body = this.withLoopContext(() => this.parseStatement());
        this.expectKeyword("while");
        this.expectPunctuator("(");
        const test = this.parseExpression({ allowSequence: true }).node;
        const closeParen = this.expectPunctuator(")");
        return {
            type: "DoWhileStatement",
            body,
            test,
            ...createLoopLabelFields(labels),
            span: createSpan(doToken.start, closeParen.end)
        };
    }
    parseTryStatement() {
        const tryToken = this.expectKeyword("try");
        const block = this.parseBlockStatement();
        const handler = this.currentToken().type === "keyword" && this.currentToken().value === "catch"
            ? this.parseCatchClause()
            : undefined;
        let finalizer;
        if (this.currentToken().type === "keyword" && this.currentToken().value === "finally") {
            this.index += 1;
            finalizer = this.parseBlockStatement();
        }
        if (this.currentToken().type === "keyword" && this.currentToken().value === "catch") {
            throw new Error(`Try statements support only one catch clause at line ${this.currentToken().start.line}, column ${this.currentToken().start.column}.`);
        }
        if (handler === undefined && finalizer === undefined) {
            throw new Error(`Expected 'catch' or 'finally' at line ${this.currentToken().start.line}, column ${this.currentToken().start.column}.`);
        }
        return {
            type: "TryStatement",
            block,
            handler,
            finalizer,
            span: createSpan(tryToken.start, finalizer?.span.end ?? handler?.span.end ?? block.span.end)
        };
    }
    parseImportDeclaration() {
        const importToken = this.expectKeyword("import");
        let specifiers;
        if (this.currentToken().type === "punctuator" && this.currentToken().value === "{") {
            specifiers = this.parseImportNamedSpecifiers();
        }
        else if (this.currentToken().type === "punctuator" && this.currentToken().value === "*") {
            const start = this.expectPunctuator("*");
            this.expectKeyword("as");
            const local = this.parseBindingIdentifier();
            specifiers = [
                {
                    type: "ImportNamespaceSpecifier",
                    local,
                    span: createSpan(start.start, local.span.end)
                }
            ];
        }
        else {
            const local = this.parseBindingIdentifier();
            specifiers = [
                {
                    type: "ImportDefaultSpecifier",
                    local,
                    span: local.span
                }
            ];
        }
        this.expectKeyword("from");
        const sourceToken = this.currentToken();
        if (sourceToken.type !== "string") {
            throw unexpectedTokenError(sourceToken);
        }
        this.index += 1;
        const source = createStringLiteral(sourceToken);
        assertBareImportSpecifier(source);
        return {
            type: "ImportDeclaration",
            specifiers,
            source,
            span: createSpan(importToken.start, source.span.end)
        };
    }
    parseImportNamedSpecifiers() {
        this.expectPunctuator("{");
        const specifiers = [];
        while (true) {
            const imported = this.parseIdentifierName();
            let local = imported;
            if (this.consumeKeyword("as") !== undefined) {
                local = this.parseBindingIdentifier();
            }
            specifiers.push({
                type: "ImportSpecifier",
                imported,
                local,
                span: createSpan(imported.span.start, local.span.end)
            });
            const comma = this.consumePunctuator(",");
            if (comma === undefined) {
                break;
            }
            if (this.currentToken().type === "punctuator" && this.currentToken().value === "}") {
                break;
            }
        }
        if (specifiers.length === 0) {
            throw unexpectedTokenError(this.currentToken());
        }
        this.expectPunctuator("}");
        return specifiers;
    }
    parseExportDeclaration() {
        const exportToken = this.currentToken();
        if (!this.isExportToken(exportToken)) {
            throw unexpectedTokenError(exportToken);
        }
        this.index += 1;
        if (this.currentToken().value === "default") {
            return this.parseExportDefaultDeclaration(exportToken);
        }
        if (this.currentToken().type === "keyword" && this.currentToken().value === "const") {
            return this.parseExportNamedDeclaration(exportToken);
        }
        throw new DisallowedSyntaxError(`export ${this.currentToken().value}`, exportToken.start);
    }
    parseExportNamedDeclaration(exportToken) {
        const declaration = this.parseVariableDeclaration();
        for (const declarator of declaration.declarations) {
            if (declarator.id.type !== "Identifier") {
                throw new DisallowedSyntaxError("export const", declarator.id.span.start);
            }
        }
        return createExportNamedDeclaration(exportToken, declaration);
    }
    parseExportDefaultDeclaration(exportToken) {
        this.index += 1;
        if (this.currentToken().value === "class") {
            throw new DisallowedSyntaxError(`export default ${this.currentToken().value}`, this.currentToken().start);
        }
        const declaration = this.parseExpression().node;
        return createExportDefaultDeclaration(exportToken, declaration);
    }
    parseCatchClause() {
        const catchToken = this.expectKeyword("catch");
        let param;
        if (this.consumePunctuator("(") !== undefined) {
            param = this.parseBindingTarget();
            this.expectPunctuator(")");
        }
        const body = this.parseBlockStatement();
        return {
            type: "CatchClause",
            param,
            body,
            span: createSpan(catchToken.start, body.span.end)
        };
    }
    parseVariableDeclaration() {
        const kindToken = this.currentToken();
        if ((kindToken.type !== "keyword" && kindToken.type !== "identifier") ||
            (kindToken.value !== "const" && kindToken.value !== "let" && kindToken.value !== "var")) {
            throw unexpectedTokenError(kindToken);
        }
        this.index += 1;
        const declarations = [];
        while (true) {
            const declarator = this.parseVariableDeclarator(kindToken.value);
            if (kindToken.value !== "var") {
                this.declarePatternBindings(declarator.id);
            }
            declarations.push(declarator);
            const comma = this.consumePunctuator(",");
            if (comma === undefined) {
                break;
            }
        }
        return {
            type: "VariableDeclaration",
            declarations,
            kind: kindToken.value,
            span: createSpan(kindToken.start, declarations[declarations.length - 1].span.end)
        };
    }
    parseFunctionDeclaration() {
        const asyncToken = this.consumeKeyword("async");
        const functionToken = this.expectKeyword("function");
        const generatorToken = this.consumePunctuator("*");
        if (asyncToken !== undefined && generatorToken !== undefined) {
            throw new Error(`async function* is not supported at line ${asyncToken.start.line}, column ${asyncToken.start.column}.`);
        }
        const id = this.parseBindingIdentifier();
        this.declareBinding(id);
        const params = this.withScope(() => {
            const parsedParams = this.parseArrowParameters();
            for (const param of parsedParams) {
                for (const identifier of collectBindingIdentifiers(param)) {
                    this.declareBinding(identifier);
                }
            }
            return parsedParams;
        });
        const generator = generatorToken !== undefined;
        const body = this.withFunctionContext(generator, () => this.parseBlockStatement());
        return {
            type: "FunctionDeclaration",
            async: asyncToken !== undefined,
            body,
            generator,
            id,
            params,
            span: createSpan(asyncToken?.start ?? functionToken.start, body.span.end)
        };
    }
    parseVariableDeclarator(kind) {
        const id = this.parseBindingTarget();
        let init;
        if (this.consumePunctuator("=") !== undefined) {
            init = this.parseExpression().node;
        }
        if (kind === "const" && init === undefined) {
            throw new Error(`Missing initializer in const declaration at line ${id.span.start.line}, column ${id.span.start.column}.`);
        }
        if (init === undefined && id.type !== "Identifier") {
            throw new Error(`Destructuring declarations require an initializer at line ${id.span.start.line}, column ${id.span.start.column}.`);
        }
        return {
            type: "VariableDeclarator",
            id,
            init,
            span: createSpan(id.span.start, init?.span.end ?? id.span.end)
        };
    }
    parseArrowParameters() {
        this.expectPunctuator("(");
        const params = [];
        if (this.consumePunctuator(")") !== undefined) {
            return params;
        }
        while (true) {
            const param = this.parseBindingElement();
            params.push(param);
            const comma = this.consumePunctuator(",");
            if (comma === undefined) {
                break;
            }
            if (param.type === "RestElement") {
                if (this.currentToken().type === "punctuator" && this.currentToken().value === ")") {
                    throw unexpectedTokenError(comma);
                }
                throw new Error(`Rest element must be the last parameter at line ${comma.start.line}, column ${comma.start.column}.`);
            }
            if (this.currentToken().type === "punctuator" && this.currentToken().value === ")") {
                break;
            }
        }
        this.expectPunctuator(")");
        return params;
    }
    parseBindingElement() {
        if (this.consumePunctuator("...") !== undefined) {
            const start = this.previousToken().start;
            const argument = this.parseBindingTarget();
            return {
                type: "RestElement",
                argument,
                span: createSpan(start, argument.span.end)
            };
        }
        const left = this.parseBindingTarget();
        if (this.consumePunctuator("=") === undefined) {
            return left;
        }
        const right = this.parseExpression().node;
        return {
            type: "AssignmentPattern",
            left,
            right,
            span: createSpan(left.span.start, right.span.end)
        };
    }
    parseBindingTarget() {
        const token = this.currentToken();
        if (isIdentifierLikeToken(token)) {
            return this.parseBindingIdentifier();
        }
        if (token.type === "punctuator" && token.value === "[") {
            return this.parseArrayPattern();
        }
        if (token.type === "punctuator" && token.value === "{") {
            return this.parseObjectPattern();
        }
        throw unexpectedTokenError(token);
    }
    parseBindingIdentifier() {
        const token = this.currentToken();
        if (!isIdentifierLikeToken(token)) {
            throw unexpectedTokenError(token);
        }
        this.index += 1;
        return createIdentifier(token);
    }
    parseArrayPattern() {
        const start = this.expectPunctuator("[");
        const elements = [];
        if (this.consumePunctuator("]") !== undefined) {
            return {
                type: "ArrayPattern",
                elements,
                span: createSpan(start.start, this.previousToken().end)
            };
        }
        while (true) {
            if (this.currentToken().type === "punctuator" && this.currentToken().value === ",") {
                this.index += 1;
                elements.push(null);
                if (this.currentToken().type === "punctuator" && this.currentToken().value === "]") {
                    break;
                }
                continue;
            }
            const element = this.parseBindingElement();
            elements.push(element);
            const comma = this.consumePunctuator(",");
            if (comma === undefined) {
                break;
            }
            if (element.type === "RestElement") {
                if (this.currentToken().type === "punctuator" && this.currentToken().value === "]") {
                    throw unexpectedTokenError(comma);
                }
                throw new Error(`Rest element must be the last element in an array pattern at line ${comma.start.line}, column ${comma.start.column}.`);
            }
            if (this.currentToken().type === "punctuator" && this.currentToken().value === "]") {
                break;
            }
        }
        const end = this.expectPunctuator("]");
        return {
            type: "ArrayPattern",
            elements,
            span: createSpan(start.start, end.end)
        };
    }
    parseObjectPattern() {
        const start = this.expectPunctuator("{");
        const properties = [];
        if (this.consumePunctuator("}") !== undefined) {
            return {
                type: "ObjectPattern",
                properties,
                span: createSpan(start.start, this.previousToken().end)
            };
        }
        while (true) {
            const property = this.parseObjectPatternProperty();
            properties.push(property);
            const comma = this.consumePunctuator(",");
            if (comma === undefined) {
                break;
            }
            if (property.type === "RestElement") {
                if (this.currentToken().type === "punctuator" && this.currentToken().value === "...") {
                    throw new Error(`Object pattern can contain only one rest element at line ${this.currentToken().start.line}, column ${this.currentToken().start.column}.`);
                }
                if (this.currentToken().type === "punctuator" && this.currentToken().value === "}") {
                    throw unexpectedTokenError(comma);
                }
                throw new Error(`Rest element must be the last property in an object pattern at line ${comma.start.line}, column ${comma.start.column}.`);
            }
            if (this.currentToken().type === "punctuator" && this.currentToken().value === "}") {
                break;
            }
        }
        const end = this.expectPunctuator("}");
        return {
            type: "ObjectPattern",
            properties,
            span: createSpan(start.start, end.end)
        };
    }
    parseObjectPatternProperty() {
        if (this.consumePunctuator("...") !== undefined) {
            const start = this.previousToken().start;
            const token = this.currentToken();
            if (token.type !== "identifier") {
                throw new Error(`Object rest element must bind to an identifier at line ${token.start.line}, column ${token.start.column}.`);
            }
            const argument = this.parseBindingIdentifier();
            return {
                type: "RestElement",
                argument,
                span: createSpan(start, argument.span.end)
            };
        }
        if (this.consumePunctuator("[") !== undefined) {
            const start = this.previousToken().start;
            const key = this.parsePatternComputedKey();
            this.expectPunctuator(":");
            const value = this.parseBindingElement();
            if (value.type === "RestElement") {
                throw unexpectedTokenError(this.previousToken());
            }
            return {
                type: "AssignmentProperty",
                computed: true,
                shorthand: false,
                key,
                value,
                span: createSpan(start, value.span.end)
            };
        }
        const token = this.currentToken();
        if (token.type === "identifier") {
            this.index += 1;
            const key = createIdentifier(token);
            if (this.consumePunctuator(":") !== undefined) {
                const value = this.parseBindingElement();
                if (value.type === "RestElement") {
                    throw unexpectedTokenError(this.previousToken());
                }
                return {
                    type: "AssignmentProperty",
                    computed: false,
                    shorthand: false,
                    key,
                    value,
                    span: createSpan(key.span.start, value.span.end)
                };
            }
            let value = key;
            if (this.consumePunctuator("=") !== undefined) {
                const right = this.parseExpression().node;
                value = {
                    type: "AssignmentPattern",
                    left: createIdentifier(token),
                    right,
                    span: createSpan(key.span.start, right.span.end)
                };
            }
            return {
                type: "AssignmentProperty",
                computed: false,
                shorthand: true,
                key,
                value,
                span: createSpan(key.span.start, value.span.end)
            };
        }
        if (isLiteralPropertyKey(token)) {
            this.index += 1;
            const key = createLiteralFromToken(token);
            this.expectPunctuator(":");
            const value = this.parseBindingElement();
            if (value.type === "RestElement") {
                throw unexpectedTokenError(this.previousToken());
            }
            return {
                type: "AssignmentProperty",
                computed: false,
                shorthand: false,
                key,
                value,
                span: createSpan(key.span.start, value.span.end)
            };
        }
        throw unexpectedTokenError(token);
    }
    tryParsePatternAssignmentExpression() {
        const token = this.currentToken();
        if (token.type !== "punctuator" ||
            (token.value !== "[" && token.value !== "{") ||
            !this.isPatternAssignmentStart(this.index)) {
            return undefined;
        }
        const left = token.value === "["
            ? this.parseAssignmentArrayPattern()
            : this.parseAssignmentObjectPattern();
        this.expectPunctuator("=");
        const right = this.parseAssignmentExpression().node;
        return {
            type: "AssignmentExpression",
            operator: "=",
            left,
            right,
            span: createSpan(left.span.start, right.span.end)
        };
    }
    parseAssignmentPatternElement() {
        if (this.consumePunctuator("...") !== undefined) {
            const start = this.previousToken().start;
            const argument = this.toPatternTarget(this.parseAssignmentTarget());
            return {
                type: "RestElement",
                argument,
                span: createSpan(start, argument.span.end)
            };
        }
        const left = this.parseAssignmentTarget();
        if (this.consumePunctuator("=") === undefined) {
            return this.toPatternTarget(left);
        }
        const right = this.parseAssignmentExpression().node;
        return {
            type: "AssignmentPattern",
            left: this.toPatternTarget(left),
            right,
            span: createSpan(left.span.start, right.span.end)
        };
    }
    parseAssignmentTarget() {
        const token = this.currentToken();
        if (token.type === "punctuator" && token.value === "[") {
            return this.parseAssignmentArrayPattern();
        }
        if (token.type === "punctuator" && token.value === "{") {
            return this.parseAssignmentObjectPattern();
        }
        const expression = this.parseLeftHandSideExpression().node;
        if (expression.type === "Identifier") {
            return expression;
        }
        if (expression.type === "MetaProperty" ||
            (expression.type === "MemberExpression" && !expression.optional)) {
            return expression;
        }
        throw invalidAssignmentTargetError(expression.span.start);
    }
    parseAssignmentArrayPattern() {
        const start = this.expectPunctuator("[");
        const elements = [];
        if (this.consumePunctuator("]") !== undefined) {
            return {
                type: "ArrayPattern",
                elements,
                span: createSpan(start.start, this.previousToken().end)
            };
        }
        while (true) {
            if (this.currentToken().type === "punctuator" && this.currentToken().value === ",") {
                this.index += 1;
                elements.push(null);
                if (this.currentToken().type === "punctuator" && this.currentToken().value === "]") {
                    break;
                }
                continue;
            }
            const element = this.parseAssignmentPatternElement();
            elements.push(element);
            const comma = this.consumePunctuator(",");
            if (comma === undefined) {
                break;
            }
            if (element.type === "RestElement") {
                if (this.currentToken().type === "punctuator" && this.currentToken().value === "]") {
                    throw unexpectedTokenError(comma);
                }
                throw new Error(`Rest element must be the last element in an array pattern at line ${comma.start.line}, column ${comma.start.column}.`);
            }
            if (this.currentToken().type === "punctuator" && this.currentToken().value === "]") {
                break;
            }
        }
        const end = this.expectPunctuator("]");
        return {
            type: "ArrayPattern",
            elements,
            span: createSpan(start.start, end.end)
        };
    }
    parseAssignmentObjectPattern() {
        const start = this.expectPunctuator("{");
        const properties = [];
        if (this.consumePunctuator("}") !== undefined) {
            return {
                type: "ObjectPattern",
                properties,
                span: createSpan(start.start, this.previousToken().end)
            };
        }
        while (true) {
            const property = this.parseAssignmentObjectPatternProperty();
            properties.push(property);
            const comma = this.consumePunctuator(",");
            if (comma === undefined) {
                break;
            }
            if (property.type === "RestElement") {
                if (this.currentToken().type === "punctuator" && this.currentToken().value === "...") {
                    throw new Error(`Object pattern can contain only one rest element at line ${this.currentToken().start.line}, column ${this.currentToken().start.column}.`);
                }
                if (this.currentToken().type === "punctuator" && this.currentToken().value === "}") {
                    throw unexpectedTokenError(comma);
                }
                throw new Error(`Rest element must be the last property in an object pattern at line ${comma.start.line}, column ${comma.start.column}.`);
            }
            if (this.currentToken().type === "punctuator" && this.currentToken().value === "}") {
                break;
            }
        }
        const end = this.expectPunctuator("}");
        return {
            type: "ObjectPattern",
            properties,
            span: createSpan(start.start, end.end)
        };
    }
    parseAssignmentObjectPatternProperty() {
        if (this.consumePunctuator("...") !== undefined) {
            const start = this.previousToken().start;
            const token = this.currentToken();
            if (token.type !== "identifier") {
                throw new Error(`Object rest element must bind to an identifier at line ${token.start.line}, column ${token.start.column}.`);
            }
            const argument = this.parseBindingIdentifier();
            return {
                type: "RestElement",
                argument,
                span: createSpan(start, argument.span.end)
            };
        }
        if (this.consumePunctuator("[") !== undefined) {
            const start = this.previousToken().start;
            const key = this.parsePatternComputedKey();
            this.expectPunctuator(":");
            const value = this.parseAssignmentPatternElement();
            if (value.type === "RestElement") {
                throw unexpectedTokenError(this.previousToken());
            }
            return {
                type: "AssignmentProperty",
                computed: true,
                shorthand: false,
                key,
                value,
                span: createSpan(start, value.span.end)
            };
        }
        const token = this.currentToken();
        if (token.type === "identifier") {
            this.index += 1;
            const key = createIdentifier(token);
            if (this.consumePunctuator(":") !== undefined) {
                const value = this.parseAssignmentPatternElement();
                if (value.type === "RestElement") {
                    throw unexpectedTokenError(this.previousToken());
                }
                return {
                    type: "AssignmentProperty",
                    computed: false,
                    shorthand: false,
                    key,
                    value,
                    span: createSpan(key.span.start, value.span.end)
                };
            }
            let value = key;
            if (this.consumePunctuator("=") !== undefined) {
                const right = this.parseAssignmentExpression().node;
                value = {
                    type: "AssignmentPattern",
                    left: createIdentifier(token),
                    right,
                    span: createSpan(key.span.start, right.span.end)
                };
            }
            return {
                type: "AssignmentProperty",
                computed: false,
                shorthand: true,
                key,
                value,
                span: createSpan(key.span.start, value.span.end)
            };
        }
        if (isLiteralPropertyKey(token)) {
            this.index += 1;
            const key = createLiteralFromToken(token);
            this.expectPunctuator(":");
            const value = this.parseAssignmentPatternElement();
            if (value.type === "RestElement") {
                throw unexpectedTokenError(this.previousToken());
            }
            return {
                type: "AssignmentProperty",
                computed: false,
                shorthand: false,
                key,
                value,
                span: createSpan(key.span.start, value.span.end)
            };
        }
        throw unexpectedTokenError(token);
    }
    parsePatternComputedKey() {
        const key = this.parseExpression({ allowSequence: true }).node;
        this.expectPunctuator("]");
        return key;
    }
    parseCoalesceExpression() {
        let left = this.parseLogicalOrExpression();
        while (this.consumePunctuator("??") !== undefined) {
            this.assertNullishOperand(left);
            const right = this.parseLogicalOrExpression();
            this.assertNullishOperand(right);
            left = {
                node: {
                    type: "LogicalExpression",
                    operator: "??",
                    left: left.node,
                    right: right.node,
                    span: createSpan(left.node.span.start, right.node.span.end)
                },
                parenthesized: false
            };
        }
        return left;
    }
    parseLogicalOrExpression() {
        return this.parseLogicalExpression(() => this.parseLogicalAndExpression(), "||");
    }
    parseLogicalAndExpression() {
        return this.parseLogicalExpression(() => this.parseBitwiseOrExpression(), "&&");
    }
    parseBitwiseOrExpression() {
        return this.parseBinaryExpression(() => this.parseBitwiseXorExpression(), BITWISE_OR_OPERATORS);
    }
    parseBitwiseXorExpression() {
        return this.parseBinaryExpression(() => this.parseBitwiseAndExpression(), BITWISE_XOR_OPERATORS);
    }
    parseBitwiseAndExpression() {
        return this.parseBinaryExpression(() => this.parseEqualityExpression(), BITWISE_AND_OPERATORS);
    }
    parseEqualityExpression() {
        return this.parseBinaryExpression(() => this.parseRelationalExpression(), EQUALITY_OPERATORS);
    }
    parseRelationalExpression() {
        return this.parseBinaryExpression(() => this.parseShiftExpression(), RELATIONAL_OPERATORS);
    }
    parseShiftExpression() {
        return this.parseBinaryExpression(() => this.parseAdditiveExpression(), SHIFT_OPERATORS);
    }
    parseAdditiveExpression() {
        return this.parseBinaryExpression(() => this.parseMultiplicativeExpression(), ADDITIVE_OPERATORS);
    }
    parseMultiplicativeExpression() {
        return this.parseBinaryExpression(() => this.parseExponentiationExpression(), MULTIPLICATIVE_OPERATORS);
    }
    parseExponentiationExpression() {
        const left = this.parseUnaryExpression();
        if (this.consumePunctuator("**") === undefined) {
            return left;
        }
        if (!left.parenthesized && left.node.type === "UnaryExpression") {
            const operator = this.previousToken();
            throw new Error(`Unary expressions cannot be used as the left-hand side of '**' without parentheses at line ${operator.start.line}, column ${operator.start.column}.`);
        }
        const right = this.parseExponentiationExpression();
        return {
            node: {
                type: "BinaryExpression",
                operator: "**",
                left: left.node,
                right: right.node,
                span: createSpan(left.node.span.start, right.node.span.end)
            },
            parenthesized: false
        };
    }
    parseUnaryExpression() {
        const token = this.currentToken();
        if (token.type === "punctuator" && (token.value === "++" || token.value === "--")) {
            this.index += 1;
            const argument = this.parseUnaryExpression();
            const target = this.toUpdateTarget(argument.node);
            return {
                node: {
                    type: "UpdateExpression",
                    operator: token.value,
                    prefix: true,
                    argument: target,
                    span: createSpan(token.start, argument.node.span.end)
                },
                parenthesized: false
            };
        }
        if (token.type === "keyword" && token.value === "yield") {
            if (!this.generatorBody) {
                throw new Error(`yield is only valid inside a generator body at line ${token.start.line}, column ${token.start.column}.`);
            }
            this.index += 1;
            if (hasLineBreakBetween(token, this.currentToken()) &&
                this.currentToken().type === "punctuator" &&
                this.currentToken().value === "*") {
                throw unexpectedTokenError(this.currentToken());
            }
            const delegate = this.consumePunctuator("*") !== undefined;
            const next = this.currentToken();
            const hasArgument = delegate ||
                (!hasLineBreakBetween(token, next) &&
                    !(next.type === "punctuator" && isYieldArgumentTerminator(next.value)) &&
                    next.type !== "eof");
            const argument = hasArgument ? this.parseAssignmentExpression().node : undefined;
            if (delegate && argument === undefined) {
                throw unexpectedTokenError(next);
            }
            return {
                node: {
                    type: "YieldExpression",
                    argument,
                    delegate,
                    span: createSpan(token.start, argument?.span.end ?? token.end)
                },
                parenthesized: false
            };
        }
        if (token.type === "keyword" && token.value === "await") {
            if (this.generatorBody) {
                throw new Error(`generators cannot await; use a regular async function at line ${token.start.line}, column ${token.start.column}.`);
            }
            this.index += 1;
            const argument = this.parseUnaryExpression();
            return {
                node: {
                    type: "AwaitExpression",
                    argument: argument.node,
                    span: createSpan(token.start, argument.node.span.end)
                },
                parenthesized: false
            };
        }
        if (token.type === "keyword" &&
            (token.value === "delete" || token.value === "typeof" || token.value === "void")) {
            this.index += 1;
            const argument = this.parseUnaryExpression();
            return {
                node: {
                    type: "UnaryExpression",
                    operator: token.value,
                    prefix: true,
                    argument: argument.node,
                    span: createSpan(token.start, argument.node.span.end)
                },
                parenthesized: false
            };
        }
        if (token.type === "punctuator" &&
            (token.value === "!" || token.value === "+" || token.value === "-" || token.value === "~")) {
            this.index += 1;
            const argument = this.parseUnaryExpression();
            return {
                node: {
                    type: "UnaryExpression",
                    operator: token.value,
                    prefix: true,
                    argument: argument.node,
                    span: createSpan(token.start, argument.node.span.end)
                },
                parenthesized: false
            };
        }
        return this.parseLeftHandSideExpression();
    }
    parseLeftHandSideExpression() {
        let expression = this.parsePrimaryExpression();
        while (true) {
            const optionalChain = this.consumePunctuator("?.");
            if (optionalChain !== undefined) {
                if (this.consumePunctuator("(") !== undefined) {
                    expression = {
                        node: this.createCallExpression(expression.node, true),
                        parenthesized: false
                    };
                    continue;
                }
                if (this.consumePunctuator("[") !== undefined) {
                    const property = this.parseExpression({ allowSequence: true });
                    const end = this.expectPunctuator("]");
                    expression = {
                        node: {
                            type: "MemberExpression",
                            computed: true,
                            object: expression.node,
                            optional: true,
                            property: property.node,
                            span: createSpan(expression.node.span.start, end.end)
                        },
                        parenthesized: false
                    };
                    continue;
                }
                const property = this.parseIdentifierName();
                expression = {
                    node: {
                        type: "MemberExpression",
                        computed: false,
                        object: expression.node,
                        optional: true,
                        property,
                        span: createSpan(expression.node.span.start, property.span.end)
                    },
                    parenthesized: false
                };
                continue;
            }
            if (this.consumePunctuator(".") !== undefined) {
                const property = this.parseIdentifierName();
                expression = {
                    node: {
                        type: "MemberExpression",
                        computed: false,
                        object: expression.node,
                        optional: false,
                        property,
                        span: createSpan(expression.node.span.start, property.span.end)
                    },
                    parenthesized: false
                };
                continue;
            }
            if (this.consumePunctuator("[") !== undefined) {
                const property = this.parseExpression({ allowSequence: true });
                const end = this.expectPunctuator("]");
                expression = {
                    node: {
                        type: "MemberExpression",
                        computed: true,
                        object: expression.node,
                        optional: false,
                        property: property.node,
                        span: createSpan(expression.node.span.start, end.end)
                    },
                    parenthesized: false
                };
                continue;
            }
            if (this.consumePunctuator("(") !== undefined) {
                expression = {
                    node: this.createCallExpression(expression.node, false),
                    parenthesized: false
                };
                continue;
            }
            if (this.currentToken().type === "template") {
                const quasi = createTemplateLiteral(this.currentToken(), { allowMalformedEscapes: true });
                this.index += 1;
                expression = {
                    node: {
                        type: "TaggedTemplateExpression",
                        tag: expression.node,
                        quasi,
                        span: createSpan(expression.node.span.start, quasi.span.end)
                    },
                    parenthesized: false
                };
                continue;
            }
            break;
        }
        const token = this.currentToken();
        if (token.type === "punctuator" &&
            (token.value === "++" || token.value === "--") &&
            token.start.line === expression.node.span.end.line) {
            this.index += 1;
            const target = this.toUpdateTarget(expression.node);
            return {
                node: {
                    type: "UpdateExpression",
                    operator: token.value,
                    prefix: false,
                    argument: target,
                    span: createSpan(expression.node.span.start, token.end)
                },
                parenthesized: false
            };
        }
        return expression;
    }
    parsePrimaryExpression() {
        const token = this.currentToken();
        if (token.type === "keyword" && token.value === "this") {
            this.index += 1;
            return {
                node: {
                    type: "ThisExpression",
                    span: createTokenSpan(token)
                },
                parenthesized: false
            };
        }
        if ((token.type === "keyword" && token.value === "function") ||
            this.isAsyncFunctionDeclarationStart()) {
            return {
                node: this.parseFunctionExpression(),
                parenthesized: false
            };
        }
        if (isNewToken(token)) {
            return this.parseNewExpression();
        }
        if (isIdentifierLikeToken(token)) {
            assertAllowedIdentifierReference(token);
            this.index += 1;
            return {
                node: createIdentifier(token),
                parenthesized: false
            };
        }
        if (token.type === "numeric") {
            this.index += 1;
            return {
                node: createNumericLiteral(token),
                parenthesized: false
            };
        }
        if (token.type === "string") {
            this.index += 1;
            return {
                node: createStringLiteral(token),
                parenthesized: false
            };
        }
        if (token.type === "regex") {
            this.index += 1;
            return {
                node: createRegexLiteral(token),
                parenthesized: false
            };
        }
        if (token.type === "template") {
            this.index += 1;
            return {
                node: createTemplateLiteral(token, { allowMalformedEscapes: false }),
                parenthesized: false
            };
        }
        if (token.type === "keyword") {
            if (this.isImportMetaStart()) {
                return {
                    node: this.parseImportMeta(),
                    parenthesized: false
                };
            }
            this.index += 1;
            return {
                node: createKeywordLiteral(token),
                parenthesized: false
            };
        }
        if (token.type === "punctuator" && token.value === "(") {
            const start = this.expectPunctuator("(");
            const expression = this.parseExpression({ allowSequence: true });
            const end = this.expectPunctuator(")");
            expression.node.span = createSpan(start.start, end.end);
            return {
                node: expression.node,
                parenthesized: true
            };
        }
        if (token.type === "punctuator" && token.value === "[") {
            return {
                node: this.parseArrayExpression(),
                parenthesized: false
            };
        }
        if (token.type === "punctuator" && token.value === "{") {
            return {
                node: this.parseObjectExpression(),
                parenthesized: false
            };
        }
        throw unexpectedTokenError(token);
    }
    parseNewExpression() {
        const newToken = this.currentToken();
        this.index += 1;
        if (this.consumePunctuator(".") !== undefined) {
            throw new DisallowedSyntaxError(newToken.value, newToken.start);
        }
        let callee = this.parsePrimaryExpression();
        while (true) {
            if (this.consumePunctuator(".") !== undefined) {
                const property = this.parseIdentifierName();
                callee = {
                    node: {
                        type: "MemberExpression",
                        computed: false,
                        object: callee.node,
                        optional: false,
                        property,
                        span: createSpan(callee.node.span.start, property.span.end)
                    },
                    parenthesized: false
                };
                continue;
            }
            if (this.consumePunctuator("[") !== undefined) {
                const property = this.parseExpression({ allowSequence: true });
                const end = this.expectPunctuator("]");
                callee = {
                    node: {
                        type: "MemberExpression",
                        computed: true,
                        object: callee.node,
                        optional: false,
                        property: property.node,
                        span: createSpan(callee.node.span.start, end.end)
                    },
                    parenthesized: false
                };
                continue;
            }
            break;
        }
        this.expectPunctuator("(");
        const args = this.parseArguments();
        const end = this.previousToken();
        return {
            node: {
                type: "NewExpression",
                arguments: args,
                callee: callee.node,
                span: createSpan(newToken.start, end.end)
            },
            parenthesized: false
        };
    }
    parseFunctionExpression() {
        const asyncToken = this.consumeKeyword("async");
        const functionToken = this.expectKeyword("function");
        const generatorToken = this.consumePunctuator("*");
        if (asyncToken !== undefined && generatorToken !== undefined) {
            throw new Error(`async function* is not supported at line ${asyncToken.start.line}, column ${asyncToken.start.column}.`);
        }
        const id = isIdentifierLikeToken(this.currentToken())
            ? this.parseBindingIdentifier()
            : undefined;
        const params = this.withScope(() => {
            const parsedParams = this.parseArrowParameters();
            for (const param of parsedParams) {
                for (const identifier of collectBindingIdentifiers(param)) {
                    this.declareBinding(identifier);
                }
            }
            return parsedParams;
        });
        const generator = generatorToken !== undefined;
        const body = this.withFunctionContext(generator, () => this.parseBlockStatement());
        return {
            type: "FunctionExpression",
            async: asyncToken !== undefined,
            body,
            generator,
            id,
            params,
            span: createSpan(asyncToken?.start ?? functionToken.start, body.span.end)
        };
    }
    parseArrayExpression() {
        const start = this.expectPunctuator("[");
        const elements = [];
        const emptyEnd = this.consumePunctuator("]");
        if (emptyEnd !== undefined) {
            return {
                type: "ArrayExpression",
                elements,
                span: createSpan(start.start, emptyEnd.end)
            };
        }
        while (true) {
            if (this.consumePunctuator(",") !== undefined) {
                const comma = this.previousToken();
                elements.push({
                    type: "UndefinedLiteral",
                    raw: "undefined",
                    value: undefined,
                    elision: true,
                    span: createSpan(comma.start, comma.end)
                });
                if (this.currentToken().type === "punctuator" && this.currentToken().value === "]") {
                    break;
                }
                continue;
            }
            if (this.consumePunctuator("...") !== undefined) {
                const spreadStart = this.previousToken();
                const argument = this.parseExpression();
                elements.push({
                    type: "SpreadElement",
                    argument: argument.node,
                    span: createSpan(spreadStart.start, argument.node.span.end)
                });
            }
            else {
                elements.push(this.parseExpression().node);
            }
            if (this.consumePunctuator(",") !== undefined) {
                if (this.currentToken().type === "punctuator" && this.currentToken().value === "]") {
                    break;
                }
                continue;
            }
            break;
        }
        const end = this.expectPunctuator("]");
        return {
            type: "ArrayExpression",
            elements,
            span: createSpan(start.start, end.end)
        };
    }
    parseObjectExpression() {
        const start = this.expectPunctuator("{");
        const properties = [];
        const emptyEnd = this.consumePunctuator("}");
        if (emptyEnd !== undefined) {
            return {
                type: "ObjectExpression",
                properties,
                span: createSpan(start.start, emptyEnd.end)
            };
        }
        while (true) {
            if (this.consumePunctuator("...") !== undefined) {
                const spreadStart = this.previousToken();
                const argument = this.parseExpression();
                properties.push({
                    type: "SpreadElement",
                    argument: argument.node,
                    span: createSpan(spreadStart.start, argument.node.span.end)
                });
            }
            else {
                properties.push(this.parseObjectProperty());
            }
            if (this.consumePunctuator(",") !== undefined) {
                if (this.currentToken().type === "punctuator" && this.currentToken().value === "}") {
                    break;
                }
                continue;
            }
            break;
        }
        const end = this.expectPunctuator("}");
        return {
            type: "ObjectExpression",
            properties,
            span: createSpan(start.start, end.end)
        };
    }
    parseObjectProperty() {
        const generatorToken = this.currentToken().type === "punctuator" && this.currentToken().value === "*"
            ? this.currentToken()
            : this.currentToken().type === "keyword" &&
                this.currentToken().value === "async" &&
                this.peekToken(1).type === "punctuator" &&
                this.peekToken(1).value === "*"
                ? this.peekToken(1)
                : undefined;
        if (generatorToken !== undefined) {
            throw new Error(`Generator shorthand methods are not supported at line ${generatorToken.start.line}, column ${generatorToken.start.column}.`);
        }
        if (this.currentToken().type === "identifier" &&
            (this.currentToken().value === "get" || this.currentToken().value === "set") &&
            this.isObjectAccessorShorthandStart()) {
            const token = this.currentToken();
            const syntax = token.value === "get" ? "Getter" : "Setter";
            throw new Error(`${syntax} shorthand methods are not supported at line ${token.start.line}, column ${token.start.column}.`);
        }
        if (this.consumePunctuator("[") !== undefined) {
            const propertyStart = this.previousToken();
            const key = this.parseExpression();
            this.expectPunctuator("]");
            if (this.currentToken().type === "punctuator" && this.currentToken().value === "(") {
                const value = this.parseObjectMethod(undefined, propertyStart.start);
                return {
                    type: "Property",
                    computed: true,
                    shorthand: false,
                    key: key.node,
                    value,
                    span: createSpan(propertyStart.start, value.span.end)
                };
            }
            this.expectPunctuator(":");
            const value = this.parseExpression();
            return {
                type: "Property",
                computed: true,
                shorthand: false,
                key: key.node,
                value: value.node,
                span: createSpan(propertyStart.start, value.node.span.end)
            };
        }
        const asyncToken = this.currentToken().type === "keyword" &&
            this.currentToken().value === "async" &&
            isIdentifierLikeToken(this.peekToken(1)) &&
            this.peekToken(2).type === "punctuator" &&
            this.peekToken(2).value === "(" &&
            !hasLineBreakBetween(this.currentToken(), this.peekToken(1))
            ? this.currentToken()
            : undefined;
        if (asyncToken !== undefined) {
            this.index += 1;
        }
        const token = this.currentToken();
        if (isIdentifierLikeToken(token)) {
            this.index += 1;
            const key = createIdentifier(token);
            if (this.currentToken().type === "punctuator" && this.currentToken().value === "(") {
                const value = this.parseObjectMethod(asyncToken, key.span.start);
                return {
                    type: "Property",
                    computed: false,
                    shorthand: false,
                    key,
                    value,
                    span: createSpan(asyncToken?.start ?? key.span.start, value.span.end)
                };
            }
            if (this.consumePunctuator(":") === undefined) {
                assertAllowedIdentifierReference(token);
                return {
                    type: "Property",
                    computed: false,
                    shorthand: true,
                    key,
                    value: createIdentifier(token),
                    span: key.span
                };
            }
            const value = this.parseExpression();
            return {
                type: "Property",
                computed: false,
                shorthand: false,
                key,
                value: value.node,
                span: createSpan(key.span.start, value.node.span.end)
            };
        }
        if (isLiteralPropertyKey(token)) {
            this.index += 1;
            const key = createLiteralFromToken(token);
            if (this.currentToken().type === "punctuator" && this.currentToken().value === "(") {
                const value = this.parseObjectMethod(undefined, key.span.start);
                return {
                    type: "Property",
                    computed: false,
                    shorthand: false,
                    key,
                    value,
                    span: createSpan(key.span.start, value.span.end)
                };
            }
            this.expectPunctuator(":");
            const value = this.parseExpression();
            return {
                type: "Property",
                computed: false,
                shorthand: false,
                key,
                value: value.node,
                span: createSpan(key.span.start, value.node.span.end)
            };
        }
        throw unexpectedTokenError(token);
    }
    isObjectAccessorShorthandStart() {
        const propertyToken = this.peekToken(1);
        if (propertyToken.type === "punctuator" && propertyToken.value === "[") {
            let depth = 0;
            let offset = 1;
            while (true) {
                const token = this.peekToken(offset);
                if (token.type === "eof") {
                    return false;
                }
                if (token.type === "punctuator" && token.value === "[") {
                    depth += 1;
                }
                else if (token.type === "punctuator" && token.value === "]") {
                    depth -= 1;
                    if (depth === 0) {
                        const next = this.peekToken(offset + 1);
                        return next.type === "punctuator" && next.value === "(";
                    }
                }
                offset += 1;
            }
        }
        return ((isIdentifierLikeToken(propertyToken) ||
            propertyToken.type === "numeric" ||
            propertyToken.type === "string") &&
            this.peekToken(2).type === "punctuator" &&
            this.peekToken(2).value === "(");
    }
    parseObjectMethod(asyncToken, methodStart) {
        const params = this.withScope(() => {
            const parsedParams = this.parseArrowParameters();
            for (const param of parsedParams) {
                for (const identifier of collectBindingIdentifiers(param)) {
                    this.declareBinding(identifier);
                }
            }
            return parsedParams;
        });
        const body = this.withFunctionContext(false, () => this.parseBlockStatement());
        return {
            type: "FunctionExpression",
            async: asyncToken !== undefined,
            body,
            generator: false,
            id: undefined,
            method: true,
            params,
            span: createSpan(asyncToken?.start ?? methodStart, body.span.end)
        };
    }
    parseIdentifierName() {
        const token = this.currentToken();
        if (token.type !== "identifier" && token.type !== "keyword") {
            throw unexpectedTokenError(token);
        }
        this.index += 1;
        return createIdentifierName(token);
    }
    parseArguments() {
        const args = [];
        const emptyEnd = this.consumePunctuator(")");
        if (emptyEnd !== undefined) {
            return args;
        }
        while (true) {
            if (this.currentToken().type === "punctuator" && this.currentToken().value === ",") {
                throw unexpectedTokenError(this.currentToken());
            }
            if (this.consumePunctuator("...") !== undefined) {
                const spreadStart = this.previousToken();
                const argument = this.parseExpression();
                args.push({
                    type: "SpreadElement",
                    argument: argument.node,
                    span: createSpan(spreadStart.start, argument.node.span.end)
                });
            }
            else {
                args.push(this.parseExpression().node);
            }
            if (this.consumePunctuator(",") !== undefined) {
                if (this.currentToken().type === "punctuator" && this.currentToken().value === ")") {
                    break;
                }
                continue;
            }
            break;
        }
        this.expectPunctuator(")");
        return args;
    }
    createCallExpression(callee, optional) {
        const args = this.parseArguments();
        const end = this.previousToken();
        return {
            type: "CallExpression",
            arguments: args,
            callee,
            optional,
            span: createSpan(callee.span.start, end.end)
        };
    }
    parseLogicalExpression(parseOperand, operator) {
        let left = parseOperand();
        while (this.consumePunctuator(operator) !== undefined) {
            const right = parseOperand();
            left = {
                node: {
                    type: "LogicalExpression",
                    operator,
                    left: left.node,
                    right: right.node,
                    span: createSpan(left.node.span.start, right.node.span.end)
                },
                parenthesized: false
            };
        }
        return left;
    }
    parseBinaryExpression(parseOperand, operators) {
        let left = parseOperand();
        while (true) {
            const token = this.currentToken();
            if (!operators.has(token.value)) {
                return left;
            }
            this.index += 1;
            const right = parseOperand();
            left = {
                node: {
                    type: "BinaryExpression",
                    operator: token.value,
                    left: left.node,
                    right: right.node,
                    span: createSpan(left.node.span.start, right.node.span.end)
                },
                parenthesized: false
            };
        }
    }
    assertNullishOperand(expression) {
        if (!expression.parenthesized &&
            expression.node.type === "LogicalExpression" &&
            (expression.node.operator === "&&" || expression.node.operator === "||")) {
            throw new Error(`Cannot mix '??' with '&&' or '||' without parentheses at line ${expression.node.right.span.start.line}, column ${expression.node.right.span.start.column}.`);
        }
    }
    toAssignmentTarget(node) {
        if (node.type === "Identifier") {
            return node;
        }
        if (node.type === "MetaProperty" || (node.type === "MemberExpression" && !node.optional)) {
            return node;
        }
        if (node.type === "ArrayExpression") {
            return this.arrayExpressionToPattern(node);
        }
        if (node.type === "ObjectExpression") {
            return this.objectExpressionToPattern(node);
        }
        throw invalidAssignmentTargetError(node.span.start);
    }
    toUpdateTarget(node) {
        if (node.type === "Identifier") {
            return node;
        }
        if (node.type === "MemberExpression" && !node.optional) {
            return node;
        }
        throw new Error(`Invalid update target at line ${node.span.start.line}, column ${node.span.start.column}.`);
    }
    arrayExpressionToPattern(node) {
        const elements = node.elements.map((element, index) => {
            if (element.type === "UndefinedLiteral" && element.elision === true) {
                return null;
            }
            const patternElement = this.toArrayPatternElement(element);
            if (patternElement.type === "RestElement" && index < node.elements.length - 1) {
                const nextElement = node.elements[index + 1];
                throw new Error(`Rest element must be the last element in an array pattern at line ${nextElement.span.start.line}, column ${nextElement.span.start.column}.`);
            }
            return patternElement;
        });
        return {
            type: "ArrayPattern",
            elements,
            span: node.span
        };
    }
    toArrayPatternElement(element) {
        if (element.type === "SpreadElement") {
            const argument = this.toPatternTarget(this.toAssignmentTarget(element.argument));
            return {
                type: "RestElement",
                argument,
                span: element.span
            };
        }
        if (element.type === "AssignmentExpression" && element.operator === "=") {
            return {
                type: "AssignmentPattern",
                left: this.toPatternTarget(element.left),
                right: element.right,
                span: element.span
            };
        }
        return this.toPatternTarget(this.toAssignmentTarget(element));
    }
    objectExpressionToPattern(node) {
        const properties = [];
        let restElement;
        for (const property of node.properties) {
            const patternProperty = this.toObjectPatternProperty(property);
            if (patternProperty.type === "RestElement") {
                if (restElement !== undefined) {
                    throw new Error(`Object pattern can contain only one rest element at line ${patternProperty.span.start.line}, column ${patternProperty.span.start.column}.`);
                }
                restElement = patternProperty;
            }
            else if (restElement !== undefined) {
                throw new Error(`Rest element must be the last property in an object pattern at line ${patternProperty.span.start.line}, column ${patternProperty.span.start.column}.`);
            }
            properties.push(patternProperty);
        }
        return {
            type: "ObjectPattern",
            properties,
            span: node.span
        };
    }
    toObjectPatternProperty(property) {
        if (property.type === "SpreadElement") {
            if (property.argument.type !== "Identifier") {
                throw new Error(`Object rest element must bind to an identifier at line ${property.argument.span.start.line}, column ${property.argument.span.start.column}.`);
            }
            return {
                type: "RestElement",
                argument: property.argument,
                span: property.span
            };
        }
        const value = property.shorthand && property.value.type === "Identifier"
            ? property.value
            : this.toObjectPropertyValue(property.value);
        return {
            type: "AssignmentProperty",
            computed: property.computed,
            shorthand: property.shorthand,
            key: property.key,
            value,
            span: property.span
        };
    }
    toObjectPropertyValue(value) {
        if (value.type === "AssignmentExpression" && value.operator === "=") {
            return {
                type: "AssignmentPattern",
                left: this.toPatternTarget(value.left),
                right: value.right,
                span: value.span
            };
        }
        return this.toPatternTarget(this.toAssignmentTarget(value));
    }
    isPatternAssignmentStart(startIndex) {
        const startToken = this.tokens[startIndex];
        if (startToken?.type !== "punctuator" ||
            (startToken.value !== "[" && startToken.value !== "{")) {
            return false;
        }
        const stack = [];
        for (let index = startIndex; index < this.tokens.length; index += 1) {
            const token = this.tokens[index];
            if (token.type !== "punctuator") {
                continue;
            }
            if (token.value === "(" || token.value === "[" || token.value === "{") {
                stack.push(token.value);
                continue;
            }
            if (token.value === ")" || token.value === "]" || token.value === "}") {
                const expected = matchingOpeningPunctuator(token.value);
                if (stack[stack.length - 1] === expected) {
                    stack.pop();
                }
                if (stack.length === 0) {
                    return (this.tokens[index + 1]?.type === "punctuator" && this.tokens[index + 1]?.value === "=");
                }
            }
        }
        return false;
    }
    isSingleParamArrowFunction() {
        const token = this.currentToken();
        if (!isIdentifierLikeToken(token) || this.peekToken(1).value !== "=>") {
            return false;
        }
        const arrowToken = this.peekToken(1);
        if (hasLineBreakBetween(token, arrowToken)) {
            throw new Error(`Unexpected line break before '=>' at line ${arrowToken.start.line}, column ${arrowToken.start.column}.`);
        }
        return true;
    }
    isAsyncArrowWithSingleParam() {
        const token = this.currentToken();
        if (token.type !== "keyword" ||
            token.value !== "async" ||
            this.peekToken(1).type !== "identifier" ||
            this.peekToken(2).value !== "=>") {
            return false;
        }
        const paramToken = this.peekToken(1);
        if (hasLineBreakBetween(token, paramToken)) {
            throw new Error(`Unexpected line break after 'async' at line ${paramToken.start.line}, column ${paramToken.start.column}.`);
        }
        const arrowToken = this.peekToken(2);
        if (hasLineBreakBetween(paramToken, arrowToken)) {
            throw new Error(`Unexpected line break before '=>' at line ${arrowToken.start.line}, column ${arrowToken.start.column}.`);
        }
        return true;
    }
    isParenthesizedArrowFunction() {
        return this.findArrowFromParenthesizedParams(this.index) !== undefined;
    }
    isAsyncArrowWithParenthesizedParams() {
        const token = this.currentToken();
        if (token.type !== "keyword" || token.value !== "async") {
            return false;
        }
        const nextToken = this.peekToken(1);
        const arrowIndex = this.findArrowFromParenthesizedParams(this.index + 1);
        if (arrowIndex === undefined) {
            return false;
        }
        if (hasLineBreakBetween(token, nextToken)) {
            throw new Error(`Unexpected line break after 'async' at line ${nextToken.start.line}, column ${nextToken.start.column}.`);
        }
        return true;
    }
    findArrowFromParenthesizedParams(startIndex) {
        const startToken = this.tokens[startIndex];
        if (startToken?.type !== "punctuator" || startToken.value !== "(") {
            return undefined;
        }
        let depth = 0;
        for (let index = startIndex; index < this.tokens.length; index += 1) {
            const token = this.tokens[index];
            if (token.type !== "punctuator") {
                continue;
            }
            if (token.value === "(") {
                depth += 1;
                continue;
            }
            if (token.value === ")") {
                depth -= 1;
                if (depth === 0) {
                    const arrowToken = this.tokens[index + 1];
                    if (arrowToken?.value !== "=>") {
                        return undefined;
                    }
                    if (hasLineBreakBetween(token, arrowToken)) {
                        throw new Error(`Unexpected line break before '=>' at line ${arrowToken.start.line}, column ${arrowToken.start.column}.`);
                    }
                    return index + 1;
                }
            }
        }
        return undefined;
    }
    findTopLevelForIterationOperator(startIndex) {
        let depth = 0;
        let previousToken;
        for (let index = startIndex; index < this.tokens.length; index += 1) {
            const token = this.tokens[index];
            if (token.type === "punctuator") {
                if (token.value === "(" || token.value === "[" || token.value === "{") {
                    depth += 1;
                }
                else if (token.value === ")" || token.value === "]" || token.value === "}") {
                    if (depth === 0 && token.value === ")") {
                        return undefined;
                    }
                    depth -= 1;
                }
                else if (depth === 0 && token.value === ";") {
                    return undefined;
                }
            }
            if (depth === 0 &&
                token.type === "keyword" &&
                (token.value === "of" || token.value === "in") &&
                previousToken?.value !== "." &&
                previousToken?.value !== "?.") {
                return token;
            }
            previousToken = token;
        }
        return undefined;
    }
    shouldParseTopLevelStatement() {
        const token = this.currentToken();
        if (this.isAsyncFunctionDeclarationStart()) {
            return true;
        }
        if (token.type === "keyword" && TOP_LEVEL_STATEMENT_KEYWORDS.has(token.value)) {
            if (token.value === "import" && this.isImportMetaStart()) {
                return false;
            }
            return true;
        }
        return (token.type === "identifier" &&
            (token.value === "switch" ||
                token.value === "var" ||
                (this.peekToken(1).type === "punctuator" && this.peekToken(1).value === ":")));
    }
    isAsyncFunctionDeclarationStart() {
        const token = this.currentToken();
        const next = this.peekToken(1);
        return (token.type === "keyword" &&
            token.value === "async" &&
            next.type === "keyword" &&
            next.value === "function" &&
            !hasLineBreakBetween(token, next));
    }
    assertAllowedStatementStart(token) {
        if (this.isExportToken(token)) {
            throw new DisallowedSyntaxError("export", token.start);
        }
        if (token.type === "identifier" &&
            this.peekToken(1).type === "punctuator" &&
            this.peekToken(1).value === ":") {
            throw new DisallowedSyntaxError("label", token.start);
        }
    }
    consumeControlLabel(token) {
        if (this.currentToken().type === "identifier" &&
            !hasLineBreakBetween(token, this.currentToken())) {
            const label = this.currentToken();
            this.index += 1;
            return label;
        }
        return undefined;
    }
    hasReturnArgument(returnToken, nextToken) {
        return !(hasLineBreakBetween(returnToken, nextToken) ||
            (nextToken.type === "punctuator" && (nextToken.value === ";" || nextToken.value === "}")) ||
            nextToken.type === "eof");
    }
    withFunctionContext(generatorBody, callback) {
        const previousBreakableDepth = this.breakableDepth;
        const previousLoopDepth = this.loopDepth;
        const previousGeneratorBody = this.generatorBody;
        this.breakableDepth = 0;
        this.loopDepth = 0;
        this.generatorBody = generatorBody;
        try {
            return callback();
        }
        finally {
            this.breakableDepth = previousBreakableDepth;
            this.loopDepth = previousLoopDepth;
            this.generatorBody = previousGeneratorBody;
        }
    }
    withLoopContext(callback) {
        this.breakableDepth += 1;
        this.loopDepth += 1;
        try {
            return callback();
        }
        finally {
            this.breakableDepth -= 1;
            this.loopDepth -= 1;
        }
    }
    withBreakableContext(callback) {
        this.breakableDepth += 1;
        try {
            return callback();
        }
        finally {
            this.breakableDepth -= 1;
        }
    }
    withScope(callback) {
        this.scopes.push(new Map());
        try {
            return callback();
        }
        finally {
            this.scopes.pop();
        }
    }
    declarePatternBindings(pattern) {
        for (const identifier of collectBindingIdentifiers(pattern)) {
            this.declareBinding(identifier);
        }
    }
    declareBinding(identifier) {
        const scope = this.scopes[this.scopes.length - 1];
        if (scope === undefined) {
            return;
        }
        if (scope.has(identifier.name)) {
            throw new Error(`Cannot redeclare binding '${identifier.name}' at line ${identifier.span.start.line}, column ${identifier.span.start.column}.`);
        }
        scope.set(identifier.name, identifier.span.start);
    }
    consumePunctuator(value) {
        const token = this.currentToken();
        if (token.type !== "punctuator" || token.value !== value) {
            return undefined;
        }
        this.index += 1;
        return token;
    }
    consumeAssignmentOperator() {
        const token = this.currentToken();
        if (token.type !== "punctuator" || !isAssignmentOperator(token.value)) {
            return undefined;
        }
        this.index += 1;
        return token.value;
    }
    expectPunctuator(value) {
        const token = this.currentToken();
        if (token.type !== "punctuator" || token.value !== value) {
            throw new Error(`Expected '${value}' at line ${token.start.line}, column ${token.start.column}.`);
        }
        this.index += 1;
        return token;
    }
    consumeKeyword(value) {
        const token = this.currentToken();
        if (token.type !== "keyword" || token.value !== value) {
            return undefined;
        }
        this.index += 1;
        return token;
    }
    expectKeyword(value) {
        const token = this.currentToken();
        if (token.type !== "keyword" || token.value !== value) {
            throw new Error(`Expected '${value}' at line ${token.start.line}, column ${token.start.column}.`);
        }
        this.index += 1;
        return token;
    }
    expectEof() {
        const token = this.currentToken();
        if (token.type !== "eof") {
            throw unexpectedTokenError(token);
        }
    }
    currentToken() {
        return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1];
    }
    peekToken(offset) {
        return this.tokens[this.index + offset] ?? this.tokens[this.tokens.length - 1];
    }
    previousToken() {
        return this.tokens[this.index - 1] ?? this.tokens[0];
    }
    isExportToken(token) {
        return token.value === "export";
    }
    isImportMetaStart() {
        return isImportMetaTokenSequence(this.currentToken(), this.peekToken(1), this.peekToken(2));
    }
    parseImportMeta() {
        const importToken = this.currentToken();
        if (!this.isImportMetaStart()) {
            throw unexpectedTokenError(importToken);
        }
        this.index += 3;
        return createImportMeta(importToken, this.previousToken());
    }
    toPatternTarget(target) {
        if (target.type === "MetaProperty") {
            throw new DisallowedSyntaxError("import.meta assignment", target.span.start);
        }
        return target;
    }
}
function createIdentifier(token) {
    return {
        type: "Identifier",
        name: token.value,
        span: createTokenSpan(token)
    };
}
function createIdentifierName(token) {
    return {
        type: "Identifier",
        name: token.value,
        span: createTokenSpan(token)
    };
}
function collectBindingIdentifiers(pattern) {
    switch (pattern.type) {
        case "Identifier":
            return [pattern];
        case "MemberExpression":
            return [];
        case "AssignmentPattern":
            return collectBindingIdentifiers(pattern.left);
        case "RestElement":
            return collectBindingIdentifiers(pattern.argument);
        case "ArrayPattern":
            return pattern.elements.flatMap((element) => element === null ? [] : collectBindingIdentifiers(element));
        case "ObjectPattern":
            return pattern.properties.flatMap((property) => property.type === "RestElement"
                ? collectBindingIdentifiers(property)
                : collectBindingIdentifiers(property.value));
    }
}
function createLoopLabelFields(labels) {
    if (labels === undefined || labels.length === 0) {
        return {};
    }
    const label = labels[labels.length - 1];
    return labels.length === 1 ? { label } : { label, labels };
}
function throwIfImportMetaAssignment(node) {
    const importMetaAssignment = findImportMetaAssignmentTarget(node);
    if (importMetaAssignment !== undefined) {
        throw new DisallowedSyntaxError("import.meta assignment", importMetaAssignment.start);
    }
}
function findImportMetaAssignmentTarget(node) {
    return findImportMetaAssignmentInNode(node);
}
function findImportMetaAssignmentInNode(node) {
    switch (node.type) {
        case "Module":
            return findImportMetaAssignmentInList(node.body);
        case "AssignmentExpression":
            if (isImportMetaAssignmentTarget(node.left)) {
                return node.left.span;
            }
            return findImportMetaAssignmentInNode(node.right);
        case "ForOfStatement":
            if (node.left.type !== "VariableDeclaration" && isImportMetaAssignmentTarget(node.left)) {
                return node.left.span;
            }
            return (findImportMetaAssignmentInNode(node.right) ?? findImportMetaAssignmentInNode(node.body));
        case "BlockStatement":
            return findImportMetaAssignmentInList(node.body);
        case "ExpressionStatement":
            return findImportMetaAssignmentInNode(node.expression);
        case "IfStatement":
            return (findImportMetaAssignmentInNode(node.test) ??
                findImportMetaAssignmentInNode(node.consequent) ??
                (node.alternate === undefined ? undefined : findImportMetaAssignmentInNode(node.alternate)));
        case "ForStatement":
            return (findImportMetaAssignmentInOptionalForInit(node.init) ??
                findImportMetaAssignmentInOptionalExpression(node.test) ??
                findImportMetaAssignmentInOptionalExpression(node.update) ??
                findImportMetaAssignmentInNode(node.body));
        case "WhileStatement":
            return findImportMetaAssignmentInNode(node.test) ?? findImportMetaAssignmentInNode(node.body);
        case "DoWhileStatement":
            return findImportMetaAssignmentInNode(node.body) ?? findImportMetaAssignmentInNode(node.test);
        case "TryStatement":
            return (findImportMetaAssignmentInNode(node.block) ??
                (node.handler === undefined
                    ? undefined
                    : findImportMetaAssignmentInNode(node.handler.body)) ??
                (node.finalizer === undefined ? undefined : findImportMetaAssignmentInNode(node.finalizer)));
        case "VariableDeclaration":
            for (const declarator of node.declarations) {
                if (declarator.init !== undefined) {
                    const result = findImportMetaAssignmentInNode(declarator.init);
                    if (result !== undefined) {
                        return result;
                    }
                }
            }
            return undefined;
        case "ReturnStatement":
            return node.argument === undefined
                ? undefined
                : findImportMetaAssignmentInNode(node.argument);
        case "ThrowStatement":
            return findImportMetaAssignmentInNode(node.argument);
        case "ArrowFunctionExpression":
            return node.body.type === "BlockStatement"
                ? findImportMetaAssignmentInNode(node.body)
                : findImportMetaAssignmentInNode(node.body);
        case "AwaitExpression":
            return findImportMetaAssignmentInNode(node.argument);
        case "YieldExpression":
            return node.argument === undefined
                ? undefined
                : findImportMetaAssignmentInNode(node.argument);
        case "ArrayExpression":
            return findImportMetaAssignmentInList(node.elements);
        case "ObjectExpression":
            for (const property of node.properties) {
                const result = property.type === "SpreadElement"
                    ? findImportMetaAssignmentInNode(property.argument)
                    : findImportMetaAssignmentInNode(property.value);
                if (result !== undefined) {
                    return result;
                }
            }
            return undefined;
        case "UnaryExpression":
            return findImportMetaAssignmentInNode(node.argument);
        case "UpdateExpression":
            if (isImportMetaReference(node.argument)) {
                return node.argument.span;
            }
            return findImportMetaAssignmentInNode(node.argument);
        case "SequenceExpression":
            return findImportMetaAssignmentInList(node.expressions);
        case "BinaryExpression":
        case "LogicalExpression":
            return (findImportMetaAssignmentInNode(node.left) ?? findImportMetaAssignmentInNode(node.right));
        case "ConditionalExpression":
            return (findImportMetaAssignmentInNode(node.test) ??
                findImportMetaAssignmentInNode(node.consequent) ??
                findImportMetaAssignmentInNode(node.alternate));
        case "MemberExpression":
            return (findImportMetaAssignmentInNode(node.object) ??
                (node.computed ? findImportMetaAssignmentInNode(node.property) : undefined));
        case "CallExpression":
            return (findImportMetaAssignmentInNode(node.callee) ??
                findImportMetaAssignmentInList(node.arguments));
        case "TaggedTemplateExpression":
            return findImportMetaAssignmentInNode(node.tag) ?? findImportMetaAssignmentInNode(node.quasi);
        case "TemplateLiteral":
            return findImportMetaAssignmentInList(node.expressions);
        case "BreakStatement":
        case "ContinueStatement":
        case "EmptyStatement":
        case "ExportDefaultDeclaration":
        case "ExportNamedDeclaration":
        case "Identifier":
        case "ImportDeclaration":
        case "BooleanLiteral":
        case "NullLiteral":
        case "NumericLiteral":
        case "StringLiteral":
        case "ThisExpression":
        case "RegexLiteral":
        case "MetaProperty":
        case "UndefinedLiteral":
            return undefined;
    }
}
function findImportMetaAssignmentInOptionalForInit(node) {
    return node === undefined ? undefined : findImportMetaAssignmentInNode(node);
}
function findImportMetaAssignmentInOptionalExpression(node) {
    return node === undefined ? undefined : findImportMetaAssignmentInNode(node);
}
function findImportMetaAssignmentInList(nodes) {
    for (const node of nodes) {
        const result = node.type === "SpreadElement"
            ? findImportMetaAssignmentInNode(node.argument)
            : findImportMetaAssignmentInNode(node);
        if (result !== undefined) {
            return result;
        }
    }
    return undefined;
}
function isImportMetaAssignmentTarget(node) {
    switch (node.type) {
        case "MetaProperty":
            return true;
        case "MemberExpression":
            return isImportMetaReference(node);
        case "AssignmentPattern":
            return isImportMetaAssignmentTarget(node.left);
        case "RestElement":
            return isImportMetaAssignmentTarget(node.argument);
        case "ArrayPattern":
            return node.elements.some((element) => element !== null && isImportMetaAssignmentTarget(element));
        case "ObjectPattern":
            return node.properties.some((property) => isImportMetaAssignmentTarget(property.type === "RestElement" ? property : property.value));
        case "Identifier":
            return false;
    }
}
function isImportMetaReference(node) {
    if (node.type === "MetaProperty") {
        return true;
    }
    return (node.type === "MemberExpression" &&
        (isImportMetaReference(node.object) || (node.computed && isImportMetaReference(node.property))));
}
function isAssignmentOperator(value) {
    switch (value) {
        case "=":
        case "+=":
        case "-=":
        case "*=":
        case "/=":
        case "%=":
        case "**=":
        case "&=":
        case "|=":
        case "^=":
        case "<<=":
        case ">>=":
        case ">>>=":
        case "&&=":
        case "||=":
        case "??=":
            return true;
        default:
            return false;
    }
}
function isYieldArgumentTerminator(value) {
    return value === ";" || value === "}" || value === ")" || value === "]" || value === ",";
}
function createNumericLiteral(token) {
    return {
        type: "NumericLiteral",
        raw: token.value,
        value: Number(token.value.replaceAll("_", "")),
        span: createTokenSpan(token)
    };
}
function createStringLiteral(token) {
    return {
        type: "StringLiteral",
        raw: token.value,
        value: decodeEscapedText(token.value.slice(1, -1)),
        span: createTokenSpan(token)
    };
}
function createRegexLiteral(token) {
    const lastSlash = token.value.lastIndexOf("/");
    try {
        parseRegex(token.value.slice(1, lastSlash), token.value.slice(lastSlash + 1));
    }
    catch (error) {
        if (error instanceof SyntaxError) {
            const relativePosition = readRegexErrorPosition(error.message);
            if (relativePosition !== undefined) {
                const flagColumn = token.start.column + lastSlash + 1 + relativePosition;
                throw new Error(`${error.message.replace(/ at position \d+$/, "")} at line ${token.start.line}, column ${flagColumn}.`);
            }
        }
        throw error;
    }
    return {
        type: "RegexLiteral",
        raw: token.value,
        span: createTokenSpan(token)
    };
}
function readRegexErrorPosition(message) {
    const marker = " at position ";
    const markerIndex = message.lastIndexOf(marker);
    if (markerIndex < 0)
        return undefined;
    const position = Number(message.slice(markerIndex + marker.length));
    return Number.isSafeInteger(position) && position >= 0 ? position : undefined;
}
function createKeywordLiteral(token) {
    if (token.value === "true" || token.value === "false") {
        return {
            type: "BooleanLiteral",
            raw: token.value,
            value: token.value === "true",
            span: createTokenSpan(token)
        };
    }
    if (token.value === "null") {
        return {
            type: "NullLiteral",
            raw: "null",
            value: null,
            span: createTokenSpan(token)
        };
    }
    if (token.value === "undefined") {
        return {
            type: "UndefinedLiteral",
            raw: "undefined",
            value: undefined,
            span: createTokenSpan(token)
        };
    }
    throw unexpectedTokenError(token);
}
function createLiteralFromToken(token) {
    if (token.type === "numeric") {
        return createNumericLiteral(token);
    }
    if (token.type === "string") {
        return createStringLiteral(token);
    }
    return createKeywordLiteral(token);
}
function createTemplateLiteral(token, options = { allowMalformedEscapes: false }) {
    const raw = token.value;
    const expressions = [];
    const quasis = [];
    let cursor = 1;
    let quasiStart = 1;
    while (cursor < raw.length - 1) {
        const char = raw[cursor];
        if (char === "\\") {
            cursor = skipEscapedCharacter(raw, cursor);
            continue;
        }
        if (char === "$" && raw[cursor + 1] === "{") {
            quasis.push(createTemplateElement(token.start, raw, quasiStart, cursor, false, options));
            const expressionStart = cursor + 2;
            const expressionEnd = findTemplateExpressionEnd(raw, expressionStart);
            expressions.push(parseEmbeddedExpression(raw.slice(expressionStart, expressionEnd), positionWithinRaw(token.start, raw, expressionStart)));
            quasiStart = expressionEnd + 1;
            cursor = expressionEnd + 1;
            continue;
        }
        cursor += 1;
    }
    quasis.push(createTemplateElement(token.start, raw, quasiStart, raw.length - 1, true, options));
    return {
        type: "TemplateLiteral",
        expressions,
        quasis,
        span: createTokenSpan(token)
    };
}
function assertBareImportSpecifier(specifier) {
    if (specifier.value.includes("/") ||
        hasInvalidImportPathDots(specifier.value) ||
        hasProtocolPrefix(specifier.value)) {
        throw new Error(`Invalid import specifier '${specifier.value}' at line ${specifier.span.start.line}, column ${specifier.span.start.column}.`);
    }
}
function hasInvalidImportPathDots(value) {
    const segments = value.split(".");
    if (segments.some((segment) => segment.length === 0)) {
        return true;
    }
    return (segments.length > 1 &&
        ["js", "mjs", "cjs", "ts", "mts", "cts", "json"].includes(segments.at(-1) ?? ""));
}
function hasProtocolPrefix(value) {
    const colonIndex = value.indexOf(":");
    if (colonIndex <= 0) {
        return false;
    }
    const firstChar = value[0];
    if (firstChar === undefined || !isAsciiLetter(firstChar)) {
        return false;
    }
    for (let index = 1; index < colonIndex; index += 1) {
        const char = value[index];
        if (char === undefined) {
            return false;
        }
        if (isAsciiLetter(char) ||
            isDecimalDigit(char) ||
            char === "+" ||
            char === "-" ||
            char === ".") {
            continue;
        }
        return false;
    }
    return true;
}
function isAsciiLetter(value) {
    const code = value.charCodeAt(0);
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}
function isDecimalDigit(value) {
    const code = value.charCodeAt(0);
    return code >= 48 && code <= 57;
}
function isHexDigit(value) {
    return isDecimalDigit(value) || (value >= "a" && value <= "f") || (value >= "A" && value <= "F");
}
function isOctalDigit(value) {
    return value >= "0" && value <= "7";
}
function createTemplateElement(templateStart, rawTemplate, rawStart, rawEnd, tail, options) {
    const rawValue = rawTemplate.slice(rawStart, rawEnd);
    const cooked = decodeTemplateElementCooked(rawValue, options.allowMalformedEscapes);
    if (cooked.invalid !== undefined && !options.allowMalformedEscapes) {
        const position = positionWithinRaw(templateStart, rawTemplate, rawStart + cooked.invalid.index);
        throw new Error(`${cooked.invalid.message} at line ${position.line}, column ${position.column}.`);
    }
    return {
        type: "TemplateElement",
        tail,
        value: {
            raw: rawValue,
            cooked: cooked.invalid === undefined ? cooked.value : undefined
        },
        span: createSpan(positionWithinRaw(templateStart, rawTemplate, rawStart), positionWithinRaw(templateStart, rawTemplate, rawEnd))
    };
}
function decodeTemplateElementCooked(value, allowMalformedEscapes) {
    const normalized = normalizeTemplateLineTerminators(value);
    const invalid = findMalformedTemplateEscape(normalized);
    if (invalid !== undefined) {
        return allowMalformedEscapes ? { invalid } : { invalid };
    }
    return {
        value: decodeEscapedText(normalized)
    };
}
function findMalformedTemplateEscape(value) {
    let index = 0;
    while (index < value.length) {
        if (value[index] !== "\\") {
            index += 1;
            continue;
        }
        const next = value[index + 1];
        if (next === undefined || next === "\n") {
            index += 2;
            continue;
        }
        if (next === "u") {
            if (!isValidUnicodeEscape(value, index)) {
                return { index, message: "Invalid unicode escape" };
            }
            index += 2;
            continue;
        }
        if (next === "x") {
            const hex = value.slice(index + 2, index + 4);
            if (hex.length !== 2 || ![...hex].every(isHexDigit)) {
                return { index, message: "Invalid hex escape" };
            }
            index += 4;
            continue;
        }
        if (next === "0") {
            if (isDecimalDigit(value[index + 2] ?? "")) {
                return { index, message: "Legacy octal escape sequences are not supported" };
            }
            index += 2;
            continue;
        }
        if (isOctalDigit(next)) {
            return { index, message: "Legacy octal escape sequences are not supported" };
        }
        index += 2;
    }
    return undefined;
}
function isValidUnicodeEscape(value, start) {
    let index = start + 2;
    if (value[index] === "{") {
        index += 1;
        const codePointStart = index;
        while (index < value.length && value[index] !== "}") {
            if (!isHexDigit(value[index] ?? "")) {
                return false;
            }
            index += 1;
        }
        if (index === codePointStart || value[index] !== "}") {
            return false;
        }
        return Number.parseInt(value.slice(codePointStart, index), 16) <= MAX_UNICODE_CODE_POINT;
    }
    const hex = value.slice(index, index + 4);
    return hex.length === 4 && [...hex].every(isHexDigit);
}
function findTemplateExpressionEnd(raw, start) {
    let depth = 1;
    let index = start;
    while (index < raw.length - 1) {
        const char = raw[index];
        if (char === "'" || char === '"') {
            index = skipQuotedString(raw, index, char);
            continue;
        }
        if (char === "`") {
            index = skipNestedTemplate(raw, index);
            continue;
        }
        if (char === "/" && raw[index + 1] === "/") {
            index = skipLineComment(raw, index);
            continue;
        }
        if (char === "/" && raw[index + 1] === "*") {
            index = skipBlockComment(raw, index);
            continue;
        }
        if (char === "{") {
            depth += 1;
            index += 1;
            continue;
        }
        if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
            index += 1;
            continue;
        }
        index += 1;
    }
    throw new Error(`Unterminated template literal at line ${1}, column ${raw.length}.`);
}
function skipQuotedString(raw, start, quote) {
    let index = start + 1;
    while (index < raw.length) {
        const char = raw[index];
        if (char === "\\") {
            index = skipEscapedCharacter(raw, index);
            continue;
        }
        if (char === quote) {
            return index + 1;
        }
        index += 1;
    }
    return index;
}
function skipNestedTemplate(raw, start) {
    let index = start + 1;
    while (index < raw.length) {
        const char = raw[index];
        if (char === "\\") {
            index = skipEscapedCharacter(raw, index);
            continue;
        }
        if (char === "`") {
            return index + 1;
        }
        if (char === "$" && raw[index + 1] === "{") {
            index = findTemplateExpressionEnd(raw, index + 2) + 1;
            continue;
        }
        index += 1;
    }
    return index;
}
function skipLineComment(raw, start) {
    let index = start + 2;
    while (index < raw.length && raw[index] !== "\n" && raw[index] !== "\r") {
        index += 1;
    }
    return index;
}
function skipBlockComment(raw, start) {
    let index = start + 2;
    while (index < raw.length - 1) {
        if (raw[index] === "*" && raw[index + 1] === "/") {
            return index + 2;
        }
        index += 1;
    }
    return raw.length;
}
function skipEscapedCharacter(raw, start) {
    const next = raw[start + 1];
    if (next === "\r") {
        if (raw[start + 2] === "\n") {
            return start + 3;
        }
        return start + 2;
    }
    if (next === "\n") {
        return start + 2;
    }
    return Math.min(start + 2, raw.length);
}
function decodeEscapedText(value) {
    let decoded = "";
    let index = 0;
    while (index < value.length) {
        const char = value[index];
        if (char !== "\\") {
            decoded += char;
            index += 1;
            continue;
        }
        const next = value[index + 1];
        if (next === undefined) {
            decoded += "\\";
            break;
        }
        if (next === "\n") {
            index += 2;
            continue;
        }
        if (next === "\r") {
            if (value[index + 2] === "\n") {
                index += 3;
            }
            else {
                index += 2;
            }
            continue;
        }
        if (next === "u") {
            const unicodeEscape = decodeUnicodeEscape(value, index);
            if (unicodeEscape !== undefined) {
                decoded += unicodeEscape.value;
                index = unicodeEscape.end;
                continue;
            }
        }
        if (next === "x") {
            const hexEscape = decodeHexEscape(value, index);
            if (hexEscape !== undefined) {
                decoded += hexEscape.value;
                index = hexEscape.end;
                continue;
            }
        }
        decoded += decodeEscapeCharacter(next);
        index += 2;
    }
    return decoded;
}
function normalizeTemplateLineTerminators(value) {
    let normalized = "";
    let index = 0;
    while (index < value.length) {
        const char = value[index];
        if (char === "\r") {
            normalized += "\n";
            index += value[index + 1] === "\n" ? 2 : 1;
            continue;
        }
        normalized += char;
        index += 1;
    }
    return normalized;
}
function decodeUnicodeEscape(value, start) {
    let index = start + 2;
    if (value[index] === "{") {
        index += 1;
        const codePointStart = index;
        while (index < value.length && value[index] !== "}") {
            if (!isHexDigit(value[index] ?? "")) {
                return undefined;
            }
            index += 1;
        }
        if (index === codePointStart || value[index] !== "}") {
            return undefined;
        }
        return {
            value: String.fromCodePoint(Number.parseInt(value.slice(codePointStart, index), 16)),
            end: index + 1
        };
    }
    const hex = value.slice(index, index + 4);
    if (hex.length !== 4 || ![...hex].every(isHexDigit)) {
        return undefined;
    }
    return {
        value: String.fromCharCode(Number.parseInt(hex, 16)),
        end: index + 4
    };
}
function decodeHexEscape(value, start) {
    const index = start + 2;
    const hex = value.slice(index, index + 2);
    if (hex.length !== 2 || ![...hex].every(isHexDigit)) {
        return undefined;
    }
    return {
        value: String.fromCharCode(Number.parseInt(hex, 16)),
        end: index + 2
    };
}
function parseEmbeddedExpression(source, base) {
    const tokens = tokenize(source, { allowRegexLiterals: true }).map((token) => ({
        ...token,
        start: rebasePosition(token.start, base),
        end: rebasePosition(token.end, base)
    }));
    return parseExpressionTokens(tokens);
}
function findRegexLiteral(node) {
    if (node === null || node === undefined) {
        return undefined;
    }
    if (Array.isArray(node)) {
        for (const value of node) {
            const match = findRegexLiteral(value);
            if (match !== undefined) {
                return match;
            }
        }
        return undefined;
    }
    if (typeof node !== "object") {
        return undefined;
    }
    if ("type" in node && node.type === "RegexLiteral") {
        return node;
    }
    for (const value of Object.values(node)) {
        const match = findRegexLiteral(value);
        if (match !== undefined) {
            return match;
        }
    }
    return undefined;
}
function decodeEscapeCharacter(char) {
    if (char === "n") {
        return "\n";
    }
    if (char === "r") {
        return "\r";
    }
    if (char === "t") {
        return "\t";
    }
    if (char === "b") {
        return "\b";
    }
    if (char === "f") {
        return "\f";
    }
    if (char === "v") {
        return "\v";
    }
    if (char === "0") {
        return "\0";
    }
    return char;
}
function positionWithinRaw(base, raw, index) {
    let line = base.line;
    let column = base.column;
    let offset = base.offset;
    let cursor = 0;
    while (cursor < index) {
        const char = raw[cursor];
        if (char === "\r") {
            cursor += 1;
            offset += 1;
            if (raw[cursor] === "\n" && cursor < index) {
                cursor += 1;
                offset += 1;
            }
            line += 1;
            column = 1;
            continue;
        }
        cursor += 1;
        offset += 1;
        if (char === "\n") {
            line += 1;
            column = 1;
            continue;
        }
        column += 1;
    }
    return { line, column, offset };
}
function rebasePosition(position, base) {
    return {
        line: base.line + position.line - 1,
        column: position.line === 1 ? base.column + position.column - 1 : position.column,
        offset: base.offset + position.offset
    };
}
function isLiteralPropertyKey(token) {
    if (token.type === "numeric" || token.type === "string") {
        return true;
    }
    return (token.type === "keyword" &&
        (token.value === "true" ||
            token.value === "false" ||
            token.value === "null" ||
            token.value === "undefined"));
}
function isIdentifierLikeToken(token) {
    return token.type === "identifier" || (token.type === "keyword" && token.value === "async");
}
function isNewToken(token) {
    return token.value === "new";
}
function createTokenSpan(token) {
    return createSpan(token.start, token.end);
}
function assertAllowedIdentifierReference(token) {
    if (token.value === "new") {
        throw new DisallowedSyntaxError(token.value, token.start);
    }
}
function createSpan(start, end) {
    return {
        start: { ...start },
        end: { ...end }
    };
}
function hasLineBreakBetween(left, right) {
    return left.end.line !== right.start.line;
}
function unexpectedTokenError(token) {
    if (token.type === "eof") {
        return new Error(`Unexpected end of input at line ${token.start.line}, column ${token.start.column}.`);
    }
    return new Error(`Unexpected token '${token.value}' at line ${token.start.line}, column ${token.start.column}.`);
}
function invalidAssignmentTargetError(position) {
    return new Error(`Invalid assignment target at line ${position.line}, column ${position.column}.`);
}
function matchingOpeningPunctuator(value) {
    if (value === ")") {
        return "(";
    }
    if (value === "]") {
        return "[";
    }
    return "{";
}
