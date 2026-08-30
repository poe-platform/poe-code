export class ShellSyntaxError extends SyntaxError {
    reason;
    offset;
    exitCode;
    incompleteCommand;
    unclosedQuote;
    constructor(reason, offset, exitCode = 2, incompleteCommand, unclosedQuote) {
        super(`${reason} at offset ${offset}`);
        this.reason = reason;
        this.offset = offset;
        this.exitCode = exitCode;
        this.incompleteCommand = incompleteCommand;
        this.unclosedQuote = unclosedQuote;
        this.name = "ShellSyntaxError";
    }
}
export class ShellLimitError extends Error {
    limit;
    constructor(limit) {
        super(`Shell limit exceeded: ${limit}`);
        this.limit = limit;
        this.name = "ShellLimitError";
    }
}
//# sourceMappingURL=types.js.map